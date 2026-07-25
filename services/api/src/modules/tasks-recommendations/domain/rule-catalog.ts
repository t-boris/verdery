/**
 * The rule catalog: every rule version the application has ever shipped,
 * validated as a set at construction time — the application-owned home of
 * section 5's "versioned application-owned definitions".
 *
 * Versioning discipline is EXPLICIT-VERSION: changed rule content means a
 * new `(ruleKey, version)` entry appended here, never an edit — the same
 * append-only contract `rule_version` enforces in the database. The
 * discipline is mechanically guarded twice: `launch-rule-catalog.test.ts`
 * pins a content hash per shipped version (a content edit without a
 * version bump fails CI), and `EvaluateGardenRecommendations`'s registrar
 * refuses a persisted `rule_version` row whose safety tier disagrees with
 * the definition (the one content field the database also stores).
 *
 * Old versions stay in the catalog forever: a stored candidate pins its
 * rule version, and rendering that candidate's deterministic explanation
 * needs that exact version's template ("Model-version replay and audit",
 * section 18, applies to rules too).
 *
 * Source: architecture/recommendations-and-ai.md, section "5. Rule Engine".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { RuleDefinition } from './rule-definition.js';
import { validateRuleDefinition } from './rule-definition.js';

export class RuleCatalog {
  private readonly byKeyAndVersion = new Map<string, RuleDefinition>();
  private readonly activeByKey = new Map<string, RuleDefinition>();

  constructor(definitions: readonly RuleDefinition[]) {
    for (const definition of definitions) {
      validateRuleDefinition(definition);
      const identity = `${definition.ruleKey}@${String(definition.version)}`;
      if (this.byKeyAndVersion.has(identity)) {
        throw new ValidationError(
          SharedErrorCode.RequestInvalid,
          `Rule '${identity}' is defined more than once.`,
          {
            details: [
              {
                code: 'tasks_recommendations.rule_catalog.duplicate_version',
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

  /** Every shipped definition, catalog order — the registrar's input. */
  allVersions(): readonly RuleDefinition[] {
    return [...this.byKeyAndVersion.values()];
  }

  /**
   * The definitions an evaluation executes: the highest shipped version of
   * each rule key, in first-declared key order — a deterministic,
   * stable evaluation order.
   */
  activeRules(): readonly RuleDefinition[] {
    return [...this.activeByKey.values()];
  }

  /** One exact shipped version — how a stored candidate's template is found again. `null` when this application build never shipped it. */
  find(ruleKey: string, version: number): RuleDefinition | null {
    return this.byKeyAndVersion.get(`${ruleKey}@${String(version)}`) ?? null;
  }
}
