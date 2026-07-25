/**
 * LOAD-05 — provider slowdown.
 *
 * The architectural property under test: **no user-facing request ever blocks
 * on an external provider.** Every provider call in this system happens inside a
 * worker-driven sweep — weather refresh, AI explanation embellishment — never
 * inside a request the user is waiting on. If that holds, a slow or failing
 * provider degrades freshness, not availability, and every provider outage
 * becomes a background problem rather than an incident.
 *
 * This scenario tests exactly that, by holding steady interactive read traffic
 * while driving the provider-calling sweep concurrently, and asserting that the
 * read path stays inside SLI-2.
 *
 * **What this scenario can and cannot measure today, stated precisely.**
 *
 * Zero providers are registered: `compose-integrations.ts` constructs
 * `new WeatherProviderRegistry([])`, `WEATHER_ACTIVE_PROVIDER_KEY` is unset in
 * every environment, and the AI kill-switch `RECOMMENDATION_AI_EXPLANATION_ENABLED`
 * defaults to false. So today the sweep's outcome is the typed
 * `noProviderConfigured` degradation for every considered garden, and this run
 * measures the FLOOR: the cost of the sweep with no provider latency in it at
 * all. That is still worth having — it is the baseline any later measurement is
 * compared against, and it proves the assertion mechanism works.
 *
 * The other half is blocked, not deferred: inducing real provider latency needs
 * a provider to exist (`P0-PROV-01`, undecided). When one is selected, point its
 * registration's base URL at `tests/load/stub/slow-provider.mjs` (a Node server
 * with a delay knob) in a staging deployment and re-run this unchanged script —
 * the assertions are already the right ones. Note that a provider registration
 * carries a `fetchTimeoutMs` with NO default: the deadline is per-registration,
 * so "how slow is too slow" is a per-provider decision this scenario will
 * measure rather than assume.
 */

/* global __ENV */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import { API, GARDEN_IDS, between, byProfile, pick } from '../lib/config.mjs';
import { authHeaders, loadTokens, requireTokens, tokenForVu } from '../lib/auth.mjs';
import { LIMITS, READ_LATENCY_P95_MS, READ_LATENCY_P99_MS } from '../lib/slo.mjs';

const tokens = loadTokens();
const INTERNAL_TOKEN = __ENV.VERDERY_INTERNAL_ID_TOKEN ?? '';

const readDuration = new Trend('verdery_read_during_provider_load', true);
const weatherSweepDuration = new Trend('verdery_weather_sweep_duration', true);

export const options = byProfile({
  smoke: {
    scenarios: {
      readers: { executor: 'constant-vus', vus: 1, duration: '20s', exec: 'reader' },
      sweeper: { executor: 'per-vu-iterations', vus: 1, iterations: 1, exec: 'sweeper' },
    },
  },
  soak: {
    scenarios: {
      readers: { executor: 'constant-vus', vus: 5, duration: '30m', exec: 'reader' },
      sweeper: {
        executor: 'constant-arrival-rate',
        rate: 1,
        timeUnit: '5m',
        duration: '30m',
        preAllocatedVUs: 2,
        exec: 'sweeper',
      },
    },
  },
  full: {
    scenarios: {
      readers: { executor: 'constant-vus', vus: 25, duration: '15m', exec: 'reader' },
      sweeper: {
        executor: 'constant-arrival-rate',
        rate: 1,
        timeUnit: '1m',
        duration: '15m',
        preAllocatedVUs: 4,
        exec: 'sweeper',
      },
    },
  },
});

options.thresholds = {
  // The whole point: reads must hold their SLO while the provider path is busy.
  verdery_read_during_provider_load: [
    `p(95)<${READ_LATENCY_P95_MS}`,
    `p(99)<${READ_LATENCY_P99_MS}`,
  ],
};

export function setup() {
  requireTokens(tokens, 'LOAD-05 provider slowdown');
  if (GARDEN_IDS.length === 0) {
    throw new Error('LOAD-05 needs VERDERY_GARDEN_IDS.');
  }
  if (INTERNAL_TOKEN === '') {
    throw new Error('LOAD-05 needs VERDERY_INTERNAL_ID_TOKEN for the weather-refresh sweep.');
  }
  return {};
}

/** Steady interactive read traffic — the thing that must not degrade. */
export function reader() {
  const headers = authHeaders(tokenForVu(tokens));
  const gardenId = pick(GARDEN_IDS);

  const today = http.get(`${API}/gardens/${gardenId}/today?limit=${LIMITS.todayLimit}`, {
    headers,
    tags: { name: 'today.get' },
  });
  readDuration.add(today.timings.duration, { name: 'today.get' });
  check(today, { 'Today served during provider load': (result) => result.status === 200 });

  const gardens = http.get(`${API}/gardens?limit=${LIMITS.pageLimit}`, {
    headers,
    tags: { name: 'gardens.list' },
  });
  readDuration.add(gardens.timings.duration, { name: 'gardens.list' });

  sleep(between(1, 3));
}

/** The provider-calling background work. */
export function sweeper() {
  const started = Date.now();
  const response = http.post(`${API}/internal/weather-refresh/sweep`, '{}', {
    headers: { Authorization: `Bearer ${INTERNAL_TOKEN}`, 'Content-Type': 'application/json' },
    tags: { name: 'internal.weather-sweep' },
    timeout: __ENV.VERDERY_SWEEP_TIMEOUT ?? '300s',
  });
  weatherSweepDuration.add(Date.now() - started);

  check(response, {
    'weather sweep completed': (result) => result.status === 200,
    // With no provider configured, every considered garden degrades with the
    // typed `noProviderConfigured` reason. Asserting the SHAPE (not a count)
    // keeps this check honest once a provider does exist.
    'sweep reported typed degradation reasons': (result) =>
      result.status !== 200 || typeof result.json('degradationReasons') === 'object',
    'sweep reported whether it stopped on quota': (result) =>
      result.status !== 200 || typeof result.json('stoppedOnQuotaExhaustion') === 'boolean',
  });
}
