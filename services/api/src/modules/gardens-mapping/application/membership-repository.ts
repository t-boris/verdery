import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenRole } from '../domain/garden-role.js';

export interface Membership {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly profileId: Uuid;
  readonly role: GardenRole;
}

/**
 * `collaboration.membership.state` as this codebase's own migration already
 * constrains it (`membership_state_check CHECK (state IN ('active',
 * 'removed'))`) — `'removed'` is schema-anticipated but has zero producers
 * today: no command anywhere transitions a membership row to it (confirmed
 * by inspection for P5-BE-02 — `insertOwner` below is still the only write
 * this interface exposes). `listMembershipsForProfile` is written against the
 * full two-value type regardless, so `GetSyncChanges`'s own tombstone
 * filtering (see `get-sync-changes.ts`'s header comment) is already correct
 * the day a real revocation command starts writing `'removed'`, with no
 * change needed here or there.
 */
export type GardenMembershipState = 'active' | 'removed';

export interface GardenPartitionMembership {
  readonly gardenId: Uuid;
  readonly state: GardenMembershipState;
}

/**
 * Membership persistence for Phase 2. The Collaboration module owns
 * `collaboration.membership` per architecture/data-and-geospatial-design.md,
 * section "3. Schema Ownership", but no Collaboration module exists yet —
 * membership today is entirely a side effect of garden creation, with no
 * invite/accept flow to justify standing up a separate module (P2-BE-01
 * names only identity-access and gardens-mapping). This repository lives
 * here as a deliberate, temporary consolidation, revisited when invitations
 * ship and a real Collaboration module has its own write path to this table.
 */
export interface MembershipRepository {
  findActiveMembership(gardenId: Uuid, profileId: Uuid): Promise<Membership | null>;

  /** Grants the owner role at garden creation. Every garden has exactly one owner at creation. */
  insertOwner(id: Uuid, gardenId: Uuid, profileId: Uuid, now: Date): Promise<void>;

  /**
   * Every membership row this profile has, in any state — added for
   * `GetSyncChanges` (P5-BE-02), which needs both "gardens visible for
   * ordinary upserts" (`state === 'active'`) and "gardens whose only
   * remaining visibility is their own revocation tombstone"
   * (`state !== 'active'`) from a single read. Not narrowed to active-only
   * like `findActiveMembership`, deliberately: a profile whose membership was
   * removed still needs to learn that fact from its next pull.
   */
  listMembershipsForProfile(profileId: Uuid): Promise<GardenPartitionMembership[]>;
}
