import { describe, expect, it } from 'vitest';
import { assemblePlantProfileVersion } from './plant-profile-version.js';
import type { FactCandidate } from './plant-profile-version.js';

const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const TAXONOMY_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const NOW = new Date('2026-07-29T12:00:00Z');
const EARLIER = new Date('2026-07-01T12:00:00Z');

function fact(
  overrides: Partial<FactCandidate> & { factKey: string; providerKey: string },
): FactCandidate {
  return {
    value: 5,
    unit: null,
    geographicScope: null,
    confidence: null,
    reviewStatus: 'horticulturally_reviewed',
    sourceCitation: null,
    fetchedAt: null,
    ...overrides,
  };
}

describe('assemblePlantProfileVersion', () => {
  it('resolves an empty input as fully partial', () => {
    const version = assemblePlantProfileVersion(
      PROFILE_ID,
      TAXONOMY_ID,
      { facts: [], sourcePriority: [] },
      NOW,
    );
    expect(version.resolvedFacts).toEqual([]);
    expect(version.isPartial).toBe(true);
  });

  it('excludes an unreviewed proposal that carries no cited source', () => {
    const version = assemblePlantProfileVersion(
      PROFILE_ID,
      TAXONOMY_ID,
      {
        facts: [
          fact({
            factKey: 'hardinessZoneMin',
            providerKey: 'usda-plants',
            reviewStatus: 'awaiting_horticultural_review',
          }),
        ],
        sourcePriority: [],
      },
      NOW,
    );
    expect(version.resolvedFacts).toEqual([]);
    expect(version.isPartial).toBe(true);
  });

  it('presents an unreviewed cited provider claim as source-backed', () => {
    const version = assemblePlantProfileVersion(
      PROFILE_ID,
      TAXONOMY_ID,
      {
        facts: [
          fact({
            factKey: 'growth_habit',
            providerKey: 'usda-plants',
            reviewStatus: 'awaiting_horticultural_review',
            sourceCitation: 'USDA PLANTS Database',
          }),
        ],
        sourcePriority: ['usda-plants'],
      },
      NOW,
    );

    expect(version.resolvedFacts).toEqual([
      expect.objectContaining({
        factKey: 'growth_habit',
        evidenceStatus: 'source_backed',
        sourceCitation: 'USDA PLANTS Database',
      }),
    ]);
    expect(version.isPartial).toBe(false);
  });

  it('resolves a single reviewed fact with no conflict', () => {
    const version = assemblePlantProfileVersion(
      PROFILE_ID,
      TAXONOMY_ID,
      {
        facts: [fact({ factKey: 'hardinessZoneMin', providerKey: 'usda-plants', value: 6 })],
        sourcePriority: [],
      },
      NOW,
    );
    expect(version.resolvedFacts).toEqual([
      {
        factKey: 'hardinessZoneMin',
        value: 6,
        unit: null,
        geographicScope: null,
        providerKey: 'usda-plants',
        confidence: null,
        sourceCitation: null,
        evidenceStatus: 'horticulturally_reviewed',
      },
    ]);
    expect(version.isPartial).toBe(false);
  });

  it('prefers the higher-priority provider when two reviewed sources conflict', () => {
    const version = assemblePlantProfileVersion(
      PROFILE_ID,
      TAXONOMY_ID,
      {
        facts: [
          fact({ factKey: 'hardinessZoneMin', providerKey: 'wikidata', value: 5 }),
          fact({ factKey: 'hardinessZoneMin', providerKey: 'usda-plants', value: 6 }),
        ],
        sourcePriority: ['usda-plants', 'wikidata'],
      },
      NOW,
    );
    expect(version.resolvedFacts).toHaveLength(1);
    expect(version.resolvedFacts[0]).toMatchObject({ providerKey: 'usda-plants', value: 6 });
  });

  it('prefers horticultural review over an otherwise higher-priority source-backed claim', () => {
    const version = assemblePlantProfileVersion(
      PROFILE_ID,
      TAXONOMY_ID,
      {
        facts: [
          fact({
            factKey: 'growth_habit',
            providerKey: 'preferred-source',
            sourceCitation: 'Preferred source',
            reviewStatus: 'awaiting_horticultural_review',
            value: 'Tree',
          }),
          fact({
            factKey: 'growth_habit',
            providerKey: 'reviewed-source',
            value: 'Shrub',
          }),
        ],
        sourcePriority: ['preferred-source', 'reviewed-source'],
      },
      NOW,
    );

    expect(version.resolvedFacts[0]).toMatchObject({
      value: 'Shrub',
      evidenceStatus: 'horticulturally_reviewed',
    });
  });

  it('falls back to confidence when neither provider is in the priority list', () => {
    const version = assemblePlantProfileVersion(
      PROFILE_ID,
      TAXONOMY_ID,
      {
        facts: [
          fact({ factKey: 'matureHeightCm', providerKey: 'source-a', confidence: 0.6 }),
          fact({ factKey: 'matureHeightCm', providerKey: 'source-b', confidence: 0.9 }),
        ],
        sourcePriority: [],
      },
      NOW,
    );
    expect(version.resolvedFacts[0]).toMatchObject({ providerKey: 'source-b', confidence: 0.9 });
  });

  it('falls back to the more recently fetched assertion when priority and confidence tie', () => {
    const version = assemblePlantProfileVersion(
      PROFILE_ID,
      TAXONOMY_ID,
      {
        facts: [
          fact({
            factKey: 'matureHeightCm',
            providerKey: 'source-a',
            confidence: 0.8,
            fetchedAt: EARLIER,
          }),
          fact({
            factKey: 'matureHeightCm',
            providerKey: 'source-b',
            confidence: 0.8,
            fetchedAt: NOW,
          }),
        ],
        sourcePriority: [],
      },
      NOW,
    );
    expect(version.resolvedFacts[0]).toMatchObject({ providerKey: 'source-b' });
  });

  it('breaks a full tie alphabetically by provider key, deterministically', () => {
    const version = assemblePlantProfileVersion(
      PROFILE_ID,
      TAXONOMY_ID,
      {
        facts: [
          fact({ factKey: 'matureHeightCm', providerKey: 'zzz-source' }),
          fact({ factKey: 'matureHeightCm', providerKey: 'aaa-source' }),
        ],
        sourcePriority: [],
      },
      NOW,
    );
    expect(version.resolvedFacts[0]).toMatchObject({ providerKey: 'aaa-source' });
  });

  it('resolves different geographic scopes of the same fact key independently, both surviving', () => {
    const version = assemblePlantProfileVersion(
      PROFILE_ID,
      TAXONOMY_ID,
      {
        facts: [
          fact({
            factKey: 'nativeStatus',
            providerKey: 'usda-plants',
            geographicScope: 'US-CA',
            value: 'native',
          }),
          fact({
            factKey: 'nativeStatus',
            providerKey: 'usda-plants',
            geographicScope: 'US-NY',
            value: 'introduced',
          }),
        ],
        sourcePriority: [],
      },
      NOW,
    );
    expect(version.resolvedFacts).toHaveLength(2);
    expect(version.isPartial).toBe(false);
  });

  it('is partial when one fact key resolves but a second is only unreviewed', () => {
    const version = assemblePlantProfileVersion(
      PROFILE_ID,
      TAXONOMY_ID,
      {
        facts: [
          fact({ factKey: 'hardinessZoneMin', providerKey: 'usda-plants', value: 6 }),
          fact({
            factKey: 'soilPhMin',
            providerKey: 'usda-nrcs',
            reviewStatus: 'awaiting_horticultural_review',
          }),
        ],
        sourcePriority: [],
      },
      NOW,
    );
    expect(version.resolvedFacts).toHaveLength(1);
    expect(version.isPartial).toBe(true);
  });

  it('carries the winning source citation forward for attribution', () => {
    const version = assemblePlantProfileVersion(
      PROFILE_ID,
      TAXONOMY_ID,
      {
        facts: [
          fact({
            factKey: 'hardinessZoneMin',
            providerKey: 'usda-plants',
            sourceCitation: 'USDA PLANTS Database, accessed 2026-07-29',
          }),
        ],
        sourcePriority: [],
      },
      NOW,
    );
    expect(version.resolvedFacts[0]?.sourceCitation).toBe(
      'USDA PLANTS Database, accessed 2026-07-29',
    );
  });
});
