import type { Garden as GardenResource } from '@verdery/api-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { assertRecentAuthenticationForDeletion } from '../../../shared/deletion/deletion-policy.js';
import type { DeletionActor } from '../../../shared/deletion/deletion-policy.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { restoreGarden } from '../domain/garden.js';
import { applyRevisionGuardedUpdate } from './apply-revision-guarded-update.js';
import type { GardenAuthorization } from './garden-authorization.js';
import { restoreGardenMemberships } from './garden-membership-revocation.js';
import { toGardenResource } from './garden-view.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'gardens.delete_request.restore';

/**
 * Withdraws a garden deletion request inside its recovery window
 * (P8-DELETE-01) — "the user may recover through a verified process where
 * offered" (architecture/data-export-and-deletion.md section 11), applied to
 * the garden half of section 10.4's "approved recovery window".
 *
 * The exact reversal of `RequestGardenDeletion`, in the same order:
 * `restoreGarden` returns the lifecycle to `active` and clears the deadline,
 * and `restoreGardenMemberships` reactivates precisely the memberships that
 * request revoked (matched on the request instant — see
 * `garden-membership-revocation.ts` for why that match, and not "every
 * removed row").
 *
 * The membership restore reads `deletionRequestedAt` off the garden BEFORE
 * the transition clears it: the value being cleared is exactly the cutoff the
 * match needs.
 *
 * Recent authentication is required here as much as on the request — see
 * `deletion-policy.ts` for why the restore direction is equally sensitive.
 * `purging` is refused with its own `deletion.not_recoverable` code, from the
 * domain: past the sweep's claim there is nothing left to restore.
 */
export class RestoreGardenDeletion {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    actor: DeletionActor,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<GardenResource> {
    const membership = await this.authorization.requireCapability(
      gardenId,
      actor.profileId,
      'manageGarden',
    );
    assertRecentAuthenticationForDeletion(actor.authenticatedAt, this.clock.now());

    const input = {
      actorProfileId: actor.profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, expectedRevision }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const now = this.clock.now();
      let revokedSince: Date | null = null;

      const restored = await applyRevisionGuardedUpdate(
        context.gardens,
        gardenId,
        expectedRevision,
        (garden) => {
          revokedSince = garden.deletionRequestedAt;
          return restoreGarden(garden, now);
        },
      );

      await context.syncChanges.record({
        gardenId: restored.id,
        recordId: restored.id,
        recordType: 'garden',
        operation: 'upsert',
        recordRevision: restored.revision,
      });

      // Non-null on every path that reaches here: `restoreGarden` accepts
      // only `deletion_requested`, and the migration's own
      // `garden_recovery_deadline_linkage_check` keeps that state paired with
      // the request instant this reads.
      const reactivated = await restoreGardenMemberships(
        context,
        restored,
        (revokedSince as Date | null) ?? restored.updatedAt,
        now,
      );

      await context.auditLogger.record({
        eventType: 'garden.deletion_withdrawn',
        subjectType: 'garden',
        subjectId: restored.id,
        actorProfileId: actor.profileId,
        actorType: 'user',
        details: { membershipsRestored: reactivated.length },
      });

      return toGardenResource(restored, membership.role);
    });
  }
}
