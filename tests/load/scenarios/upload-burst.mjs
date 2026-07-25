/**
 * LOAD-03 — media upload burst.
 *
 * Models a capture session: a user photographs a bed and uploads ten to thirty
 * images in a couple of minutes. Exercises the real three-step flow, including
 * the part that does not touch the API at all.
 *
 *   1. POST .../media                register + open a resumable GCS session
 *   2. PUT  <resumable session URL>  bytes, direct to Cloud Storage
 *   3. POST .../media/{id}/complete  synchronous declared-versus-actual check
 *
 * Step 2 is the one worth being careful about. The API never touches upload
 * bytes: `createResumableUploadSession` returns a raw GCS session URL and
 * chunking is entirely the client's choice against the GCS resumable protocol —
 * there is no chunk-size constant anywhere in this repository. So this scenario
 * makes the chunk size an explicit knob (`VERDERY_UPLOAD_CHUNK_BYTES`) and
 * reports upload throughput separately from API latency, because they load
 * completely different systems and a blended number would be meaningless.
 *
 * Two behaviours this scenario is built to surface:
 *
 * - Registration performs NO size or MIME check. The API requires only a
 *   non-empty `declaredContentType` and a positive `declaredByteSize`; the real
 *   ceilings (25 MiB for `garden_photo`) live in the worker's validation policy
 *   and are applied asynchronously, after the bytes are already stored. A burst
 *   of oversized registrations is therefore accepted, billed, and rejected
 *   later — which is exactly threat-model.md `T-COST-03`.
 * - The quota ledger reserves bytes at registration and compares them to
 *   nothing. `VERDERY_UPLOAD_OVERSIZE=true` registers above the class ceiling to
 *   demonstrate both facts in one run.
 */

/* global __ENV */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

import { API, GARDEN_IDS, between, byProfile, pick, uuid } from '../lib/config.mjs';
import { authHeaders, loadTokens, requireTokens, tokenForVu } from '../lib/auth.mjs';
import {
  LIMITS,
  MAX_REQUEST_FAILURE_RATE,
  MAX_UPLOAD_REJECTION_RATE,
  MUTATION_LATENCY_P95_MS,
} from '../lib/slo.mjs';

const tokens = loadTokens();

const PHOTOS_PER_SESSION = Number(__ENV.VERDERY_PHOTOS_PER_SESSION ?? '5');
const CHUNK_BYTES = Number(__ENV.VERDERY_UPLOAD_CHUNK_BYTES ?? String(8 * 1024 * 1024));
const OVERSIZE = __ENV.VERDERY_UPLOAD_OVERSIZE === 'true';
const PHOTO_BYTES = OVERSIZE
  ? LIMITS.gardenPhotoMaxBytes + 1
  : Number(__ENV.VERDERY_PHOTO_BYTES ?? String(2 * 1024 * 1024));

const registerDuration = new Trend('verdery_media_register_duration', true);
const completeDuration = new Trend('verdery_media_complete_duration', true);
const uploadDuration = new Trend('verdery_media_upload_duration', true);
const uploadedBytes = new Counter('verdery_media_uploaded_bytes');
const completionRejected = new Rate('verdery_media_completion_rejected');

export const options = byProfile({
  smoke: { vus: 1, iterations: 1 },
  soak: { vus: 2, duration: '30m' },
  full: {
    scenarios: {
      capture_sessions: {
        executor: 'ramping-arrival-rate',
        startRate: 1,
        timeUnit: '1m',
        preAllocatedVUs: 20,
        maxVUs: 80,
        stages: [
          { duration: '2m', target: 10 },
          { duration: '10m', target: 40 },
          { duration: '2m', target: 0 },
        ],
      },
    },
  },
});

options.thresholds = {
  http_req_failed: [`rate<${MAX_REQUEST_FAILURE_RATE}`],
  verdery_media_register_duration: [`p(95)<${MUTATION_LATENCY_P95_MS}`],
  verdery_media_complete_duration: [`p(95)<${MUTATION_LATENCY_P95_MS}`],
  verdery_media_completion_rejected: [`rate<${MAX_UPLOAD_REJECTION_RATE}`],
};

