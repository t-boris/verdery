/**
 * LOAD-00 — harness smoke test.
 *
 * Unauthenticated, single virtual user, a handful of iterations. This is the
 * ONLY scenario in this directory that is safe to point at `verdery-dev`
 * without further thought: it touches the two health endpoints and one
 * deliberate 404, all of which are unauthenticated by design and none of which
 * writes anything.
 *
 * Its job is to prove the harness works — that k6 is installed, that
 * VERDERY_BASE_URL resolves, that the /v1 prefix is right, and that the
 * threshold plumbing reports. It is not a capacity measurement.
 *
 *   k6 run -e VERDERY_BASE_URL=https://... tests/load/scenarios/smoke.mjs
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

import { API, BASE_URL, byProfile } from '../lib/config.mjs';
import { READ_LATENCY_P95_MS } from '../lib/slo.mjs';

export const options = byProfile({
  smoke: {
    vus: 1,
    iterations: 5,
    thresholds: {
      // Only the two health calls are counted; the deliberate 404 below is
      // marked as an expected response so it does not pollute the rate.
      http_req_failed: ['rate<0.01'],
      http_req_duration: [`p(95)<${READ_LATENCY_P95_MS}`],
    },
  },
  soak: { vus: 1, duration: '10m', thresholds: { http_req_failed: ['rate<0.01'] } },
  full: { vus: 1, iterations: 20, thresholds: { http_req_failed: ['rate<0.01'] } },
});

export default function smoke() {
  const live = http.get(`${API}/health/live`, { tags: { name: 'health/live' } });
  check(live, {
    'live is 200': (response) => response.status === 200,
    'live reports alive': (response) => response.json('status') === 'alive',
    'live carries a version': (response) => typeof response.json('version') === 'string',
  });

  const ready = http.get(`${API}/health/ready`, { tags: { name: 'health/ready' } });
  check(ready, {
    'ready is 200': (response) => response.status === 200,
    'ready reports ready': (response) => response.json('status') === 'ready',
    'database dependency is available': (response) => {
      const dependencies = response.json('dependencies');
      if (!Array.isArray(dependencies)) {
        return false;
      }
      return dependencies.some(
        (entry) => entry.name === 'database' && entry.status === 'available',
      );
    },
  });

  // The /v1 prefix is load-bearing: /health/ready at the root is a 404, and
  // that 404 is also how this harness proves it is reading the real error
  // envelope rather than a proxy's generic page.
  const rootProbe = http.get(`${BASE_URL}/health/ready`, {
    tags: { name: 'root/health-404' },
    responseCallback: http.expectedStatuses(404),
  });
  check(rootProbe, {
    'root health is 404': (response) => response.status === 404,
    'error envelope carries a correlation id': (response) =>
      typeof response.json('error.correlationId') === 'string',
    'error envelope declares retryability': (response) =>
      typeof response.json('error.retryable') === 'boolean',
  });

  sleep(1);
}
