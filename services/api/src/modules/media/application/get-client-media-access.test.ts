import { describe, expect, it } from 'vitest';
import {
  authorizeMediaUpload,
  beginMediaProcessing,
  beginMediaUpload,
  beginMediaVerification,
  markMediaAvailable,
  markMediaProcessed,
} from '../domain/media-lifecycle.js';
import { registerMediaRecord } from '../domain/media-record.js';
import type { MediaRecord } from '../domain/media-record.js';
import type { ClientMediaEntitlementGrant } from './client-media-entitlement-source.js';
import { GetClientMediaAccess } from './get-client-media-access.js';
import {
  FakeAuditLogger,
  FakeClientMediaEntitlementSource,
  FakeMediaRepository,
  FakeMediaStorageGateway,
  fixedClock,
} from './media-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const CLIENT_PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const OTHER_CLIENT_PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const ENGAGEMENT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a1a';
const PUBLICATION_VERSION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a1b';
const NOW = new Date('2026-07-21T09:00:00Z');
const BUCKET = 'test-user-media';
const OBJECT_KEY = 'ab/019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b/019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11';

function fullyValidGrant(
  overrides: Partial<ClientMediaEntitlementGrant> = {},
): ClientMediaEntitlementGrant {
  return {
    engagementId: ENGAGEMENT_ID,
    engagementState: 'active',
    grantState: 'active',
    publicationVersionId: PUBLICATION_VERSION_ID,
    publicationState: 'published',
    ...overrides,
  };
}

function availableOriginal(): MediaRecord {
  const registered = registerMediaRecord(
    MEDIA_ID,
    GARDEN_ID,
    CLIENT_PROFILE_ID,
    'garden_photo',
    'photo.jpg',
    'image/jpeg',
    123_456,
    null,
    null,
    null,
    null,
    NOW,
  );
  const authorized = authorizeMediaUpload(registered, BUCKET, OBJECT_KEY, NOW);
  const uploading = beginMediaUpload(authorized, NOW);
  const verifying = beginMediaVerification(uploading, NOW);
  const available = markMediaAvailable(verifying, 'image/jpeg', 123_456, null, NOW);
  return markMediaProcessed(beginMediaProcessing(available, NOW), NOW);
}

function availableDerivative(sourceId: string): MediaRecord {
  const source = availableOriginal();
  return {
    ...source,
    id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a1d',
    mediaClass: 'derived_preview',
    processingState: null,
    derivedFromMediaId: sourceId,
    transformationVersion: 1,
    derivativeKind: 'screen_preview',
  };
}

function buildUseCase(record: MediaRecord) {
  const media = new FakeMediaRepository();
  media.records.set(record.id, record);
  const entitlements = new FakeClientMediaEntitlementSource();
  const storage = new FakeMediaStorageGateway();
  const auditLogger = new FakeAuditLogger();

  const useCase = new GetClientMediaAccess(
    media,
    entitlements,
    storage,
    auditLogger,
    fixedClock(NOW),
  );

  return { useCase, entitlements, storage, auditLogger };
}

