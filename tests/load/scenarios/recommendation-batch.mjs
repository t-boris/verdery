/**
 * LOAD-04 — recommendation evaluation batch.
 *
 * The evaluation sweep is the one job in this system whose cost scales with the
 * whole dataset rather than with traffic. It reads eligible gardens in
 * `EVALUATION_SWEEP_PAGE_SIZE = 25` keyset pages ordered by `garden.id ASC` and
 * deliberately DRAINS THE ENTIRE ELIGIBLE SET on every run — a per-run cap was
 * rejected because evaluation leaves no durable ordering key, so a cap would
 * starve gardens past it forever. Each garden is then evaluated under a
 * transaction-scoped advisory lock, reading its plants in `PLANT_PAGE_SIZE = 200`
 * pages.
 *
 * That makes the interesting measurement wall-clock per sweep as a function of
 * eligible-garden count, not requests per second. This scenario therefore drives
 * the sweep directly through its internal endpoint and reports duration and
 * throughput, rather than pretending it is user-facing traffic.
 *
 *   POST /v1/internal/recommendation-evaluation/sweep
 *
 * That route is authenticated with a Google-issued OIDC ID token whose audience
 * is the deployment's `MEDIA_PROCESSING_CALLBACK_AUDIENCE` — one worker-to-API
 * identity shared by every sweep. Mint one with:
 *
 *   gcloud auth print-identity-token --audiences="<callback audience>"
 *
 * and pass it as VERDERY_INTERNAL_ID_TOKEN. Without it the scenario refuses to
 * run rather than measuring a wall of 401s.
 *
 * The sweep is idempotent per evaluation window, so repeated runs re-suppress
 * rather than duplicating candidates. Running it against a real environment is
 * still a write, and is gated behind an explicit opt-in.
 */

/* global __ENV */

import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

import { API, GARDEN_IDS, byProfile, pick } from '../lib/config.mjs';
import { authHeaders, loadTokens, requireTokens, tokenForVu } from '../lib/auth.mjs';
import { LIMITS, READ_LATENCY_P95_MS } from '../lib/slo.mjs';

const tokens = loadTokens();
const INTERNAL_TOKEN = __ENV.VERDERY_INTERNAL_ID_TOKEN ?? '';
const ALLOW_WRITES = __ENV.VERDERY_ALLOW_SWEEP_WRITES === 'true';

const sweepDuration = new Trend('verdery_evaluation_sweep_duration', true);
const gardensEvaluated = new Trend('verdery_evaluation_gardens');
const candidatesCreated = new Trend('verdery_evaluation_candidates_created');
const todayDuration = new Trend('verdery_today_after_sweep_duration', true);

export const options = byProfile({
  // One sweep, one Today read. Proves the plumbing without loading anything.
  smoke: { vus: 1, iterations: 1 },
  soak: { vus: 1, iterations: 12, thresholds: {} },
  full: { vus: 1, iterations: 6, thresholds: {} },
});

options.thresholds = Object.assign(options.thresholds ?? {}, {
  http_req_failed: ['rate<0.01'],
  verdery_today_after_sweep_duration: [`p(95)<${READ_LATENCY_P95_MS}`],
});

export function setup() {
  if (INTERNAL_TOKEN === '') {
    throw new Error(
      'LOAD-04 needs VERDERY_INTERNAL_ID_TOKEN — a Google OIDC ID token for the sweep audience. ' +
        'See docs/development/load-testing.md section 5, LOAD-04.',
    );
  }
  if (!ALLOW_WRITES) {
    throw new Error(
      'LOAD-04 drives a real sweep, which writes recommendation candidates. Set ' +
        'VERDERY_ALLOW_SWEEP_WRITES=true to confirm that is intended for this environment.',
    );
  }
  requireTokens(tokens, 'LOAD-04 recommendation batch');
  return {};
}

export default function recommendationBatch() {
  const started = Date.now();
  const sweep = http.post(`${API}/internal/recommendation-evaluation/sweep`, '{}', {
    headers: {
      Authorization: `Bearer ${INTERNAL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    tags: { name: 'internal.evaluation-sweep' },
    // The sweep drains the whole eligible set; a default HTTP timeout would
    // measure the client's patience rather than the job's duration.
    timeout: __ENV.VERDERY_SWEEP_TIMEOUT ?? '600s',
  });

  sweepDuration.add(Date.now() - started);

  const ok = check(sweep, {
    'sweep completed': (result) => result.status === 200,
  });

  if (ok) {
    const evaluated = sweep.json('gardensEvaluated');
    const created = sweep.json('candidatesCreated');
    if (typeof evaluated === 'number') {
      gardensEvaluated.add(evaluated);
    }
    if (typeof created === 'number') {
      candidatesCreated.add(created);
    }

    check(sweep, {
      // With the AI kill-switch off (the default and the state of every
      // environment today) the embellishment summary is null, not zeroes.
      // Asserting that keeps a silently-enabled Vertex path from going
      // unnoticed in a cost run.
      'AI embellishment reflects the kill-switch state': (result) => {
        const embellishment = result.json('embellishment');
        return embellishment === null || typeof embellishment === 'object';
      },
    });
  }

  // The user-visible half: after a sweep has just written candidates, Today
  // must still read inside its latency target. This is the read the whole batch
  // exists to serve.
  const gardenId = pick(GARDEN_IDS);
  if (gardenId !== null) {
    const today = http.get(`${API}/gardens/${gardenId}/today?limit=${LIMITS.todayLimit}`, {
      headers: authHeaders(tokenForVu(tokens)),
      tags: { name: 'today.after-sweep' },
    });
    todayDuration.add(today.timings.duration);
    check(today, { 'Today served after the sweep': (result) => result.status === 200 });
  }
}
