import { CANDIDATE_ID, candidateFacts, gardenFacts } from './fixture-support.js';
import type { SuitabilityFixture } from './fixture-support.js';

export const sunExposureCompatibilityFixtures: readonly SuitabilityFixture[] = [
  {
    name: 'exact match: full sun garden, full sun requirement',
    reviewNotes:
      'The simplest positive case. Review: is an exact vocabulary match the right bar for "match", or should some tolerance still read as caution?',
    garden: gardenFacts({ sunExposure: 'full_sun' }),
    candidate: candidateFacts({
      profileFacts: [
        { factKey: 'sunRequirement', value: 'full_sun', sourceCitation: 'USDA PLANTS' },
      ],
    }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [
        {
          category: 'match',
          axis: 'sun_exposure',
          explanation: "This garden's full sun matches the plant's full sun requirement.",
          evidence: [
            { factKey: 'gardenContext.sunExposure', value: 'full_sun', sourceCitation: null },
            { factKey: 'sunRequirement', value: 'full_sun', sourceCitation: 'USDA PLANTS' },
          ],
        },
      ],
    },
  },
  {
    name: 'adjacent mismatch: full sun garden, partial sun requirement — caution not blocker',
    reviewNotes:
      'One step apart on the ordinal scale. Review: is "caution" (not blocker) the right severity for adjacent mismatches, given plants often tolerate a wider range than their nominal requirement?',
    garden: gardenFacts({ sunExposure: 'full_sun' }),
    candidate: candidateFacts({
      profileFacts: [
        { factKey: 'sunRequirement', value: 'partial_sun', sourceCitation: 'USDA PLANTS' },
      ],
    }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [
        {
          category: 'caution',
          axis: 'sun_exposure',
          explanation:
            "This garden's full sun is close to, but not exactly, the plant's partial sun requirement.",
          evidence: [
            { factKey: 'gardenContext.sunExposure', value: 'full_sun', sourceCitation: null },
            { factKey: 'sunRequirement', value: 'partial_sun', sourceCitation: 'USDA PLANTS' },
          ],
        },
      ],
    },
  },
  {
    name: 'opposite ends: full sun garden, full shade requirement — blocker',
    reviewNotes:
      'Maximum ordinal distance. Review: should a full-sun-vs-full-shade mismatch really block, or only caution, given microclimates within one garden?',
    garden: gardenFacts({ sunExposure: 'full_sun' }),
    candidate: candidateFacts({
      profileFacts: [
        { factKey: 'sunRequirement', value: 'full_shade', sourceCitation: 'USDA PLANTS' },
      ],
    }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [
        {
          category: 'blocker',
          axis: 'sun_exposure',
          explanation: "This garden's full sun is far from the plant's full shade requirement.",
          evidence: [
            { factKey: 'gardenContext.sunExposure', value: 'full_sun', sourceCitation: null },
            { factKey: 'sunRequirement', value: 'full_shade', sourceCitation: 'USDA PLANTS' },
          ],
        },
      ],
    },
  },
  {
    name: 'garden context missing — unknown, never a default toward a positive match',
    reviewNotes:
      'No `sun_exposure` garden-context fact declared. Review: confirm this never silently defaults to full_sun (the common case) — it must surface as an honest unknown.',
    garden: gardenFacts({ sunExposure: null }),
    candidate: candidateFacts({
      profileFacts: [
        { factKey: 'sunRequirement', value: 'full_sun', sourceCitation: 'USDA PLANTS' },
      ],
    }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [{ category: 'unknown', axis: 'sun_exposure', reason: 'garden_context_missing' }],
    },
  },
  {
    name: 'plant fact missing — unknown, no live provider adapter yet',
    reviewNotes:
      "No `sunRequirement` fact resolved for this taxon's profile (honest today: no provider adapter is enabled yet). Review: confirm the finding is unknown, never assumed compatible.",
    garden: gardenFacts({ sunExposure: 'full_sun' }),
    candidate: candidateFacts({ profileFacts: [] }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [{ category: 'unknown', axis: 'sun_exposure', reason: 'plant_fact_missing' }],
    },
  },
];
