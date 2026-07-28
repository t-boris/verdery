/**
 * Shared "kill-switch off" `AnalyzePlantCondition` (ADR-0015) for this
 * module's own unit tests (`record-observation.test.ts`,
 * `correct-observation.test.ts`) — the honest `noProviderConfigured`
 * degradation every real environment answers with today. Module-local, not
 * cross-imported from `integrations-test-doubles.ts`, per this codebase's
 * cross-module-boundary convention (test doubles stay module-internal).
 */

import { pino } from 'pino';
import {
  AnalyzePlantCondition,
  type ProviderQuotaConsumeResult,
  type ProviderQuotaLimits,
  type ProviderQuotaRepository,
} from '../../integrations/public.js';
import type { Clock } from '../../../shared/time/clock.js';

/** Always succeeds, unlimited — these suites exercise observation recording/correction, not quota accounting. */
export class AlwaysAllowProviderQuotaRepository implements ProviderQuotaRepository {
  consumeCall(
    _providerKey: string,
    _limits: ProviderQuotaLimits,
    _now: Date,
  ): Promise<ProviderQuotaConsumeResult> {
    return Promise.resolve({ consumed: true });
  }
}

export function disabledAnalyzePlantCondition(clock: Clock): AnalyzePlantCondition {
  return new AnalyzePlantCondition(
    null,
    {
      providerKey: 'vertex-ai-plant-condition',
      callTimeoutMs: 1_000,
      quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
    },
    new AlwaysAllowProviderQuotaRepository(),
    clock,
    pino({ level: 'silent' }),
  );
}
