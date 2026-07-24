/**
 * Section 12's download flow: authenticate (upstream, by the transport
 * layer), authorize garden role, select the object, and return a short-lived
 * signed download mechanism — never a permanent URL.
 *
 * Only `available` media can be accessed — `rejected`, still-uploading, or
 * not-yet-verified media has nothing safe to serve (section 8: "Unverified
 * objects are isolated from normal downloads and processors").
 *
 * Enforces section 12's own stricter line for the operational viewer role:
 * "may access ordinary accepted photos ... but not raw scan artifacts unless
 * explicitly allowed." `GardenCapability`'s boolean matrix has no room for a
 * rule that depends on the specific media's own attributes rather than a
 * blanket per-role permission, so this checks `membership.role` and
 * `record.sensitivityClassification` directly rather than adding a new
 * capability — see `require-media-and-authorize.ts`'s own comment. No
 * "explicitly allowed" override mechanism exists anywhere in this codebase's
 * role model yet, so this is an unconditional denial for a viewer against
 * `restricted` media, not a configurable one.
 *
 * Section 12 step 3 ("Selects an appropriate original or derivative") has no
 * real choice to make yet: no processing worker exists to have produced a
 * derivative (P6-WORKER-02, later), so the original itself is always the
 * only, and therefore the appropriate, object to serve.
 *
 * Section 12 step 5 ("Records sensitive raw-access audit information where
 * policy requires it") is implemented for `restricted`-classified media
 * (raw capture) through the existing platform `AuditLogger` — the same
 * generic port `identity-access` already uses for its own security events —
 * rather than a new mechanism.
 *
 * The client-portal-specific rules section 12's last paragraph describes
 * (organization/client-engagement/publication entitlement) are out of scope:
 * those concepts do not exist anywhere in this codebase yet (Phase 9, not
 * started) — the same deferral Phase 5 already applied to the identical gap.
 */

import type { MediaAccess } from '@verdery/api-contracts';
import type { AuditLogger } from '../../../platform/audit/audit-logger.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { mediaNotAvailableError, mediaViewerAccessRestrictedError } from './media-errors.js';
import { requireMediaAndAuthorize } from './require-media-and-authorize.js';
import type { MediaStorageGateway } from './media-storage-gateway.js';
import { toMediaAccessResource } from './media-view.js';
import type { MediaRepository } from './media-repository.js';

const RESTRICTED_ACCESS_AUDIT_EVENT_TYPE = 'media.restricted_access_granted';

export class GetMediaAccess {
  constructor(
    private readonly media: MediaRepository,
    private readonly authorization: GardenAuthorization,
    private readonly storage: MediaStorageGateway,
    private readonly auditLogger: AuditLogger,
    private readonly clock: Clock,
  ) {}

  async execute(gardenId: Uuid, mediaId: Uuid, profileId: Uuid): Promise<MediaAccess> {
    const { membership, record } = await requireMediaAndAuthorize(
      this.media,
      this.authorization,
      gardenId,
      mediaId,
      profileId,
      'viewGarden',
    );

    if (record.uploadState !== 'available' || record.processingState !== 'processed') {
      throw mediaNotAvailableError();
    }

    if (membership.role === 'viewer' && record.sensitivityClassification === 'restricted') {
      throw mediaViewerAccessRestrictedError();
    }

    const now = this.clock.now();
    const access = await this.storage.createSignedDownloadUrl(
      // Always both set once `uploadState` reached `available` (which
      // requires having passed through `authorized`, where both are set
      // together) — see `require-media-and-authorize.ts`'s own note.
      { bucketName: record.bucketName as string, objectKey: record.objectKey as string },
      now,
    );

    if (record.sensitivityClassification === 'restricted') {
      await this.auditLogger.record({
        eventType: RESTRICTED_ACCESS_AUDIT_EVENT_TYPE,
        subjectType: 'media',
        subjectId: record.id,
        actorProfileId: profileId,
        actorType: 'user',
        details: { gardenId, role: membership.role },
      });
    }

    return toMediaAccessResource(access);
  }
}
