import type { Garden as GardenResource } from '@verdery/api-contracts';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { assertRecentAuthenticationForDeletion } from '../../../shared/deletion/deletion-policy.js';
import type { DeletionActor } from '../../../shared/deletion/deletion-policy.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { requestGardenDeletion } from '../domain/garden.js';
import { applyRevisionGuardedUpdate } from './apply-revision-guarded-update.js';
import type { GardenAuthorization } from './garden-authorization.js';
import { revokeGardenMemberships } from './garden-membership-revocation.js';
import { toGardenResource } from './garden-view.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'gardens.delete_request';

/**
 * Starts the deletion workflow (P2-API-01 created it; P8-DELETE-01 completed
 * it). Still deletes nothing: it opens the 30-day recovery window, and the
 * deletion sweep purges the garden only after that window closes.
 *
 * The four things section 10 asks of the REQUEST, and where each is:
 *
 * 1. "Requires owner capability and recent authentication" — the
 *    `manageGarden` capability check plus
 *    `assertRecentAuthenticationForDeletion`, evaluated against the session's
 *    own `auth_time` (never a client claim), the gate `RequestExport` already
 *    established for account-wide export.
 * 2. "Resolves other owners and shared access" / "Emits revocation changes
 *    for offline clients" — `revokeGardenMemberships`, which revokes every
 *    member EXCEPT the requesting owner and addresses each of them their own
 *    garden tombstone. See that file's header for why the owner is retained
 *    and why the tombstones are addressed.
 * 3. "Marks the garden deletion requested and revokes new edits" — the
 *    lifecycle transition, plus the one thing that makes "revokes new edits"
 *    true rather than merely intended: `GardenAuthorization.requireCapability`
 *    refuses the `editGardenContent` capability from this state onward, so
 *    every content command in every module — map objects, calibration,
 *    plants, observations, tasks, media — is refused at its own authorization
 *    step, including commands not yet written. (The domain's own
 *    `requireMutable` covers the one mutation that does NOT hold that
 *    capability: `renameGarden`, an owner's `manageGarden` command. See
 *    `domain/garden-role.ts` for why `manageGarden` cannot be refused
 *    wholesale — RESTORE holds it too.)
 * 4. "Provides the approved recovery window" — `recoveryDeadlineAt`, stamped
 *    by the domain transition from the one shared 30-day policy.
 *
 * Pending jobs (section 10.5) are deliberately NOT cancelled here. Cancelling
 * a media validation or derivative job is irreversible, and this command is
 * reversible by design for the next 30 days — a restored garden must not come
 * back with half-processed media. The purge cancels them, at the point where
 * irreversibility is the intent.
 *
 * Source: architecture/data-export-and-deletion.md, section "10. Garden
 * Deletion"; architecture/data-and-geospatial-design.md, section "15. Deletion".
 */
export class RequestGardenDeletion {
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
      const requested = await applyRevisionGuardedUpdate(
        context.gardens,
        gardenId,
        expectedRevision,
        (garden) => requestGardenDeletion(garden, now),
      );

      // 'upsert', not 'delete': for the OWNER, who keeps active membership
      // through the whole recovery window, this only flips `lifecycleState`
      // and stamps a deadline — the garden still exists for them. The
      // `delete` tombstones written below are addressed to the members who
      // just lost access, and reach nobody else.
      await context.syncChanges.record({
        gardenId: requested.id,
        recordId: requested.id,
        recordType: 'garden',
        operation: 'upsert',
        recordRevision: requested.revision,
      });

      const revoked = await revokeGardenMemberships(context, requested, actor.profileId, now);

      await context.outbox.append({
        eventType: 'garden.deletion_requested',
        aggregateType: 'garden',
        aggregateId: requested.id,
        payload: {},
      });
      await context.auditLogger.record({
        eventType: 'garden.deletion_requested',
        subjectType: 'garden',
        subjectId: requested.id,
        actorProfileId: actor.profileId,
        actorType: 'user',
        // Counts, not identities: the audit trail records that access was
        // revoked, not a roster of who used to be in the garden.
        details: {
          recoveryDeadlineAt: requested.recoveryDeadlineAt?.toISOString() ?? null,
          membershipsRevoked: revoked.length,
        },
      });

      return toGardenResource(requested, membership.role);
    });
  }
}
