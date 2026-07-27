import type { Uuid } from '../../../shared/identifiers/uuid.js';

/**
 * `collaboration.publisher_grant.state` — a two-state machine with exactly
 * one edge (`active -> revoked`). See the migration's own header, "BUILT IN
 * `garden_assignment`'s OWN APPEND-ONLY SHAPE", for why no companion
 * `isValidPublisherGrantTransition` predicate file exists: with only one
 * reachable edge, `RevokePublisherAccess`'s own `state === 'revoked'`
 * idempotent-no-op check is the complete sequencing rule.
 */
export type PublisherGrantState = 'active' | 'revoked';

export interface PublisherGrantInsertInput {
  readonly id: Uuid;
  readonly engagementId: Uuid;
  readonly profileId: Uuid;
  readonly grantedByProfileId: Uuid;
  readonly now: Date;
}

/** Mirrors `collaboration.publisher_grant` exactly. */
export interface PublisherGrantDetail {
  readonly id: Uuid;
  readonly engagementId: Uuid;
  readonly profileId: Uuid;
  readonly state: PublisherGrantState;
  readonly grantedByProfileId: Uuid;
  readonly grantedAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedByProfileId: Uuid | null;
  readonly createdAt: Date;
}

export interface PublisherGrantRepository {
  /** Inserts a brand-new, ACTIVE grant row. Throws a unique-violation on `publisher_grant_active_key` if the (engagement, profile) pair already holds an active one — see `GrantPublisherAccess`'s own pre-check-plus-catch handling. */
  insert(input: PublisherGrantInsertInput): Promise<void>;

  /** The current ACTIVE grant for (engagement, profile) — the exact authorization query every client-update command runs (`PublisherAuthorization.requireActiveGrant`). */
  findActiveByEngagementAndProfile(
    engagementId: Uuid,
    profileId: Uuid,
  ): Promise<PublisherGrantDetail | null>;

  /** The most recent grant (active OR revoked) for (engagement, profile), regardless of state — `RevokePublisherAccess`'s own idempotency source: `null` means no grant ever existed (`404`); a `revoked` row means an already-revoked idempotent no-op (`200`, unchanged); an `active` row is the one to revoke. */
  findLatestByEngagementAndProfile(
    engagementId: Uuid,
    profileId: Uuid,
  ): Promise<PublisherGrantDetail | null>;

  /** Row-locks one grant by id and re-reads it — the same "decide under lock, not from a stale snapshot" guard `GardenAssignmentRepository.lockById` provides, run immediately before `RevokePublisherAccess` decides anything. */
  lockById(id: Uuid): Promise<PublisherGrantDetail | null>;

  /** Closes a grant: writes `state = 'revoked'`, `revoked_at`, and `revoked_by_profile_id` together, matching `publisher_grant_revoked_linkage_check`/`publisher_grant_revoked_by_linkage_check`. */
  revoke(id: Uuid, now: Date, revokedByProfileId: Uuid): Promise<void>;

  /** Every grant (active or revoked) an engagement has ever issued, newest first. */
  listForEngagement(engagementId: Uuid): Promise<readonly PublisherGrantDetail[]>;
}
