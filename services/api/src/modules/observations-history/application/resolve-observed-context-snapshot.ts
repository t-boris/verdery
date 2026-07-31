/**
 * Builds the ambient garden-context snapshot `createObservation`/
 * `createCorrectionObservation` attach to a new observation row, from
 * whatever `gardens_mapping.garden_context_fact` rows the garden currently
 * has declared. Reached through `gardens-mapping/public.ts` (an application-
 * layer, not domain-layer, cross-module read) — see `domain/observation.ts`'s
 * header comment for why the RESULT type still uses this module's own local
 * vocabulary aliases rather than `gardens-mapping`'s domain types.
 *
 * A garden that has never declared a given context kind yields `null` for
 * that field — never treated as an error, since most gardens will not have
 * declared every kind.
 */

import type { GardenContextFact } from '../../gardens-mapping/public.js';
import type { ObservedContextSnapshot } from '../domain/observation.js';

export function resolveObservedContextSnapshot(
  facts: readonly GardenContextFact[],
): ObservedContextSnapshot {
  const sunExposureFact = facts.find((fact) => fact.contextKind === 'sun_exposure');
  const drainageFact = facts.find((fact) => fact.contextKind === 'drainage');
  const growingContextFact = facts.find((fact) => fact.contextKind === 'growing_context');

  return {
    sunExposure: sunExposureFact?.contextKind === 'sun_exposure' ? sunExposureFact.value : null,
    drainage: drainageFact?.contextKind === 'drainage' ? drainageFact.value : null,
    growingContext:
      growingContextFact?.contextKind === 'growing_context' ? growingContextFact.value : null,
  };
}
