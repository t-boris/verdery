#!/usr/bin/env node
/**
 * Manual, one-off verification of the REAL `GcsMediaStorageGateway` adapter
 * against the real `verdery-dev-user-media` Cloud Storage bucket.
 *
 * NOT part of the automated test suite and NOT wired into CI. This is a
 * deliberate call, not an oversight: `pnpm test` runs on every developer's
 * laptop and on every CI job, and none of those environments are guaranteed
 * to hold Cloud Storage write credentials for `verdery-dev` (the CI
 * service account's own permission set is scoped to the deploy pipeline,
 * confirmed not audited for this specific object-write case) — the same
 * "07-iam-database-bootstrap.sh / 09-media-storage.sh were verified with
 * real gcloud calls but never wired into automated CI" precedent this
 * session's own P6-PLAT-01 stage already established for infrastructure-
 * adjacent code. `tests/integration/media-upload-flow.test.ts` already
 * proves the STATE MACHINE and AUTHORIZATION logic against real Postgres
 * with a fake gateway — that is what CI runs on every push. This script
 * proves the one thing a fake cannot: that the real
 * `@google-cloud/storage`-backed calls this adapter makes actually work
 * against a real bucket, using the runtime's own real authentication
 * posture (Application Default Credentials, no service-account key).
 *
 * Run manually, locally, by a developer with `gcloud auth application-
 * default login` already done and appropriate IAM on `verdery-dev`:
 *
 *   pnpm --filter @verdery/api build
 *   node scripts/verify-real-gcs-media-gateway.mjs
 *
 * Exercises every `MediaStorageGateway` method in sequence against one real,
 * clearly-labeled test object, then deletes it — leaving no real cost-
 * incurring data behind. Exits non-zero on any step's failure.
 *
 * `MEDIA_VERIFY_IMPERSONATE_SERVICE_ACCOUNT`: optional. Set to
 * `verdery-dev-api-runtime@verdery-dev.iam.gserviceaccount.com` to run the
 * verification AS the real runtime service account (via short-lived IAM
 * impersonation of the developer's own ADC — no long-lived key, matching
 * section 18's "No long-lived service-account keys"), instead of as the
 * developer's own user identity. This matters concretely for
 * `createSignedDownloadUrl`: V4 URL signing requires a credential with a
 * `client_email` (a service account), which an ordinary user ADC credential
 * does not carry ("Cannot sign data without `client_email`", confirmed
 * directly running this script unimpersonated) — Cloud Run's own runtime
 * identity IS a service account, so this failure mode is specific to
 * personal-developer verification, not a defect, but real signing must
 * still be verified against a real service-account identity to be a
 * faithful check, not skipped.
 */

import { randomUUID } from 'node:crypto';
import https from 'node:https';
import { Storage } from '@google-cloud/storage';
import { GoogleAuth, Impersonated } from 'google-auth-library';
import { GcsMediaStorageGateway } from '../dist/modules/media/persistence/gcs-media-storage-gateway.js';

/**
 * Plain `https.request`, not the global `fetch` — this repository's shared
 * `eslint.config.mjs` deliberately types only a minimal global set for
 * `.mjs` scripts (`console`, `process`, `URL`, `Buffer`, ...), and adding
 * `fetch` to that shared list for every script in the monorepo is a larger
 * footprint than this one diagnostic tool needs. Two small helpers instead.
 */
function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.on('error', reject);
    if (body !== undefined) {
      request.write(body);
    }
    request.end();
  });
}

const IMPERSONATE_SERVICE_ACCOUNT = process.env.MEDIA_VERIFY_IMPERSONATE_SERVICE_ACCOUNT ?? null;
const BUCKET_NAME = process.env.MEDIA_VERIFY_BUCKET ?? 'verdery-dev-user-media';
const OBJECT_KEY = `manual-verification/p6-api-01/${randomUUID()}`;
const CONTENT_TYPE = 'text/plain';
const PAYLOAD = `P6-API-01 real-GCS gateway verification — ${new Date().toISOString()}\n`;
const PAYLOAD_BYTES = Buffer.byteLength(PAYLOAD, 'utf8');

