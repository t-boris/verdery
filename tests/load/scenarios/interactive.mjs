/**
 * LOAD-01 — interactive read/write.
 *
 * Models one person using the product: open the app, read the garden list,
 * open a garden, read Today, read the plant inventory and task list, then
 * occasionally complete a task. The read/write ratio is roughly 9:1, which is
 * what the care loop's own shape implies — a user looks at Today far more often
 * than they change anything.
 *
 * Measures SLI-2 (read latency) and SLI-3 (mutation latency) separately, using
 * per-request tags, because a single blended p95 hides exactly the regression
 * these two SLOs exist to catch.
 *
 * Preconditions: a token pool and at least one garden id. See
 * docs/development/load-testing.md section 4.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

import { API, GARDEN_IDS, between, byProfile, pick, uuid } from '../lib/config.mjs';
import { authHeaders, loadTokens, requireTokens, tokenForVu } from '../lib/auth.mjs';
import {
  LIMITS,
  MAX_REQUEST_FAILURE_RATE,
  MUTATION_LATENCY_P95_MS,
  MUTATION_LATENCY_P99_MS,
  READ_LATENCY_P95_MS,
  READ_LATENCY_P99_MS,
} from '../lib/slo.mjs';

const tokens = loadTokens();

const readDuration = new Trend('verdery_read_duration', true);
const mutationDuration = new Trend('verdery_mutation_duration', true);

export const options = byProfile({
  smoke: { vus: 1, iterations: 3 },
  soak: { vus: 5, duration: '30m' },
  full: {
    stages: [
      { duration: '2m', target: 20 },
      { duration: '10m', target: 20 },
      { duration: '2m', target: 60 },
      { duration: '10m', target: 60 },
      { duration: '2m', target: 0 },
    ],
  },
});

options.thresholds = {
  http_req_failed: [`rate<${MAX_REQUEST_FAILURE_RATE}`],
  verdery_read_duration: [`p(95)<${READ_LATENCY_P95_MS}`, `p(99)<${READ_LATENCY_P99_MS}`],
  verdery_mutation_duration: [
    `p(95)<${MUTATION_LATENCY_P95_MS}`,
    `p(99)<${MUTATION_LATENCY_P99_MS}`,
  ],
};

export function setup() {
  requireTokens(tokens, 'LOAD-01 interactive');
  if (GARDEN_IDS.length === 0) {
    throw new Error('LOAD-01 needs VERDERY_GARDEN_IDS — at least one garden the tokens can read.');
  }
  return {};
}

function read(url, name, headers) {
  const response = http.get(url, { headers, tags: { name, kind: 'read' } });
  readDuration.add(response.timings.duration, { name });
  check(response, { [`${name} succeeded`]: (result) => result.status === 200 });
  return response;
}

export default function interactive() {
  const token = tokenForVu(tokens);
  const headers = authHeaders(token);
  const gardenId = pick(GARDEN_IDS);

  // 1. Cold open: the garden list is the first authenticated call every client
  //    makes, and it is the one that also proves the session still works.
  read(`${API}/gardens?limit=${LIMITS.pageLimit}`, 'gardens.list', headers);
  sleep(between(1, 3));

  // 2. Today — the product's central read. Uses the contract maximum so the
  //    measurement is of the worst legal page, not the 10-item default.
  const today = read(
    `${API}/gardens/${gardenId}/today?limit=${LIMITS.todayLimit}`,
    'today.get',
    headers,
  );
  sleep(between(2, 6));

  // 3. Inventory and work list — the two heaviest ordinary reads.
  read(`${API}/gardens/${gardenId}/plants?limit=${LIMITS.pageLimit}`, 'plants.list', headers);
  read(`${API}/gardens/${gardenId}/tasks`, 'tasks.list', headers);
  sleep(between(1, 4));

  // 4. One mutation in roughly ten iterations: complete a presented
  //    recommendation if Today served one, which is the care loop's own
  //    primary write. Every mutation carries an Idempotency-Key, as the
  //    contract requires.
  const items = today.status === 200 ? today.json('items') : null;
  const candidate = Array.isArray(items) && items.length > 0 ? items[0] : null;

  if (candidate !== null && between(1, 10) === 1) {
    const url = `${API}/gardens/${gardenId}/recommendations/${candidate.id}/complete`;
    const response = http.post(url, JSON.stringify({}), {
      headers: authHeaders(token, { 'Idempotency-Key': uuid() }),
      tags: { name: 'recommendation.complete', kind: 'mutation' },
    });
    mutationDuration.add(response.timings.duration, { name: 'recommendation.complete' });
    check(response, {
      'recommendation completion accepted': (result) =>
        result.status === 200 || result.status === 409,
    });
  }

  sleep(between(3, 10));
}
