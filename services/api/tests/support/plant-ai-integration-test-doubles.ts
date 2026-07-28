/**
 * Shared "kill-switch off" plant-AI call policies (ADR-0015) for
 * integration suites that construct `AddPlantFromPhoto`/`RecordObservation`/
 * `CorrectObservation` directly against a real database — the same honest
 * `noProviderConfigured` degradation every real environment answers with
 * today. One shared helper, not four per-file copies, the
 * `tests/support/application.ts` reasoning for why shared test
 * infrastructure lives here.
 */

import type { Kysely } from 'kysely';
import { pino } from 'pino';
import {
  AnalyzePlantCondition,
  IdentifyPlantSpecies,
  KyselyProviderQuotaRepository,
} from '../../src/modules/integrations/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import type { Clock } from '../../src/shared/time/clock.js';

export function disabledPlantAiCallPolicies(
  db: Kysely<DatabaseSchema>,
  clock: Clock,
): { identifyPlantSpecies: IdentifyPlantSpecies; analyzePlantCondition: AnalyzePlantCondition } {
  const providerQuotas = new KyselyProviderQuotaRepository(db);
  return {
    identifyPlantSpecies: new IdentifyPlantSpecies(
      null,
      {
        providerKey: 'vertex-ai-plant-species',
        callTimeoutMs: 1_000,
        quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
      },
      providerQuotas,
      clock,
      pino({ level: 'silent' }),
    ),
    analyzePlantCondition: new AnalyzePlantCondition(
      null,
      {
        providerKey: 'vertex-ai-plant-condition',
        callTimeoutMs: 1_000,
        quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
      },
      providerQuotas,
      clock,
      pino({ level: 'silent' }),
    ),
  };
}
