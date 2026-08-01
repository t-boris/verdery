/**
 * P6-QA-01's signed-access-expiry plumbing evidence: the real
 * `GcsMediaStorageGateway` (not the fake, whose TTLs are its own defaults)
 * must derive BOTH expirations from its configured TTLs — the values
 * `main.ts` wires from `configuration.media.uploadSessionTtlMs`/
 * `signedDownloadTtlMs` — pass the download expiry to Cloud Storage's own
 * `getSignedUrl` (the parameter that actually bounds the URL's validity),
 * and return the identical instant as `expiresAt` (the value
 * `toMediaAccessResource` communicates to clients as
 * `MediaAccess.expiresAt`). Section 18's "Signed access with short
 * expiration" is this exact chain; until this suite nothing proved the real
 * adapter honored the configured value at all.
 *
 * Only `@google-cloud/storage` itself is stubbed — the same boundary every
 * consumer of `FakeMediaStorageGateway` already accepts, applied one layer
 * lower.
 */

import type { Storage } from '@google-cloud/storage';
import { describe, expect, it } from 'vitest';
import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import { GcsMediaStorageGateway } from './gcs-media-storage-gateway.js';

const NOW = new Date('2026-07-21T09:00:00Z');
const UPLOAD_SESSION_TTL_MS = 3_600_000;
const SIGNED_DOWNLOAD_TTL_MS = 900_000;
const TARGET = { bucketName: 'test-user-media', objectKey: 'ab/media-id/object-id' };

interface RecordedCalls {
  createResumableUpload: unknown[];
  getSignedUrl: unknown[];
}

function stubStorage(behavior: {
  signedUrl?: string;
  metadata?: { contentType?: string; size?: string };
  error?: Error;
}): { storage: Storage; calls: RecordedCalls } {
  const calls: RecordedCalls = { createResumableUpload: [], getSignedUrl: [] };
  const file = {
    createResumableUpload: (options: unknown) => {
      if (behavior.error !== undefined) {
        return Promise.reject(behavior.error);
      }
      calls.createResumableUpload.push(options);
      return Promise.resolve(['https://storage.example/resumable-session']);
    },
    getMetadata: () => {
      if (behavior.error !== undefined) {
        return Promise.reject(behavior.error);
      }
      return Promise.resolve([behavior.metadata ?? {}]);
    },
    getSignedUrl: (options: unknown) => {
      if (behavior.error !== undefined) {
        return Promise.reject(behavior.error);
      }
      calls.getSignedUrl.push(options);
      return Promise.resolve([behavior.signedUrl ?? 'https://storage.example/signed']);
    },
  };
  const storage = { bucket: () => ({ file: () => file }) } as unknown as Storage;
  return { storage, calls };
}

const ALLOWED_ORIGIN = 'https://app.example';

function buildGateway(behavior: Parameters<typeof stubStorage>[0]) {
  const { storage, calls } = stubStorage(behavior);
  return {
    gateway: new GcsMediaStorageGateway(storage, UPLOAD_SESSION_TTL_MS, SIGNED_DOWNLOAD_TTL_MS, [
      ALLOWED_ORIGIN,
    ]),
    calls,
  };
}

describe('GcsMediaStorageGateway', () => {
  it('signs a download with the configured TTL: the exact expiry instant goes to getSignedUrl AND comes back as expiresAt', async () => {
    const { gateway, calls } = buildGateway({ signedUrl: 'https://storage.example/signed' });

    const access = await gateway.createSignedDownloadUrl(TARGET, NOW);

    const expectedExpiry = new Date(NOW.getTime() + SIGNED_DOWNLOAD_TTL_MS);
    expect(calls.getSignedUrl).toEqual([
      { action: 'read', expires: expectedExpiry, version: 'v4' },
    ]);
    expect(access).toEqual({ url: 'https://storage.example/signed', expiresAt: expectedExpiry });
  });

  it('stamps the resumable upload session with the configured session TTL and the declared content type', async () => {
    const { gateway, calls } = buildGateway({});

    const session = await gateway.createResumableUploadSession(TARGET, 'image/jpeg', NOW, null);

    expect(session.expiresAt).toEqual(new Date(NOW.getTime() + UPLOAD_SESSION_TTL_MS));
    expect(session.uploadUrl).toBe('https://storage.example/resumable-session');
    expect(calls.createResumableUpload).toEqual([{ metadata: { contentType: 'image/jpeg' } }]);
  });

  // Without `origin` on the session, Cloud Storage answers the browser's
  // preflight and its status probes but omits CORS headers from the FINAL
  // data PUT, so the upload dies at its last request with a 200 the browser
  // refuses to read. Reproduced against the real bucket on 2026-08-01.
  it('binds the session to an allowlisted caller origin', async () => {
    const { gateway, calls } = buildGateway({});

    await gateway.createResumableUploadSession(TARGET, 'image/jpeg', NOW, ALLOWED_ORIGIN);

    expect(calls.createResumableUpload).toEqual([
      { metadata: { contentType: 'image/jpeg' }, origin: ALLOWED_ORIGIN },
    ]);
  });

  // `Origin` is attacker-controlled: binding a session to an unvetted origin
  // would let that origin read the upload's responses.
  it('omits the binding entirely for an origin outside the allowlist', async () => {
    const { gateway, calls } = buildGateway({});

    await gateway.createResumableUploadSession(TARGET, 'image/jpeg', NOW, 'https://evil.example');

    expect(calls.createResumableUpload).toEqual([{ metadata: { contentType: 'image/jpeg' } }]);
  });

  it('maps object metadata onto the port shape, and a 404 to null (object never uploaded)', async () => {
    const { gateway } = buildGateway({ metadata: { contentType: 'image/png', size: '42' } });
    await expect(gateway.getObjectMetadata(TARGET)).resolves.toEqual({
      contentType: 'image/png',
      sizeBytes: 42,
    });

    // A real `@google-cloud/storage` not-found is an Error carrying
    // `code: 404` — the exact shape `isNotFound` reads.
    const notFound = Object.assign(new Error('No such object'), { code: 404 });
    const { gateway: missing } = buildGateway({ error: notFound });
    await expect(missing.getObjectMetadata(TARGET)).resolves.toBeNull();
  });

  it('translates any non-404 provider failure into DependencyUnavailableError on every method', async () => {
    const { gateway } = buildGateway({ error: new Error('gcs down') });

    await expect(gateway.createSignedDownloadUrl(TARGET, NOW)).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
    await expect(
      gateway.createResumableUploadSession(TARGET, 'image/jpeg', NOW, null),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
    await expect(gateway.getObjectMetadata(TARGET)).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
  });
});
