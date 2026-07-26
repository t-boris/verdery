import type { ApiFailure } from '@/core/api/public';

/**
 * `SharedErrorCode.Forbidden` ('auth.forbidden') and `GardenErrorCode.
 * NotFound` ('garden.not_found') are declared as plain string literals here
 * rather than imported from `@verdery/api-contracts` — both codes are
 * already stable, shell-level failures every gateway can produce for any
 * garden read, not vocabulary specific to this feature's own domain, and
 * spelling them out keeps this one small predicate free of a dependency on
 * unrelated error-code enums.
 *
 * A caller lacking `manageGarden` on an otherwise-visible garden gets
 * `auth.forbidden` (403) — real membership, insufficient capability. A
 * caller with no relationship to the garden at all gets `garden.not_found`
 * (404) — existence concealed, the same posture `getGarden` already takes.
 * Both mean the SAME thing to `garden-assignments-section.tsx` and
 * `garden-engagements-section.tsx`: this read is not for this caller, and
 * the section should render nothing rather than a "Forbidden" alert every
 * non-owner member would otherwise see on every visit to their own garden's
 * settings page.
 */
const CONCEALED_ACCESS_CODES: ReadonlySet<string> = new Set(['auth.forbidden', 'garden.not_found']);

export function isConcealedAccessFailure(failure: ApiFailure): boolean {
  return CONCEALED_ACCESS_CODES.has(failure.code) && failure.kind === 'contract';
}
