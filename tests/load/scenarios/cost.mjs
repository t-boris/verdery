/**
 * LOAD-07 — unit-cost measurement.
 *
 * P8-LOAD-01's completion evidence is a "capacity and unit-cost report". Cost
 * cannot be measured from inside a load generator — the number lives in Cloud
 * Billing. What a load generator CAN do is produce a precisely counted,
 * reproducible unit of work with clean start and end timestamps, so the billing
 * delta over that window divides by a known denominator.
 *
 * That is all this scenario does: it performs exactly N of each countable
 * operation and prints the counts and the window in its summary. The cost
 * arithmetic then happens outside, against the billing export, and is written
 * up per docs/development/load-testing.md section 6.
 *
 * The costed unit is deliberately "one active garden-day": one garden's worth of
 * a day's interactive reads, mutations, sync round trips, and media
 * registrations. Per-request cost is not a useful unit for this product,
 * because the dominant costs are storage bytes and the evaluation sweep, which
 * scale with dataset rather than traffic.
 *
 * **Cost anomaly warning that applies to every run.** `billingbudgets` is NOT an
 * enabled API on `verdery-dev`, so **no budget exists and none can be created**
 * (runbooks.md section 1.6, RB-08). There is no automatic ceiling on what this
 * scenario can spend. Run it against a project with a budget, or run it small.
 */

/* global __ENV */

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

import { API, GARDEN_IDS, byProfile, pick, uuid } from '../lib/config.mjs';
import { authHeaders, loadTokens, requireTokens, tokenForVu } from '../lib/auth.mjs';
import { LIMITS } from '../lib/slo.mjs';

const tokens = loadTokens();

const READS_PER_DAY = Number(__ENV.VERDERY_READS_PER_GARDEN_DAY ?? '40');
const MUTATIONS_PER_DAY = Number(__ENV.VERDERY_MUTATIONS_PER_GARDEN_DAY ?? '5');
const MEDIA_PER_DAY = Number(__ENV.VERDERY_MEDIA_PER_GARDEN_DAY ?? '3');
const MEDIA_BYTES = Number(__ENV.VERDERY_PHOTO_BYTES ?? String(2 * 1024 * 1024));

const gardenDays = new Counter('verdery_cost_garden_days');
const reads = new Counter('verdery_cost_reads');
const mutations = new Counter('verdery_cost_mutations');
const mediaRegistrations = new Counter('verdery_cost_media_registrations');
const declaredMediaBytes = new Counter('verdery_cost_declared_media_bytes');

export const options = byProfile({
  smoke: { vus: 1, iterations: 1 },
  soak: { vus: 2, iterations: 20 },
  full: { vus: 10, iterations: 200 },
});

// No thresholds. A cost run is not pass/fail; it is a measurement.
options.thresholds = { http_req_failed: ['rate<0.05'] };

export function setup() {
  requireTokens(tokens, 'LOAD-07 cost');
  if (GARDEN_IDS.length === 0) {
    throw new Error('LOAD-07 needs VERDERY_GARDEN_IDS.');
  }
  const startedAt = new Date().toISOString();
  console.warn(`LOAD-07 cost window opened at ${startedAt} — record this for the billing query.`);
  return { startedAt };
}

/** One simulated garden-day of activity. */
export default function costUnit() {
  const token = tokenForVu(tokens);
  const headers = authHeaders(token);
  const gardenId = pick(GARDEN_IDS);

  for (let index = 0; index < READS_PER_DAY; index += 1) {
    // Today dominates real read traffic, so it dominates the costed mix.
    const url =
      index % 4 === 0
        ? `${API}/gardens?limit=${LIMITS.pageLimit}`
        : `${API}/gardens/${gardenId}/today?limit=${LIMITS.todayLimit}`;
    const response = http.get(url, { headers, tags: { name: 'cost.read' } });
    reads.add(1);
    check(response, { 'costed read succeeded': (result) => result.status === 200 });
  }

  for (let index = 0; index < MUTATIONS_PER_DAY; index += 1) {
    const response = http.post(
      `${API}/gardens/${gardenId}/observations`,
      JSON.stringify({
        observedAt: new Date().toISOString(),
        note: `cost run ${index}`,
      }),
      {
        headers: authHeaders(token, { 'Idempotency-Key': uuid() }),
        tags: { name: 'cost.mutation' },
      },
    );
    mutations.add(1);
    check(response, {
      'costed mutation succeeded': (result) => result.status === 200 || result.status === 201,
    });
  }

  for (let index = 0; index < MEDIA_PER_DAY; index += 1) {
    const response = http.post(
      `${API}/gardens/${gardenId}/media`,
      JSON.stringify({
        mediaClass: 'garden_photo',
        declaredContentType: 'image/jpeg',
        declaredByteSize: MEDIA_BYTES,
        displayFilename: `cost-${uuid()}.jpg`,
      }),
      {
        headers: authHeaders(token, { 'Idempotency-Key': uuid() }),
        tags: { name: 'cost.media_register' },
      },
    );
    mediaRegistrations.add(1);
    declaredMediaBytes.add(MEDIA_BYTES);
    check(response, {
      'costed registration succeeded': (result) => result.status === 200 || result.status === 201,
    });
  }

  gardenDays.add(1);
}

export function teardown(data) {
  const endedAt = new Date().toISOString();
  console.warn(
    `LOAD-07 cost window: ${data.startedAt} .. ${endedAt}. ` +
      'Divide the Cloud Billing delta for this window by verdery_cost_garden_days ' +
      'to obtain cost per active garden-day. Storage cost accrues AFTER the window ' +
      'and must be read separately from the bucket metrics — see load-testing.md section 6.',
  );
}
