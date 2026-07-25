/**
 * LOAD-06 — failover and restart availability probe.
 *
 * Not a load test. A **witness**: a low, constant, per-second probe that runs
 * across an operator-initiated disruption and reports exactly how long the
 * service was unavailable and how it failed. This is the artifact P8-DB-01's
 * "failover and restore report" and runbooks.md RB-01 / RB-02 need and cannot
 * produce from logs alone, because a service that is down produces no logs.
 *
 * Run it in one terminal, perform the disruption in another:
 *
 *   # terminal 1
 *   k6 run -e VERDERY_BASE_URL=... -e VERDERY_LOAD_PROFILE=soak \
 *     tests/load/scenarios/failover.mjs
 *
 *   # terminal 2 — one of:
 *   gcloud sql instances failover <instance>          # RB-02, needs HA
 *   gcloud run services update-traffic ... --to-revisions=<older>=100   # RB-01
 *   gcloud run services update <service> --min-instances=0             # cold start
 *
 * What it reports, per probe target:
 *
 * - failure rate over the whole window (the outage share);
 * - the longest consecutive run of failed probes (the outage DURATION, which an
 *   average cannot show);
 * - the status codes actually seen — a 503 from `/v1/health/ready` means the
 *   readiness gate did its job and the database was unreachable; a connection
 *   error means the instance was gone entirely; a 500 means something worse.
 *
 * Thresholds are deliberately absent. A failover has no pass mark until section
 * 4 of docs/development/service-levels.md is approved and an RTO exists; until
 * then the run's job is to produce the number, not to grade it.
 */

/* global __ENV */

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

import { API, GARDEN_IDS, byProfile, pick } from '../lib/config.mjs';
import { authHeaders, loadTokens, tokenForVu } from '../lib/auth.mjs';

const tokens = loadTokens();

const probeFailures = new Counter('verdery_probe_failures');
const probeSuccesses = new Counter('verdery_probe_successes');
const outageSeconds = new Trend('verdery_longest_outage_seconds');
const readyDuration = new Trend('verdery_ready_duration', true);

export const options = byProfile({
  smoke: {
    scenarios: {
      probe: {
        executor: 'constant-arrival-rate',
        rate: 1,
        timeUnit: '1s',
        duration: '30s',
        preAllocatedVUs: 2,
        maxVUs: 5,
      },
    },
  },
  soak: {
    scenarios: {
      probe: {
        executor: 'constant-arrival-rate',
        rate: 1,
        timeUnit: '1s',
        duration: __ENV.VERDERY_PROBE_DURATION ?? '20m',
        preAllocatedVUs: 4,
        maxVUs: 10,
      },
    },
  },
  full: {
    scenarios: {
      probe: {
        executor: 'constant-arrival-rate',
        rate: 2,
        timeUnit: '1s',
        duration: __ENV.VERDERY_PROBE_DURATION ?? '20m',
        preAllocatedVUs: 8,
        maxVUs: 20,
      },
    },
  },
});

// Consecutive-failure tracking is per virtual user, which is why the probe runs
// at a low rate with few VUs: each VU sees a contiguous slice of time, so its
// own longest failure run is a faithful outage length.
let consecutiveFailures = 0;
const probeIntervalSeconds = 1;

function recordOutcome(succeeded) {
  if (succeeded) {
    if (consecutiveFailures > 0) {
      outageSeconds.add(consecutiveFailures * probeIntervalSeconds);
      consecutiveFailures = 0;
    }
    probeSuccesses.add(1);
    return;
  }
  consecutiveFailures += 1;
  probeFailures.add(1);
}

export default function failoverProbe() {
  // Readiness is the fastest database-reachability check an operator has, it is
  // unauthenticated, and it returns 503 (not 500) when a dependency is down —
  // which distinguishes "database unreachable" from "service broken".
  const ready = http.get(`${API}/health/ready`, {
    tags: { name: 'health/ready' },
    timeout: '10s',
    responseCallback: http.expectedStatuses(200, 503),
  });

  readyDuration.add(ready.timings.duration, { status: String(ready.status) });
  const readyOk = ready.status === 200;

  check(ready, {
    'ready is 200': () => readyOk,
    'a failing probe failed as 503, not 500': (result) =>
      result.status === 200 || result.status === 503,
  });

  // A second, authenticated probe when credentials are available: readiness can
  // pass while an authenticated path fails, and the difference between the two
  // curves is what tells an operator whether the disruption reached users.
  const token = tokenForVu(tokens);
  const gardenId = pick(GARDEN_IDS);
  let readOk = true;

  if (token !== null && gardenId !== null) {
    const read = http.get(`${API}/gardens/${gardenId}`, {
      headers: authHeaders(token),
      tags: { name: 'gardens.get' },
      timeout: '10s',
    });
    readOk = read.status === 200;
    check(read, { 'authenticated read succeeded': () => readOk });
  }

  recordOutcome(readyOk && readOk);
}

export function teardown() {
  // A disruption that is still in progress when the run ends would otherwise
  // never be recorded, because the outage length is only emitted on recovery.
  if (consecutiveFailures > 0) {
    outageSeconds.add(consecutiveFailures * probeIntervalSeconds);
  }
}
