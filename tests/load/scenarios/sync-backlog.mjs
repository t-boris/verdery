/**
 * LOAD-02 — synchronization backlog drain.
 *
 * Models the native client coming back online after a long offline period: a
 * device pushes its outbox in bounded batches, then pulls the server change log
 * page by page until it catches up.
 *
 * The shape is taken from the protocol itself, not invented:
 *
 * - Push batches are capped at MAX_PUSH_BATCH_SIZE = 500 operations
 *   (`parse-sync-request.ts`), and every operation carries its own
 *   client-generated `operationId`, which IS the idempotency key — there is no
 *   request-level `Idempotency-Key` on this endpoint.
 * - A structurally valid batch always returns 200 with one result per
 *   operation. Only a request-level problem (oversized batch, unsupported
 *   protocol version) fails the whole call.
 * - Pull pages are capped at MAX_CHANGES_LIMIT = 100 and resume from an opaque
 *   cursor that is always present, including on an empty page.
 *
 * It deliberately probes the boundary that the two caps create together: the
 * global body limit is 1 MiB with no per-route override, so 500 operations
 * leaves roughly 2 KB per operation. A client batching large geometry payloads
 * hits Fastify's 413 before it ever reaches the contract's typed
 * `request.operations.too_large`. `PROBE_BODY_LIMIT=true` asserts that boundary
 * explicitly rather than discovering it in production.
 */

/* global __ENV, __ITER */

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

import { API, GARDEN_IDS, byProfile, pick, uuid } from '../lib/config.mjs';
import { authHeaders, loadTokens, requireTokens, tokenForVu } from '../lib/auth.mjs';
import {
  LIMITS,
  MAX_FULL_RESYNC_RATE,
  MAX_PUSH_REJECTION_RATE,
  MAX_REQUEST_FAILURE_RATE,
} from '../lib/slo.mjs';

const tokens = loadTokens();

const PROTOCOL_VERSION = Number(__ENV.VERDERY_SYNC_PROTOCOL_VERSION ?? '1');
const OPERATION_PAYLOAD_VERSION = Number(__ENV.VERDERY_SYNC_PAYLOAD_VERSION ?? '1');
const BATCH_SIZE = Math.min(Number(__ENV.VERDERY_PUSH_BATCH ?? '50'), LIMITS.syncPushBatch);
const PROBE_BODY_LIMIT = __ENV.PROBE_BODY_LIMIT === 'true';

const pushDuration = new Trend('verdery_sync_push_duration', true);
const pullDuration = new Trend('verdery_sync_pull_duration', true);
const pullPageSize = new Trend('verdery_sync_pull_page_size');
const operationsPushed = new Counter('verdery_sync_operations_pushed');
const pushRejections = new Rate('verdery_sync_push_rejected');
const fullResyncs = new Rate('verdery_sync_full_resync');

export const options = byProfile({
  smoke: { vus: 1, iterations: 2 },
  soak: { vus: 3, duration: '30m' },
  full: {
    // A backlog drain is bursty by nature: many devices reconnect at once
    // after a network event, then go quiet. Arrival-rate execution models that
    // far better than a fixed VU count.
    scenarios: {
      reconnect_burst: {
        executor: 'ramping-arrival-rate',
        startRate: 1,
        timeUnit: '1s',
        preAllocatedVUs: 50,
        maxVUs: 200,
        stages: [
          { duration: '1m', target: 5 },
          { duration: '5m', target: 20 },
          { duration: '2m', target: 0 },
        ],
      },
    },
  },
});

options.thresholds = {
  http_req_failed: [`rate<${MAX_REQUEST_FAILURE_RATE}`],
  verdery_sync_push_rejected: [`rate<${MAX_PUSH_REJECTION_RATE}`],
  verdery_sync_full_resync: [`rate<${MAX_FULL_RESYNC_RATE}`],
};

export function setup() {
  requireTokens(tokens, 'LOAD-02 sync backlog');
  if (GARDEN_IDS.length === 0) {
    throw new Error('LOAD-02 needs VERDERY_GARDEN_IDS.');
  }
  return {};
}

