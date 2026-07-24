import type { MediaProcessingResult } from '@verdery/api-contracts';
import { GoogleAuth } from 'google-auth-library';
import type { MediaProcessingResultRecorder } from './media-processing-result-recorder.js';

export class GoogleApiResultRecorder implements MediaProcessingResultRecorder {
  private readonly auth = new GoogleAuth();

  constructor(
    private readonly callbackBaseUrl: string,
    private readonly audience: string,
  ) {}

  async record(result: MediaProcessingResult): Promise<void> {
    const client = await this.auth.getIdTokenClient(this.audience);
    await client.request({
      method: 'POST',
      url: `${this.callbackBaseUrl}/${result.jobId}/callback`,
      data: result,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
