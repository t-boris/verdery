/**
 * Port to the API's three internal export endpoints (P8-EXPORT-01) — the
 * `MediaProcessingResultRecorder` shape, one method per hop-2 call. The
 * privilege split this port IS: every database fact the export job needs
 * (the snapshot, the checkpoints, the completion transitions) lives behind
 * `services/api`'s OIDC-verified endpoints, because `verdery_worker` has
 * no grants on any module's tables; this worker contributes bytes and the
 * verified worker-to-API identity — see the contract file's own header
 * (`@verdery/api-contracts`' `export-processing.ts`).
 */

import type {
  ExportCheckpointRequest,
  ExportCompletionRequest,
  ExportSnapshotResponse,
} from '@verdery/api-contracts';

export interface ExportApiClient {
  fetchSnapshot(exportRequestId: string): Promise<ExportSnapshotResponse>;

  recordCheckpoints(exportRequestId: string, body: ExportCheckpointRequest): Promise<void>;

  recordCompletion(exportRequestId: string, body: ExportCompletionRequest): Promise<void>;
}
