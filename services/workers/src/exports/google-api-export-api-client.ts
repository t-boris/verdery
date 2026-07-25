/**
 * `google-auth-library`-backed `ExportApiClient` (P8-EXPORT-01) — the
 * `GoogleApiResultRecorder` shape: an ID token minted for the SAME
 * worker-to-API audience as the result callback and every sweep (one
 * worker-to-API identity, never a second audience that could drift).
 */

import type {
  ExportCheckpointRequest,
  ExportCompletionRequest,
  ExportSnapshotResponse,
} from '@verdery/api-contracts';
import { GoogleAuth } from 'google-auth-library';
import type { ExportApiClient } from './export-api-client.js';

export class GoogleApiExportApiClient implements ExportApiClient {
  private readonly auth = new GoogleAuth();

  constructor(
    /** e.g. `https://<api>/v1/internal/exports` — the request id and action segment are appended per call. */
    private readonly apiBaseUrl: string,
    private readonly audience: string,
  ) {}

  async fetchSnapshot(exportRequestId: string): Promise<ExportSnapshotResponse> {
    const client = await this.auth.getIdTokenClient(this.audience);
    const response = await client.request<ExportSnapshotResponse>({
      method: 'POST',
      url: `${this.apiBaseUrl}/${exportRequestId}/snapshot`,
    });
    return response.data;
  }

  async recordCheckpoints(exportRequestId: string, body: ExportCheckpointRequest): Promise<void> {
    const client = await this.auth.getIdTokenClient(this.audience);
    await client.request({
      method: 'POST',
      url: `${this.apiBaseUrl}/${exportRequestId}/checkpoints`,
      data: body,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async recordCompletion(exportRequestId: string, body: ExportCompletionRequest): Promise<void> {
    const client = await this.auth.getIdTokenClient(this.audience);
    await client.request({
      method: 'POST',
      url: `${this.apiBaseUrl}/${exportRequestId}/complete`,
      data: body,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