const target = { bucketName: BUCKET_NAME, objectKey: OBJECT_KEY };

function log(step, message) {
  process.stdout.write(`[${step}] ${message}\n`);
}

function fail(step, message) {
  process.stderr.write(`[${step}] FAIL: ${message}\n`);
  process.exitCode = 1;
}

async function buildStorageClient() {
  if (IMPERSONATE_SERVICE_ACCOUNT === null) {
    return new Storage();
  }

  const auth = new GoogleAuth();
  const sourceClient = await auth.getClient();
  const authClient = new Impersonated({
    sourceClient,
    targetPrincipal: IMPERSONATE_SERVICE_ACCOUNT,
    targetScopes: ['https://www.googleapis.com/auth/cloud-platform'],
    lifetime: 3600,
  });
  return new Storage({ authClient, projectId: 'verdery-dev' });
}

async function main() {
  const storage = await buildStorageClient();
  const gateway = new GcsMediaStorageGateway(storage, 3_600_000, 900_000);

  log(
    'setup',
    `bucket=${BUCKET_NAME} objectKey=${OBJECT_KEY} identity=${IMPERSONATE_SERVICE_ACCOUNT ?? 'caller ADC'}`,
  );

  const before = await gateway.getObjectMetadata(target);
  if (before !== null) {
    fail('1-precondition', `object already exists before this run: ${JSON.stringify(before)}`);
    return;
  }
  log('1-precondition', 'PASS: no object exists yet');

  const session = await gateway.createResumableUploadSession(target, CONTENT_TYPE, new Date());
  log(
    '2-create-session',
    `PASS: uploadUrl=${session.uploadUrl.slice(0, 80)}... expiresAt=${session.expiresAt.toISOString()}`,
  );

  const uploadResponse = await httpRequest(
    session.uploadUrl,
    {
      method: 'PUT',
      headers: { 'Content-Type': CONTENT_TYPE, 'Content-Length': String(PAYLOAD_BYTES) },
    },
    PAYLOAD,
  );
  if (uploadResponse.status !== 200 && uploadResponse.status !== 201) {
    fail('3-upload', `unexpected status ${String(uploadResponse.status)}: ${uploadResponse.text}`);
    return;
  }
  log(
    '3-upload',
    `PASS: client uploaded directly to the session URL (status ${String(uploadResponse.status)})`,
  );

  const after = await gateway.getObjectMetadata(target);
  if (after === null || after.contentType !== CONTENT_TYPE || after.sizeBytes !== PAYLOAD_BYTES) {
    fail('4-metadata', `unexpected metadata: ${JSON.stringify(after)}`);
  } else {
    log('4-metadata', `PASS: ${JSON.stringify(after)}`);
  }

  const access = await gateway.createSignedDownloadUrl(target, new Date());
  const downloadResponse = await httpRequest(access.url, { method: 'GET' });
  if (downloadResponse.status !== 200 || downloadResponse.text !== PAYLOAD) {
    fail(
      '5-signed-download',
      `unexpected response (status ${String(downloadResponse.status)}): ${downloadResponse.text}`,
    );
  } else {
    log(
      '5-signed-download',
      `PASS: signed URL served the exact uploaded content (expiresAt=${access.expiresAt.toISOString()})`,
    );
  }

  await storage.bucket(BUCKET_NAME).file(OBJECT_KEY).delete();
  const afterDelete = await gateway.getObjectMetadata(target);
  if (afterDelete !== null) {
    fail('6-cleanup', `object still exists after delete: ${JSON.stringify(afterDelete)}`);
  } else {
    log('6-cleanup', 'PASS: test object deleted, no real data left behind');
  }

  if (process.exitCode === undefined || process.exitCode === 0) {
    log('result', 'ALL STEPS PASSED');
  }
}

main().catch((error) => {
  fail('unexpected', error instanceof Error ? (error.stack ?? error.message) : String(error));
});
