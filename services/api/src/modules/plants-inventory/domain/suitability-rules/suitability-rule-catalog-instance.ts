/**
 * The suitability rule catalog this application has shipped, assembled and
 * validated as one `SuitabilityRuleCatalog` — mirrors
 * `tasks-recommendations/domain/rules/launch-rule-catalog.ts`'s
 * `createLaunchRuleCatalog()` factory shape exactly.
 *
 * ALL THREE RULES ARE AWAITING HORTICULTURAL REVIEW (P11-SUIT-01) — each
 * definition says so in its own `review` metadata, and
 * `suitability-rule-catalog.test.ts` asserts it stays said until a named
 * reviewer signs off.
 *
 * Three of design doc section 10's evaluation axes have no rule yet, for an
 * honest reason each, not an oversight: hardiness has no data source wired
 * (`P11-PROV-01`'s runbook records the real one; a later work package
 * builds the adapter); mature space needs real placement-area geometry math
 * this pass does not build; user-declared preferences (child/pet/pollinator/
 * edible-garden/maintenance) have no storage anywhere yet. Adding each is a
 * pure addition to this catalog later, not a rewrite.
 */

import { SuitabilityRuleCatalog } from '../suitability-rule-catalog.js';
import { DRAINAGE_COMPATIBILITY_RULE } from './drainage-compatibility.js';
import { REGULATORY_STATUS_RULE } from './regulatory-status.js';
import { SUN_EXPOSURE_COMPATIBILITY_RULE } from './sun-exposure-compatibility.js';

/** Catalog order is evaluation order — deterministic and stable. */
export function createSuitabilityRuleCatalog(): SuitabilityRuleCatalog {
  return new SuitabilityRuleCatalog([
    SUN_EXPOSURE_COMPATIBILITY_RULE,
    DRAINAGE_COMPATIBILITY_RULE,
    REGULATORY_STATUS_RULE,
  ]);
}
