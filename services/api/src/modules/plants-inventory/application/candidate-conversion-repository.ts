import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { CandidateConversion } from '../domain/candidate-conversion.js';

export interface CandidateConversionRepository {
  /**
   * Inserts the conversion record. Relies on `candidate_conversion_
   * candidate_id_key` (UNIQUE) to reject a second conversion of the same
   * candidate at the storage layer — the caller (`ConvertCandidate`)
   * translates that unique-violation into `candidateAlreadyConvertedError()`
   * rather than treating it as an unexpected failure.
   */
  insert(conversion: CandidateConversion): Promise<void>;
  findByCandidateId(candidateId: Uuid): Promise<CandidateConversion | null>;

  /** Removes the provenance link only when permanent candidate deletion is allowed after the converted plant itself reached `removed`. */
  deleteByCandidateId(candidateId: Uuid): Promise<boolean>;
}
