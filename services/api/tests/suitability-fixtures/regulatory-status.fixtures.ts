import { CANDIDATE_ID, candidateFacts, gardenFacts } from './fixture-support.js';
import type { SuitabilityFixture } from './fixture-support.js';

export const regulatoryStatusFixtures: readonly SuitabilityFixture[] = [
  {
    name: 'no distribution facts at all — unknown',
    reviewNotes:
      'No reviewed distribution assertion exists for this taxon anywhere. Must not be read as "confirmed unregulated."',
    garden: gardenFacts({}),
    candidate: candidateFacts({ distributionFacts: [] }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [{ category: 'unknown', axis: 'regulatory_status', reason: 'plant_fact_missing' }],
    },
  },
  {
    name: 'garden region known and matched, status native — a real match (future path once region resolution ships)',
    reviewNotes:
      "Exercises the region !== null branch, which today's fact-assembly never populates (no garden-to-region resolution exists yet) but which the rule already implements correctly for when it does.",
    garden: gardenFacts({ region: 'US-CA' }),
    candidate: candidateFacts({
      distributionFacts: [{ region: 'US-CA', status: 'native', sourceCitation: 'USDA PLANTS' }],
    }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [
        {
          category: 'match',
          axis: 'regulatory_status',
          explanation:
            "This plant is native in US-CA, this garden's own region — no regulatory restriction applies.",
          evidence: [
            { factKey: 'distribution.US-CA', value: 'native', sourceCitation: 'USDA PLANTS' },
          ],
        },
      ],
    },
  },
  {
    name: 'garden region known and matched, status invasive — a real blocker',
    reviewNotes: 'Region-matched invasive status is confident enough to block, not merely caution.',
    garden: gardenFacts({ region: 'US-MI' }),
    candidate: candidateFacts({
      distributionFacts: [{ region: 'US-MI', status: 'invasive', sourceCitation: 'USDA PLANTS' }],
    }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [
        {
          category: 'blocker',
          axis: 'regulatory_status',
          explanation: "This plant is invasive in US-MI, this garden's own region.",
          evidence: [
            { factKey: 'distribution.US-MI', value: 'invasive', sourceCitation: 'USDA PLANTS' },
          ],
        },
      ],
    },
  },
  {
    name: 'garden region known but no assertion exists for it — unknown, not assumed clear',
    reviewNotes:
      'Region-matching found no row for this exact region, even though other regions have data — must not fall back to those.',
    garden: gardenFacts({ region: 'US-NY' }),
    candidate: candidateFacts({
      distributionFacts: [{ region: 'US-CA', status: 'native', sourceCitation: 'USDA PLANTS' }],
    }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [{ category: 'unknown', axis: 'regulatory_status', reason: 'plant_fact_missing' }],
    },
  },
  {
    name: "region unknown (today's reality), at least one region flags invasive — caution, not a hard blocker",
    reviewNotes:
      "The honest degraded case this rule ships with today: no garden-region resolution exists, so a real invasive flag elsewhere on record becomes a caution, since this garden's own applicability cannot be confirmed. Review: is caution (rather than blocker) the right posture for an unconfirmed-region invasive signal?",
    garden: gardenFacts({ region: null }),
    candidate: candidateFacts({
      distributionFacts: [
        { region: 'US-MI', status: 'invasive', sourceCitation: 'USDA PLANTS' },
        { region: 'US-CA', status: 'native', sourceCitation: 'USDA PLANTS' },
      ],
    }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [
        {
          category: 'caution',
          axis: 'regulatory_status',
          explanation:
            "This plant is invasive or regulated in at least one US region on record (US-MI); this garden's own region could not be confirmed.",
          evidence: [
            { factKey: 'distribution.US-MI', value: 'invasive', sourceCitation: 'USDA PLANTS' },
          ],
        },
      ],
    },
  },
  {
    name: 'region unknown, no region flags invasive/regulated — an explicit assumption, not a silent match',
    reviewNotes:
      "No red flag anywhere on record, but the garden's own region is still unconfirmed — this must surface as 'assumption', never 'match', since absence-elsewhere is not the same as confirmed-safe-here. Review: is this the right honesty boundary, or should absence across every region on record be treated as a real match instead?",
    garden: gardenFacts({ region: null }),
    candidate: candidateFacts({
      distributionFacts: [
        { region: 'US-CA', status: 'native', sourceCitation: 'USDA PLANTS' },
        { region: 'US-TX', status: 'introduced', sourceCitation: 'USDA PLANTS' },
      ],
    }),
    expected: {
      candidateId: CANDIDATE_ID,
      findings: [
        {
          category: 'assumption',
          axis: 'regulatory_status',
          explanation:
            "No region on record flags this plant as invasive or regulated; this garden's own region could not be confirmed, so absence of a flag elsewhere is assumed (not verified) to extend here.",
          assumedValue: 'not_regulated',
        },
      ],
    },
  },
];