export function setup() {
  requireTokens(tokens, 'LOAD-03 upload burst');
  if (GARDEN_IDS.length === 0) {
    throw new Error('LOAD-03 needs VERDERY_GARDEN_IDS.');
  }
  if (OVERSIZE) {
    // Deliberate, opt-in, and worth saying out loud: this mode stores bytes
    // that the pipeline will reject later, so it costs real storage.
    console.warn(
      `VERDERY_UPLOAD_OVERSIZE is set: registering ${PHOTO_BYTES} bytes per photo, above the ` +
        `${LIMITS.gardenPhotoMaxBytes}-byte garden_photo ceiling. Rejection happens after upload.`,
    );
  }
  return {};
}

/**
 * Deterministic filler bytes.
 *
 * NOT a valid JPEG: deep validation is a worker-side concern and is expected to
 * reject these. This scenario measures the transport and the synchronous
 * declared-versus-actual check, and `VERDERY_MEDIA_FIXTURE` supplies a real
 * image when the asynchronous pipeline is what is under test instead.
 */
function chunkBody(size) {
  return new Uint8Array(size).buffer;
}

function uploadBytes(sessionUrl, totalBytes) {
  const started = Date.now();
  let offset = 0;

  while (offset < totalBytes) {
    const length = Math.min(CHUNK_BYTES, totalBytes - offset);
    const last = offset + length >= totalBytes;

    const response = http.put(sessionUrl, chunkBody(length), {
      headers: {
        'Content-Length': String(length),
        'Content-Range': `bytes ${offset}-${offset + length - 1}/${totalBytes}`,
      },
      tags: { name: 'gcs.resumable.put' },
      // 308 Resume Incomplete is the protocol's success code for a non-final
      // chunk. Counting it as a failure would make every chunked upload look
      // like an outage.
      responseCallback: http.expectedStatuses(200, 201, 308),
    });

    check(response, {
      'chunk accepted': (result) =>
        last ? result.status === 200 || result.status === 201 : result.status === 308,
    });

    offset += length;
    uploadedBytes.add(length);
  }

  uploadDuration.add(Date.now() - started, { chunkBytes: String(CHUNK_BYTES) });
}

export default function uploadBurst() {
  const token = tokenForVu(tokens);
  const gardenId = pick(GARDEN_IDS);

  for (let index = 0; index < PHOTOS_PER_SESSION; index += 1) {
    const registration = http.post(
      `${API}/gardens/${gardenId}/media`,
      JSON.stringify({
        mediaClass: 'garden_photo',
        declaredContentType: 'image/jpeg',
        declaredByteSize: PHOTO_BYTES,
        displayFilename: `load-${uuid()}.jpg`,
      }),
      {
        headers: authHeaders(token, { 'Idempotency-Key': uuid() }),
        tags: { name: 'media.register' },
      },
    );

    registerDuration.add(registration.timings.duration);
    const registered = check(registration, {
      'registration accepted': (result) => result.status === 200 || result.status === 201,
      'registration returned an upload session': (result) =>
        typeof result.json('upload.url') === 'string',
    });

    if (!registered) {
      continue;
    }

    const mediaId = registration.json('media.id') ?? registration.json('id');
    uploadBytes(registration.json('upload.url'), PHOTO_BYTES);

    const completion = http.post(
      `${API}/gardens/${gardenId}/media/${mediaId}/complete`,
      JSON.stringify({ byteSize: PHOTO_BYTES }),
      {
        headers: authHeaders(token, { 'Idempotency-Key': uuid() }),
        tags: { name: 'media.complete' },
        responseCallback: http.expectedStatuses(200, 409, 422),
      },
    );

    completeDuration.add(completion.timings.duration);
    completionRejected.add(completion.status !== 200);
    check(completion, {
      'completion produced a typed outcome': (result) =>
        result.status === 200 || result.status === 409 || result.status === 422,
    });

    sleep(between(1, 4));
  }
}
