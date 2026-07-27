import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PublicationState } from '../domain/publication-state.js';

export interface ClientUpdateInsertInput {
  readonly id: Uuid;
  readonly engagementId: Uuid;
  readonly gardenId: Uuid;
  readonly title: string;
  readonly createdByProfileId: Uuid;
  readonly now: Date;
}

/**
 * Mirrors `collaboration.client_update` exactly. `state` reuses
 * `publication-state.ts`'s own `PublicationState` union rather than a
 * parallel type, so the repository row and the pure state-machine predicate
 * can never drift apart.
 */
export interface ClientUpdateDetail {
  readonly id: Uuid;
  readonly engagementId: Uuid;
  readonly gardenId: Uuid;
  readonly state: PublicationState;
  readonly title: string;
  readonly summary: string | null;
  readonly revision: number;
  readonly createdByProfileId: Uuid;
  readonly submittedAt: Date | null;
  readonly publishedAt: Date | null;
  readonly publishedByProfileId: Uuid | null;
  readonly withdrawnAt: Date | null;
  readonly withdrawnByProfileId: Uuid | null;
  readonly withdrawnReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ClientUpdateRepository {
  insert(input: ClientUpdateInsertInput): Promise<void>;

  /** One update by bare id — used only where no enclosing engagement id is already trusted (none of this module's own commands need this; kept for symmetry and future reads). */
  findById(id: Uuid): Promise<ClientUpdateDetail | null>;

  /** One update by id, scoped to `engagementId` — a caller must not learn that an update id exists under a DIFFERENT engagement than the one named in the path, the same cross-tenant concealment `GardenAssignmentRepository.findByIdAndOrganization` already provides. */
  findByIdAndEngagement(id: Uuid, engagementId: Uuid): Promise<ClientUpdateDetail | null>;

  /**
   * Writes the full row only if the stored row's current revision equals
   * `expectedRevision`. Returns whether the write applied — the identical
   * conditional-update contract `TaskRepository.update`/`MediaRepository
   * .update` already establish. `record` carries the NEW `revision` value
   * (the caller's own responsibility to increment, mirroring
   * `assignTask`'s own domain transform).
   */
  update(record: ClientUpdateDetail, expectedRevision: number): Promise<boolean>;

  /** Every update an engagement has, in any state, newest first. */
  listForEngagement(engagementId: Uuid): Promise<readonly ClientUpdateDetail[]>;
}
