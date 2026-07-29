/**
 * The suitability rule catalog: every rule version ever shipped, validated
 * as a set at construction time — mirrors
 * `tasks-recommendations/domain/rule-catalog.ts`'s `RuleCatalog` exactly.
 * A changed rule means a new `(ruleKey, version)` entry appended, never an
 * edit — guarded by `suitability-rule-catalog.test.ts`'s pinned content
 * hash per version, the same mechanical discipline
 * `launch-rule-catalog.test.ts` already enforces for recommendations.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { SuitabilityRuleDefinition } from './suitability-rule-definition.js';
import { validateSuitabilityRuleDefinition } from './suitability-rule-definition.js';

export class SuitabilityRuleCatalog {
  private readonly byKeyAndVersion = new Map<string, SuitabilityRuleDefinition>();
  private readonly activeByKey = new Map<string, SuitabilityRuleDefinition>();

  constructor(definitions: readonly SuitabilityRuleDefinition[]) {
    for (const definition of definitions) {
      validateSuitabilityRuleDefinition(definition);
      const identity = `${definition.ruleKey}@${String(definition.version)}`;
      if (this.byKeyAndVersion.has(identity)) {
        throw new ValidationError(
          SharedErrorCode.RequestInvalid,
          `Rule '${identity}' is defined more than once.`,
          {
            details: [
              {
                code: 'plants_inventory.suitability_rule_catalog.duplicate_version',
                pointer: `/rules/${definition.ruleKey}`,
              },
            ],
          },
        );
      }
      this.byKeyAndVersion.set(identity, definition);

      const current = this.activeByKey.get(definition.ruleKey);
      if (current === undefined || definition.version > current.version) {
        this.activeByKey.set(definition.ruleKey, definition);
      }
    }
  }

  /** Every shipped definition, catalog order. */
  allVersions(): readonly SuitabilityRuleDefinition[] {
    return [...this.byKeyAndVersion.values()];
  }

  /** The highest shipped version of each rule key, in first-declared key order — a deterministic, stable evaluation order. */
  activeRules(): readonly SuitabilityRuleDefinition[] {
    return [...this.activeByKey.values()];
  }

  find(ruleKey: string, version: number): SuitabilityRuleDefinition | null {
    return this.byKeyAndVersion.get(`${ruleKey}@${String(version)}`) ?? null;
  }
}
