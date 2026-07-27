/**
 * The garden context facts domain's contract surface (P9D-CONTEXT-01) —
 * reviewed or declared facts about a garden's physical growing environment
 * (sun exposure, soil type, drainage, irrigation method, growing context,
 * microclimate) and their source/quality. Split out of `index.ts` purely
 * for the repository's 600-line source-file rule, the same posture
 * `organizations.ts`/`client-portal.ts` document for themselves; `index.ts`
 * re-exports everything here unchanged.
 *
 * No dedicated error-code export here: every error `listGardenContextFacts`/
 * `recordGardenContextFact` can raise is already one of the existing shared
 * codes — `SharedErrorCode.RequestInvalid`/`Forbidden`, `GardenErrorCode.
 * NotFound`/`LifecycleConflict` — since this resource introduces no new
 * "not found" or "stale revision" case of its own (a missing fact is simply
 * absent from the list; recording is create-or-update, so it is never
 * itself not-found).
 */

import type { components } from './generated/schema.js';

type Schemas = components['schemas'];

/** The garden context facts schemas (P9D-CONTEXT-01). */
export type GardenContextKind = Schemas['GardenContextKind'];
export type GardenContextSource = Schemas['GardenContextSource'];
export type GardenContextFact = Schemas['GardenContextFact'];
export type GardenContextFactListResult = Schemas['GardenContextFactListResult'];
export type RecordGardenContextFactRequest = Schemas['RecordGardenContextFactRequest'];