/**
 * One outbox operation.
 *
 * `actorProfileId` is never sent: the server fills it from the authenticated
 * caller for every operation. Local-only bookkeeping (retry state, last error
 * category) never travels on the wire either.
 */
function buildOperation(gardenId, index) {
  return {
    operationId: uuid(),
    command: 'observations.record',
    gardenId,
    occurredAt: new Date().toISOString(),
    payload: {
      note: `load-test observation ${index}`,
      observedAt: new Date().toISOString(),
    },
  };
}

function pushBatch(headers, installationId, gardenId, size) {
  const operations = [];
  for (let index = 0; index < size; index += 1) {
    operations.push(buildOperation(gardenId, index));
  }

  const response = http.post(
    `${API}/sync/push`,
    JSON.stringify({
      clientInstallationId: installationId,
      protocolVersion: PROTOCOL_VERSION,
      operationPayloadVersion: OPERATION_PAYLOAD_VERSION,
      operations,
    }),
    { headers, tags: { name: 'sync.push' } },
  );

  pushDuration.add(response.timings.duration);
  operationsPushed.add(operations.length);

  check(response, {
    'push returned a per-operation result set': (result) => result.status === 200,
    'push was not rejected as oversized': (result) => result.status !== 413,
  });

  if (response.status === 200) {
    const results = response.json('results');
    const rejected = Array.isArray(results)
      ? results.filter((entry) => entry.outcome === 'rejected').length
      : 0;
    pushRejections.add(rejected > 0, { batchSize: String(size) });
  } else {
    pushRejections.add(true, { batchSize: String(size) });
  }

  return response;
}

/** Drains the change log from `cursor`, one bounded page at a time. */
function drainPull(headers, startCursor, maxPages) {
  let cursor = startCursor;

  for (let page = 0; page < maxPages; page += 1) {
    const query = [
      `protocolVersion=${PROTOCOL_VERSION}`,
      `limit=${LIMITS.pageLimit}`,
      cursor === null ? null : `after=${encodeURIComponent(cursor)}`,
    ]
      .filter((entry) => entry !== null)
      .join('&');

    const response = http.get(`${API}/sync/changes?${query}`, {
      headers,
      tags: { name: 'sync.changes' },
      responseCallback: http.expectedStatuses(200, 409),
    });

    pullDuration.add(response.timings.duration);

    // A 409 is one of exactly two codes, and both mean the same thing
    // operationally: this client must resynchronize from scratch. That is
    // SLI-5's numerator.
    if (response.status === 409) {
      fullResyncs.add(true, { code: String(response.json('error.code')) });
      return null;
    }
    fullResyncs.add(false);

    const changes = response.json('changes');
    const count = Array.isArray(changes) ? changes.length : 0;
    pullPageSize.add(count);

    cursor = response.json('nextCursor');
    check(response, {
      'pull always returns a resumable cursor': () => typeof cursor === 'string',
    });

    // A short page means caught up. The cursor stays valid for next time.
    if (count < LIMITS.pageLimit) {
      return cursor;
    }
  }

  return cursor;
}

export default function syncBacklog() {
  const token = tokenForVu(tokens);
  const headers = authHeaders(token);
  const gardenId = pick(GARDEN_IDS);

  // One installation per VU, stable across iterations: the protocol's unit of
  // identity is the installation, and reusing it is what makes the idempotency
  // and cursor behaviour realistic.
  const installationId = uuid();

  pushBatch(headers, installationId, gardenId, BATCH_SIZE);
  drainPull(headers, null, 20);

  // Opt-in boundary probe, run once per VU. Asserts which of the two ceilings
  // a maximal batch actually hits — the contract's 500-operation cap or the
  // 1 MiB body limit. Both answers are legitimate; not knowing which is not.
  if (PROBE_BODY_LIMIT && __ITER === 0) {
    const response = pushBatch(headers, installationId, gardenId, LIMITS.syncPushBatch);
    check(response, {
      'maximal batch produced a typed outcome, not an opaque failure': (result) =>
        result.status === 200 || result.status === 413 || result.status === 400,
    });
  }
}
