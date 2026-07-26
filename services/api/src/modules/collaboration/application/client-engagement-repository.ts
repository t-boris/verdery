import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientEngagementState } from '../domain/client-engagement-state.js';

/** Mirrors `collaboration.client_engagement.stewardship_policy`'s single admitted value today — see the migration's own "STEWARDSHIP POLICY AS AN ENUM" comment for why a second policy is a widened CHECK plus new logic later, not a schema rewrite. */
export type StewardshipPolicy = 'residential';

export interface ClientEngagementInsertInput {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly serviceOrganizationId: Uuid | null;
  readonly stewardshipPolicy: StewardshipPolicy;
  readonly clientNotificationsEnabled: boolean;
  readonly createdByProfileId: Uuid;
  readonly now: Date;
}

/** Mirrors `collaboration.client_engagement` exactly. */
export interface ClientEngagementDetail {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly serviceOrganizationId: Uuid | null;
  readonly state: ClientEngagementState;
  readonly stewardshipPolicy: StewardshipPolicy;
  readonly clientNotificationsEnabled: boolean;
  readonly createdByProfileId: Uuid;
  readonly activatedAt: Date | null;
  readonly endedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revokedReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ClientEngagementRepository {
  insert(input: ClientEngagementInsertInput): Promise<void>;

  /** One engagement by bare id — engagement routes are flat (`/client-engagements/{id}/...`, matching architecture/collaboration-and-client-sharing.md section 13's own API surface list), so there is no enclosing garden or organization id to pre-scope the lookup by. `ActivateClientEngagement`/`EndClientEngagement`/`RevokeClientEngagement` read the row FIRST to learn its owning garden/organization, then authorize against whichever one applies — see those commands' own header comments. */
  findById(id: Uuid): Promise<ClientEngagementDetail | null>;

  /** Row-locks one engagement by id and re-reads it — the same "decide under lock, not from a stale snapshot" guard every other owner-set-shrinking or state-transitioning command in this codebase already applies. No revision column exists on this table (see the lifecycle commands' own header comments for why the row lock alone is sufficient). */
  lockById(id: Uuid): Promise<ClientEngagementDetail | null>;

  /** Writes `state = 'active'` and `activated_at`, matching `client_engagement_activated_linkage_check`. */
  activate(id: Uuid, now: Date): Promise<void>;

  /** Writes `state = 'ended'` and `ended_at`, matching `client_engagement_ended_linkage_check`. */
  end(id: Uuid, now: Date): Promise<void>;

  /** Writes `state = 'revoked'`, `revoked_at`, and an optional `revoked_reason`, matching `client_engagement_revoked_linkage_check`/`client_engagement_revoked_reason_check`. */
  revoke(id: Uuid, now: Date, reason: string | null): Promise<void>;

  /** Every engagement an organization has, in any state, newest first — mirrors `listGardenInvitations`' "every invitation regardless of state" posture. */
  listForOrganization(organizationId: Uuid): Promise<ClientEngagementDetail[]>;

  /** Every engagement a garden has, in any state, newest first. */
  listForGarden(gardenId: Uuid): Promise<ClientEngagementDetail[]>;
}
