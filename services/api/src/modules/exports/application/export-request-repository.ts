/**
 * Port for `exports.export_request` and its per-section generation
 * checkpoints (P8-EXPORT-01). Follows the module repository conventions:
 * revision-guarded `update`, requester-scoped reads that conceal
 * non-ownership as absence, and an all-at-once checkpoint write so the
 * staged set is always one snapshot's.
 */

import type { ExportSectionDisposition } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ExportRequest } from '../domain/export-request.js';

/** One stored section checkpoint — the persistence twin of the contract's `ExportSectionCheckpoint`, plus its stamp. */
export interface ExportSectionCheckpointRecord {
  readonly exportRequestId: Uuid;
  readonly entryPath: string;
  readonly disposition: ExportSectionDisposition;
  readonly bucketName: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly checksumSha256: string;
  readonly byteSize: number;
  readonly completedAt: Date;
}

export interface NewExportSectionCheckpoint {
  readonly entryPath: string;
  readonly disposition: ExportSectionDisposition;
  readonly bucketName: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly checksumSha256: string;
  readonly byteSize: number;
}

export interface ExportRequestRepository {
  /** Plain insert; the partial unique active-per-requester index is the caller's translated conflict. */
  insert(request: ExportRequest): Promise<void>;

  get(id: Uuid): Promise<ExportRequest | null>;

  /** The requester's own request, or `null` — never another requester's (the not-found concealment boundary). */
  getForRequester(id: Uuid, requesterProfileId: Uuid): Promise<ExportRequest | null>;

  /** The requester's currently active (`requested`/`running`) request, if any — the pre-check half of the one-active rule; the index is the race backstop. */
  findActiveForRequester(requesterProfileId: Uuid): Promise<ExportRequest | null>;

  /**
   * Revision-guarded write of every mutable column — `false` means the
   * expected prior revision no longer matches (a concurrent writer won),
   * the `MediaRepository.update` precedent.
   */
  update(request: ExportRequest): Promise<boolean>;

  listCheckpoints(exportRequestId: Uuid): Promise<readonly ExportSectionCheckpointRecord[]>;

  /**
   * Replaces the request's checkpoint set with `sections` in one
   * statement pair (delete + insert) — all-or-nothing, so the stored set
   * is always exactly one snapshot attempt's, never a mix of two
   * boundaries' sections.
   */
  replaceCheckpoints(
    exportRequestId: Uuid,
    sections: readonly NewExportSectionCheckpoint[],
    now: Date,
  ): Promise<void>;
}
