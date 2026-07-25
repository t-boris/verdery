/**
 * Port for `tasks_recommendations.rule_version` — the append-only,
 * immutable rule-identity table P7-DATA-01 created. Insert-or-read-back
 * only: rule versions are never updated or deleted ("Rules execute
 * deterministically for the same versioned inputs" — a mutated identity
 * row would falsify every candidate pinning it).
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { RuleVersion } from '../domain/rule-version.js';

export interface RuleVersionRepository {
  findByKeyAndVersion(ruleKey: string, version: number): Promise<RuleVersion | null>;

  /**
   * Registers `ruleVersion` idempotently: when a row with the same
   * `(ruleKey, version)` already exists, the STORED row wins and is
   * returned unchanged (the given id is discarded); otherwise the given
   * row is inserted and returned. Concurrent registration of the same
   * identity is safe — implementations resolve the race in favor of
   * whichever insert committed first.
   */
  ensure(ruleVersion: RuleVersion): Promise<RuleVersion>;
}

/** The catalog's composite identity, used as a map key when pinning candidates to registered versions. */
export function ruleVersionIdentity(ruleKey: string, version: number): string {
  return `${ruleKey}@${String(version)}`;
}

export type RuleVersionIdMap = ReadonlyMap<string, Uuid>;
