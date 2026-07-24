import type { MediaProcessingResult } from '@verdery/api-contracts';

export interface MediaProcessingResultRecorder {
  record(result: MediaProcessingResult): Promise<void>;
}
