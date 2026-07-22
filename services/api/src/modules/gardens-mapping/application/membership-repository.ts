import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenRole } from '../domain/garden-role.js';

export interface Membership {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly profileId: Uuid;
  readonly role: GardenRole;
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
}