describe('GetClientMediaAccess', () => {
  it('succeeds and returns a short-lived signed URL when every one of the six conditions genuinely holds', async () => {
    const { useCase, entitlements, storage } = buildUseCase(availableOriginal());
    entitlements.grant(CLIENT_PROFILE_ID, MEDIA_ID, fullyValidGrant());

    const result = await useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID);

    expect(result.url).toContain(BUCKET);
    expect(result.expiresAt).toBe(new Date(NOW.getTime() + 900_000).toISOString());
    expect(storage.createSignedUrlCalls).toHaveLength(1);
  });

  it('denies when no media_entitlement row reaches this profile at all — media exists, but was never selected for any publication', async () => {
    const { useCase, storage } = buildUseCase(availableOriginal());
    // No `entitlements.grant(...)` call at all — the "no entitlement"
    // scenario the completion evidence names explicitly.

    await expect(useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID)).rejects.toMatchObject({
      category: 'notFound',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(0);
  });

  it('denies a cross-client request — a DIFFERENT client, entitled on their own engagement, may not reach this media', async () => {
    const { useCase, entitlements, storage } = buildUseCase(availableOriginal());
    // The entitlement exists, but only for a different client profile.
    entitlements.grant(OTHER_CLIENT_PROFILE_ID, MEDIA_ID, fullyValidGrant());

    await expect(useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID)).rejects.toMatchObject({
      category: 'notFound',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(0);
  });

  it('denies when the engagement has ended — check 2', async () => {
    const { useCase, entitlements, storage } = buildUseCase(availableOriginal());
    entitlements.grant(CLIENT_PROFILE_ID, MEDIA_ID, fullyValidGrant({ engagementState: 'ended' }));

    await expect(useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID)).rejects.toMatchObject({
      category: 'notFound',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(0);
  });

  it('denies when the engagement was revoked — check 2', async () => {
    const { useCase, entitlements } = buildUseCase(availableOriginal());
    entitlements.grant(
      CLIENT_PROFILE_ID,
      MEDIA_ID,
      fullyValidGrant({ engagementState: 'revoked' }),
    );

    await expect(useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID)).rejects.toMatchObject({
      category: 'notFound',
    });
  });

  it('denies a REVOKED client access grant — check 3', async () => {
    const { useCase, entitlements, storage } = buildUseCase(availableOriginal());
    entitlements.grant(CLIENT_PROFILE_ID, MEDIA_ID, fullyValidGrant({ grantState: 'revoked' }));

    await expect(useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID)).rejects.toMatchObject({
      category: 'notFound',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(0);
  });

  it('denies a PENDING (not yet accepted) client access grant — check 3', async () => {
    const { useCase, entitlements } = buildUseCase(availableOriginal());
    entitlements.grant(CLIENT_PROFILE_ID, MEDIA_ID, fullyValidGrant({ grantState: 'pending' }));

    await expect(useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID)).rejects.toMatchObject({
      category: 'notFound',
    });
  });

  it('denies a WITHDRAWN publication — check 4, the single most safety-critical check in this package', async () => {
    const { useCase, entitlements, storage } = buildUseCase(availableOriginal());
    // A publication that genuinely WAS published, then withdrawn — not a
    // publication that never reached 'published' at all, so this proves
    // withdrawal itself (not merely an unfinished draft) revokes access.
    entitlements.grant(
      CLIENT_PROFILE_ID,
      MEDIA_ID,
      fullyValidGrant({ publicationState: 'withdrawn' }),
    );

    await expect(useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID)).rejects.toMatchObject({
      category: 'notFound',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(0);
  });

  it('denies a publication still in internal_draft or ready_for_client — check 4', async () => {
    const draft = buildUseCase(availableOriginal());
    draft.entitlements.grant(
      CLIENT_PROFILE_ID,
      MEDIA_ID,
      fullyValidGrant({ publicationState: 'internal_draft' }),
    );
    await expect(draft.useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID)).rejects.toMatchObject({
      category: 'notFound',
    });

    const readyForClient = buildUseCase(availableOriginal());
    readyForClient.entitlements.grant(
      CLIENT_PROFILE_ID,
      MEDIA_ID,
      fullyValidGrant({ publicationState: 'ready_for_client' }),
    );
    await expect(readyForClient.useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID)).rejects.toMatchObject(
      { category: 'notFound' },
    );
  });

  it('denies an original media record before it reaches processed — check 6, mirrors GetMediaAccess exactly', async () => {
    const registeredOnly = registerMediaRecord(
      MEDIA_ID,
      GARDEN_ID,
      CLIENT_PROFILE_ID,
      'garden_photo',
      'photo.jpg',
      'image/jpeg',
      123_456,
      null,
      null,
      null,
      null,
      NOW,
    );
    const { useCase, entitlements, storage } = buildUseCase(registeredOnly);
    entitlements.grant(CLIENT_PROFILE_ID, MEDIA_ID, fullyValidGrant());

    await expect(useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID)).rejects.toMatchObject({
      category: 'conflict',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(0);
  });

  it('serves a derivative that is itself directly entitled, at `available` alone — no `processed` requirement, mirroring GetMediaAccess', async () => {
    const derivative = availableDerivative(MEDIA_ID);
    const { useCase, entitlements, storage } = buildUseCase(derivative);
    entitlements.grant(CLIENT_PROFILE_ID, derivative.id, fullyValidGrant());

    await expect(useCase.execute(CLIENT_PROFILE_ID, derivative.id)).resolves.toBeDefined();
    expect(storage.createSignedUrlCalls).toHaveLength(1);
  });

  it("serves a SAFE DERIVATIVE through its parent's entitlement — the derivative itself carries no entitlement row of its own", async () => {
    const derivative = availableDerivative(MEDIA_ID);
    const media = new FakeMediaRepository();
    media.records.set(derivative.id, derivative);
    const entitlements = new FakeClientMediaEntitlementSource();
    // Only the ORIGINAL id is entitled — never the derivative's own id.
    entitlements.grant(CLIENT_PROFILE_ID, MEDIA_ID, fullyValidGrant());
    const storage = new FakeMediaStorageGateway();
    const useCase = new GetClientMediaAccess(
      media,
      entitlements,
      storage,
      new FakeAuditLogger(),
      fixedClock(NOW),
    );

    await expect(useCase.execute(CLIENT_PROFILE_ID, derivative.id)).resolves.toBeDefined();
    expect(storage.createSignedUrlCalls).toHaveLength(1);
  });

  it('refuses an ORIGINAL with no entitlement of its own, even when one of its derivatives happens to be entitled — "original only if explicitly entitled"', async () => {
    const original = availableOriginal();
    const derivative = availableDerivative(original.id);
    const media = new FakeMediaRepository();
    media.records.set(original.id, original);
    media.records.set(derivative.id, derivative);
    const entitlements = new FakeClientMediaEntitlementSource();
    // Only the DERIVATIVE is entitled — the original itself never is.
    entitlements.grant(CLIENT_PROFILE_ID, derivative.id, fullyValidGrant());
    const storage = new FakeMediaStorageGateway();
    const useCase = new GetClientMediaAccess(
      media,
      entitlements,
      storage,
      new FakeAuditLogger(),
      fixedClock(NOW),
    );

    await expect(useCase.execute(CLIENT_PROFILE_ID, original.id)).rejects.toMatchObject({
      category: 'notFound',
    });
    expect(storage.createSignedUrlCalls).toHaveLength(0);
  });

  it('denies a request for a media id that does not exist at all', async () => {
    const { useCase, storage } = buildUseCase(availableOriginal());

    await expect(useCase.execute(CLIENT_PROFILE_ID, OTHER_CLIENT_PROFILE_ID)).rejects.toMatchObject(
      {
        category: 'notFound',
      },
    );
    expect(storage.createSignedUrlCalls).toHaveLength(0);
  });

  // --- P9C-OBS-01: portal access to sensitive media (section 19) ---------

  it('records a client_media.access_granted audit event on every successful grant, carrying only ids', async () => {
    const { useCase, entitlements, auditLogger } = buildUseCase(availableOriginal());
    entitlements.grant(CLIENT_PROFILE_ID, MEDIA_ID, fullyValidGrant());

    await useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID);

    expect(auditLogger.events).toHaveLength(1);
    expect(auditLogger.events[0]).toMatchObject({
      eventType: 'client_media.access_granted',
      subjectType: 'media',
      subjectId: MEDIA_ID,
      actorProfileId: CLIENT_PROFILE_ID,
      actorType: 'user',
      gardenId: GARDEN_ID,
      details: { engagementId: ENGAGEMENT_ID, publicationVersionId: PUBLICATION_VERSION_ID },
    });
  });

  it('prohibited-content telemetry: the access-granted audit event never carries the bucket name, object key, or signed URL', async () => {
    const { useCase, entitlements, auditLogger, storage } = buildUseCase(availableOriginal());
    entitlements.grant(CLIENT_PROFILE_ID, MEDIA_ID, fullyValidGrant());
    // A realistic forbidden value for each excluded category (section 19:
    // "media URLs ... where a pseudonymous aggregate is sufficient") — the
    // fake storage gateway's signed URL genuinely embeds the bucket name and
    // object key, so this proves the audit event carries neither, not merely
    // that nobody happened to pass them in.
    const result = await useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID);
    expect(result.url).toContain(BUCKET);
    expect(result.url).toContain(OBJECT_KEY);
    expect(storage.createSignedUrlCalls).toHaveLength(1);

    expect(auditLogger.events).toHaveLength(1);
    const serializedEvent = JSON.stringify(auditLogger.events[0]);
    expect(serializedEvent).not.toContain(BUCKET);
    expect(serializedEvent).not.toContain(OBJECT_KEY);
    expect(serializedEvent).not.toContain(result.url);
  });

  it('records no audit event at all for a denied attempt — a denial is a lighter structured-log metric, not an audit row', async () => {
    const { useCase, auditLogger } = buildUseCase(availableOriginal());
    // No entitlement granted — the ordinary denial path.

    await expect(useCase.execute(CLIENT_PROFILE_ID, MEDIA_ID)).rejects.toMatchObject({
      category: 'notFound',
    });
    expect(auditLogger.events).toHaveLength(0);
  });
});
