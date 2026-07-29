import { CANDIDATE_ID, candidateFacts, gardenFacts } from './fixture-support.js';
import type { SuitabilityFixture } from './fixture-support.js';

export const drainageCompatibilityFixtures: readonly SuitabilityFixture[] = [
  {
    name: 'exact match: well-drained garden, well-drained requirement',
    reviewNotes: 'The simplest positive case for the drainage axis.',
    garden: gardenFacts({ drainage: 'well_drained' }),
    candidate: candidateFacts({
      profileFacts: [
        { factKey: 'soilDrainage', value: 'well_drained', sourceCitation: 'USDA NRCS' },
      ],
    }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [
        {
          category: 'match',
          axis: 'drainage',
          explanation:
            "This garden's well drained soil matches the plant's well drained preference.",
          evidence: [
            { factKey: 'gardenContext.drainage', value: 'well_drained', sourceCitation: null },
            { factKey: 'soilDrainage', value: 'well_drained', sourceCitation: 'USDA NRCS' },
          ],
        },
      ],
    },
  },
  {
    name: 'adjacent mismatch: well-drained garden, poor-drainage requirement — caution',
    reviewNotes:
      'One step apart. Review: is "caution" the right severity here, or should a plant that needs poor drainage in a well-drained garden actually block?',
    garden: gardenFacts({ drainage: 'well_drained' }),
    candidate: candidateFacts({
      profileFacts: [
        { factKey: 'soilDrainage', value: 'poor_drainage', sourceCitation: 'USDA NRCS' },
      ],
    }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [
        {
          category: 'caution',
          axis: 'drainage',
          explanation:
            "This garden's well drained soil differs from the plant's poor drainage preference.",
          evidence: [
            { factKey: 'gardenContext.drainage', value: 'well_drained', sourceCitation: null },
            { factKey: 'soilDrainage', value: 'poor_drainage', sourceCitation: 'USDA NRCS' },
          ],
        },
      ],
    },
  },
  {
    name: 'opposite ends: well-drained garden, waterlogged (bog plant) requirement — blocker',
    reviewNotes:
      'Maximum distance: a bog plant in a well-drained garden. Review: confirm this should genuinely block, not merely caution.',
    garden: gardenFacts({ drainage: 'well_drained' }),
    candidate: candidateFacts({
      profileFacts: [
        { factKey: 'soilDrainage', value: 'waterlogged', sourceCitation: 'USDA NRCS' },
      ],
    }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [
        {
          category: 'blocker',
          axis: 'drainage',
          explanation:
            "This garden's well drained soil is the opposite of the plant's waterlogged preference.",
          evidence: [
            { factKey: 'gardenContext.drainage', value: 'well_drained', sourceCitation: null },
            { factKey: 'soilDrainage', value: 'waterlogged', sourceCitation: 'USDA NRCS' },
          ],
        },
      ],
    },
  },
  {
    name: 'garden context missing — unknown',
    reviewNotes:
      'No `drainage` garden-context fact declared. Must never default toward well_drained.',
    garden: gardenFacts({ drainage: null }),
    candidate: candidateFacts({
      profileFacts: [
        { factKey: 'soilDrainage', value: 'well_drained', sourceCitation: 'USDA NRCS' },
      ],
    }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [{ category: 'unknown', axis: 'drainage', reason: 'garden_context_missing' }],
    },
  },
  {
    name: 'plant fact missing — unknown',
    reviewNotes:
      'No `soilDrainage` fact resolved for this taxon (no provider adapter enabled yet).',
    garden: gardenFacts({ drainage: 'well_drained' }),
    candidate: candidateFacts({ profileFacts: [] }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [{ category: 'unknown', axis: 'drainage', reason: 'plant_fact_missing' }],
    },
  },
];
