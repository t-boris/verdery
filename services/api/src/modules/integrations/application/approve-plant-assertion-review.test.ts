import { describe, expect, it } from 'vitest';
import { createPlantDistributionAssertion } from '../domain/plant-distribution-assertion.js';
import { createPlantFactAssertion } from '../domain/plant-fact-assertion.js';
import { fixedClock } from './integrations-test-doubles.js';
import { ApprovePlantAssertionReview } from './approve-plant-assertion-review.js';
import {
  InMemoryPlantDistributionAssertionRepository,
  InMemoryPlantFactAssertionRepository,
} from './plant-assertion-provider-test-doubles.js';

const NOW = new Date('2026-08-01T12:00:00.000Z');
const REVIEWER = { email: 'reviewer@example.com', emailVerified: true };

function pendingFact() {
  return createPlantFactAssertion({
    id: 'fact-1',
    rawProviderTaxonId: 'gbif-2879737',
    rawFactKey: 'occurrence_evidence_count',
    factValue: '51258',
    unit: 'records',
    confidence: null,
    geographicScope: null,
    authoring: {
      authoringMethod: 'ai_extracted_from_source',
      providerKey: 'gbif',
      sourceCitation: 'GBIF.org',
    },
    review: { reviewStatus: 'awaiting_horticultural_review' },
    fetchedAt: NOW,
    now: NOW,
  });
}

function pendingDistribution() {
  return createPlantDistributionAssertion({
    id: 'dist-1',
    rawProviderTaxonId: '70172',
    rawRegion: 'L48',
    rawStatus: 'native',
    confidence: null,
    authoring: {
      authoringMethod: 'ai_extracted_from_source',
      providerKey: 'usda-plants',
      sourceCitation: 'USDA',
    },
    review: { reviewStatus: 'awaiting_horticultural_review' },
    fetchedAt: NOW,
    now: NOW,
  });
}

describe('ApprovePlantAssertionReview', () => {
  it('approves a pending fact assertion, stamping the actor as reviewedBy and the clock-derived reviewedOn', async () => {
    const facts = new InMemoryPlantFactAssertionRepository();
    const distributions = new InMemoryPlantDistributionAssertionRepository();
    facts.assertions.push(pendingFact());
    const approve = new ApprovePlantAssertionReview(
      facts,
      distributions,
      [REVIEWER.email],
      fixedClock(NOW),
    );

    const result = await approve.execute({ kind: 'fact', assertionId: 'fact-1' }, REVIEWER);

    expect(result).toEqual({ outcome: 'approved' });
    expect(facts.assertions[0]?.provenance).toMatchObject({
      reviewStatus: 'horticulturally_reviewed',
      reviewedBy: 'reviewer@example.com',
      reviewedOn: '2026-08-01',
    });
  });

  it('approves a pending distribution assertion the same way', async () => {
    const facts = new InMemoryPlantFactAssertionRepository();
    const distributions = new InMemoryPlantDistributionAssertionRepository();
    distributions.assertions.push(pendingDistribution());
    const approve = new ApprovePlantAssertionReview(
      facts,
      distributions,
      [REVIEWER.email],
      fixedClock(NOW),
    );

    const result = await approve.execute({ kind: 'distribution', assertionId: 'dist-1' }, REVIEWER);

    expect(result).toEqual({ outcome: 'approved' });
    expect(distributions.assertions[0]?.provenance).toMatchObject({
      reviewStatus: 'horticulturally_reviewed',
      reviewedBy: 'reviewer@example.com',
      reviewedOn: '2026-08-01',
    });
  });

  it('answers alreadyReviewedOrMissing for an id that does not exist', async () => {
    const facts = new InMemoryPlantFactAssertionRepository();
    const distributions = new InMemoryPlantDistributionAssertionRepository();
    const approve = new ApprovePlantAssertionReview(
      facts,
      distributions,
      [REVIEWER.email],
      fixedClock(NOW),
    );

    const result = await approve.execute({ kind: 'fact', assertionId: 'does-not-exist' }, REVIEWER);

    expect(result).toEqual({ outcome: 'alreadyReviewedOrMissing' });
  });

  it('answers alreadyReviewedOrMissing for an assertion already reviewed (a lost race)', async () => {
    const facts = new InMemoryPlantFactAssertionRepository();
    const distributions = new InMemoryPlantDistributionAssertionRepository();
    facts.assertions.push(
      createPlantFactAssertion({
        id: 'fact-1',
        rawProviderTaxonId: 'gbif-2879737',
        rawFactKey: 'occurrence_evidence_count',
        factValue: '51258',
        unit: 'records',
        confidence: null,
        geographicScope: null,
        authoring: {
          authoringMethod: 'ai_extracted_from_source',
          providerKey: 'gbif',
          sourceCitation: 'GBIF.org',
        },
        review: {
          reviewStatus: 'horticulturally_reviewed',
          reviewedBy: 'first@example.com',
          reviewedOn: '2026-07-30',
        },
        fetchedAt: NOW,
        now: NOW,
      }),
    );
    const approve = new ApprovePlantAssertionReview(
      facts,
      distributions,
      [REVIEWER.email],
      fixedClock(NOW),
    );

    const result = await approve.execute({ kind: 'fact', assertionId: 'fact-1' }, REVIEWER);

    expect(result).toEqual({ outcome: 'alreadyReviewedOrMissing' });
    expect(facts.assertions[0]?.provenance).toMatchObject({ reviewedBy: 'first@example.com' });
  });

  it('rejects an actor whose email is not on the reviewer allowlist, before ever touching the repository', async () => {
    const facts = new InMemoryPlantFactAssertionRepository();
    const distributions = new InMemoryPlantDistributionAssertionRepository();
    facts.assertions.push(pendingFact());
    const approve = new ApprovePlantAssertionReview(
      facts,
      distributions,
      [REVIEWER.email],
      fixedClock(NOW),
    );

    await expect(
      approve.execute(
        { kind: 'fact', assertionId: 'fact-1' },
        { email: 'not-a-reviewer@example.com', emailVerified: true },
      ),
    ).rejects.toThrow();
    expect(facts.assertions[0]?.provenance.reviewStatus).toBe('awaiting_horticultural_review');
  });

  it('rejects an actor with an unverified email, even if the address is on the allowlist', async () => {
    const facts = new InMemoryPlantFactAssertionRepository();
    const distributions = new InMemoryPlantDistributionAssertionRepository();
    facts.assertions.push(pendingFact());
    const approve = new ApprovePlantAssertionReview(
      facts,
      distributions,
      [REVIEWER.email],
      fixedClock(NOW),
    );

    await expect(
      approve.execute(
        { kind: 'fact', assertionId: 'fact-1' },
        { email: REVIEWER.email, emailVerified: false },
      ),
    ).rejects.toThrow();
    expect(facts.assertions[0]?.provenance.reviewStatus).toBe('awaiting_horticultural_review');
  });

  it('rejects every actor when no reviewer is configured', async () => {
    const facts = new InMemoryPlantFactAssertionRepository();
    const distributions = new InMemoryPlantDistributionAssertionRepository();
    facts.assertions.push(pendingFact());
    const approve = new ApprovePlantAssertionReview(facts, distributions, [], fixedClock(NOW));

    await expect(
      approve.execute({ kind: 'fact', assertionId: 'fact-1' }, REVIEWER),
    ).rejects.toThrow();
  });
});
