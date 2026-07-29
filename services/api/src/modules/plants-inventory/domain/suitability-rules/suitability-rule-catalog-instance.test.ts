/**
 * The suitability catalog's own guarantees: honest review state and the
 * explicit-version content discipline — mirrors `tasks-recommendations/
 * domain/rules/launch-rule-catalog.test.ts` exactly, retargeted to the much
 * smaller declarative content a suitability rule carries (`ruleKey`,
 * `version`, `axis` — no timing/weatherPolicy/parameters to hash, since a
 * suitability rule's tunables live inline in its own ordinal-distance
 * table, itself covered by the fixture suite's behavioral pinning).
 *
 * WHEN THIS TEST FAILS after an intentional content change: ship the
 * change as a NEW version appended to the catalog and add its hash here —
 * never update a shipped version's hash in place.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SuitabilityRuleDefinition } from '../suitability-rule-definition.js';
import { createSuitabilityRuleCatalog } from './suitability-rule-catalog-instance.js';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function ruleContentHash(definition: SuitabilityRuleDefinition): string {
  const content = {
    ruleKey: definition.ruleKey,
    version: definition.version,
    axis: definition.axis,
  };
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

const PINNED_CONTENT_HASHES: Record<string, string> = {
  'suitability.sun_exposure_compatibility@1':
    '713be22e4c275ace2a60b06aed82705c8903762fe493a12faf62f53413d9074e',
  'suitability.drainage_compatibility@1':
    '35163c53dba512f514dde73b9390232bcc1b51eccdfc87ba4070ad7d03fcbebb',
  'suitability.regulatory_status@1':
    '4e501950f295e919a00ecf66bade3eff7df855925fc828e429c78ec0965e336e',
};

describe('createSuitabilityRuleCatalog', () => {
  const catalog = createSuitabilityRuleCatalog();
  const active = catalog.activeRules();

  it('ships exactly the three expected rule keys, each awaiting horticultural review', () => {
    expect(active.map((rule) => rule.ruleKey).sort()).toEqual([
      'suitability.drainage_compatibility',
      'suitability.regulatory_status',
      'suitability.sun_exposure_compatibility',
    ]);
    for (const rule of active) {
      expect(rule.review).toEqual({
        reviewStatus: 'awaiting_horticultural_review',
        awaitingReviewBy: 'P11-SUIT-01',
      });
    }
  });

  it('pins a content hash per shipped (ruleKey, version) — fails if declarative content changes without a version bump', () => {
    for (const definition of catalog.allVersions()) {
      const identity = `${definition.ruleKey}@${String(definition.version)}`;
      const hash = ruleContentHash(definition);
      const pinned = PINNED_CONTENT_HASHES[identity];
      expect(pinned, `no pinned hash recorded for ${identity} — add one`).toBeDefined();
      expect(hash, `content hash for ${identity} changed — ship a new version instead`).toBe(
        pinned,
      );
    }
    expect(Object.keys(PINNED_CONTENT_HASHES)).toHaveLength(catalog.allVersions().length);
  });

  it('assigns every rule a distinct axis from the closed vocabulary', () => {
    const axes = active.map((rule) => rule.axis);
    expect(new Set(axes).size).toBe(axes.length);
  });
});
