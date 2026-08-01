/**
 * Kysely implementation of `CandidateSuitabilityAssessmentRepository` over
 * `plants_inventory.candidate_suitability_assessment` (P11-DATA-01's
 * storage, P11-SUIT-01's own read/write). Append-only: `insert` is the
 * table's only write, the same "a recalculation is a new row, never an
 * edit" posture `plant_content_record`/`plant_profile_version` already
 * established. `result` stores `SuitabilityAssessmentResult.findings`
 * directly — the migration's own comment says this table's `result` shape
 * is this module's to define, not a database CHECK's.
 *
 * Source: migrations/1787600000000_plant-candidates-and-conversion.sql,
 * `plants_inventory.candidate_suitability_assessment`.
 */

import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { CandidateSuitabilityAssessmentRepository } from '../application/candidate-suitability-assessment-repository.js';
import type {
  SuitabilityAssessmentResult,
  SuitabilityFinding,
} from '../domain/suitability-finding.js';
import type { CandidateSuitabilityAssessmentRow } from './schema.js';

function toSuitabilityAssessmentResult(
  row: Selectable<CandidateSuitabilityAssessmentRow>,
): SuitabilityAssessmentResult {
  return {
    candidateId: row.candidate_id,
    findings: row.result as readonly SuitabilityFinding[],
  };
}

export class KyselyCandidateSuitabilityAssessmentRepository implements CandidateSuitabilityAssessmentRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(id: Uuid, assessment: SuitabilityAssessmentResult): Promise<void> {
    await this.db
      .insertInto('plants_inventory.candidate_suitability_assessment')
      .values({
        id,
        candidate_id: assessment.candidateId,
        result: JSON.stringify(assessment.findings),
      })
      .execute();
  }

  async findLatest(candidateId: Uuid): Promise<SuitabilityAssessmentResult | null> {
    const row = await this.db
      .selectFrom('plants_inventory.candidate_suitability_assessment')
      .selectAll()
      .where('candidate_id', '=', candidateId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row === undefined ? null : toSuitabilityAssessmentResult(row);
  }

  async deleteAllForCandidate(candidateId: Uuid): Promise<void> {
    await this.db
      .deleteFrom('plants_inventory.candidate_suitability_assessment')
      .where('candidate_id', '=', candidateId)
      .execute();
  }
}
