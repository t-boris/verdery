import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaxonomySeasonalFact } from '../domain/taxonomy-seasonal-fact.js';
import {
  ApproveTaxonomySeasonalFactReview,
  ListTaxonomySeasonalFactsAwaitingReview,
} from './review-taxonomy-seasonal-facts.js';
import type {
  TaxonomySeasonalFactRepository,
  TaxonomySeasonalFactReviewItem,
} from './taxonomy-seasonal-fact-repository.js';

const FACT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e01' as Uuid;
const TAXON_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e02' as Uuid;
const NOW = new Date('2026-08-07T12:00:00Z');
const REVIEWERS = ['reviewer@example.test'];

// A verified email is what the allowlist matches on — an unverified one is
// a claim, not an identity.
const REVIEWER = { email: 'Reviewer@Example.test', emailVerified: true };
const OUTSIDER = { email: 'someone@example.test', emailVerified: true };

function awaitingFact(): TaxonomySeasonalFact {
  return {
    id: FACT_ID,
    taxonomyReferenceId: TAXON_ID,
    hemisphere: 'northern',
    sowIndoorsStartMonth: 2,
    sowIndoorsEndMonth: 3,
    sowOutdoorsStartMonth: null,
    sowOutdoorsEndMonth: null,
    transplantStartMonth: 5,
    transplantEndMonth: 6,
    harvestStartMonth: 7,
    harvestEndMonth: 10,
    daysToMaturityMin: 60,
    daysToMaturityMax: 90,
    successionIntervalDays: null,
    rotationRestSeasons: 3,
    authoringMethod: 'ai_extracted_from_source',
    sourceCitation: 'USDA National Agricultural Library (public domain)',
    reviewStatus: 'awaiting_horticultural_review',
    createdAt: NOW,
  };
}

/** In-memory repository recording what the command actually wrote. */
class FakeRepository implements TaxonomySeasonalFactRepository {
  approvedWith: { id: Uuid; reviewedBy: string; reviewedOn: string } | null = null;

  constructor(private readonly awaiting: TaxonomySeasonalFact[] = [awaitingFact()]) {}

  findReviewedForTaxonomyAndHemisphere(): Promise<TaxonomySeasonalFact | null> {
    return Promise.resolve(null);
  }

  listAwaitingReview(limit: number): Promise<readonly TaxonomySeasonalFactReviewItem[]> {
    return Promise.resolve(
      this.awaiting.slice(0, limit).map((fact) => ({
        fact,
        scientificName: 'Solanum lycopersicum',
        commonName: 'Tomato',
      })),
    );
  }

  approve(id: Uuid, reviewedBy: string, reviewedOn: string): Promise<boolean> {
    if (!this.awaiting.some((fact) => fact.id === id)) {
      return Promise.resolve(false);
    }
    this.approvedWith = { id, reviewedBy, reviewedOn };
    return Promise.resolve(true);
  }
}

const clock = { now: () => NOW };

describe('ListTaxonomySeasonalFactsAwaitingReview', () => {
  it('serves the queue with the taxon name — months against a UUID are not reviewable', async () => {
    const list = new ListTaxonomySeasonalFactsAwaitingReview(new FakeRepository(), REVIEWERS);

    const items = await list.execute(REVIEWER);

    expect(items).toHaveLength(1);
    expect(items[0]?.scientificName).toBe('Solanum lycopersicum');
    expect(items[0]?.fact.reviewStatus).toBe('awaiting_horticultural_review');
  });

  it('refuses a caller who is not an allowlisted reviewer', async () => {
    const list = new ListTaxonomySeasonalFactsAwaitingReview(new FakeRepository(), REVIEWERS);

    await expect(list.execute(OUTSIDER)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses everyone when no reviewer is configured — an empty allowlist grants nothing', async () => {
    const list = new ListTaxonomySeasonalFactsAwaitingReview(new FakeRepository(), []);

    await expect(list.execute(REVIEWER)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('ApproveTaxonomySeasonalFactReview', () => {
  it('records the CALLER as the reviewer, never a supplied string', async () => {
    const repository = new FakeRepository();
    const approve = new ApproveTaxonomySeasonalFactReview(repository, REVIEWERS, clock);

    const result = await approve.execute(FACT_ID, REVIEWER);

    expect(result).toEqual({
      outcome: 'approved',
      reviewedBy: 'reviewer@example.test',
      reviewedOn: '2026-08-07',
    });
    // Lower-cased from the actor's own verified email: a reviewer can only
    // ever record themselves, which is what makes `reviewed_by` accountable.
    expect(repository.approvedWith?.reviewedBy).toBe('reviewer@example.test');
  });

  it('reports an already-reviewed row and a missing one identically', async () => {
    const approve = new ApproveTaxonomySeasonalFactReview(new FakeRepository([]), REVIEWERS, clock);

    const result = await approve.execute(FACT_ID, REVIEWER);

    // Separating the two would let an unauthorized probe confirm an id
    // exists; both mean "nothing left for this caller to approve".
    expect(result).toEqual({ outcome: 'alreadyReviewedOrMissing' });
  });

  it('refuses a caller who is not an allowlisted reviewer, before touching the row', async () => {
    const repository = new FakeRepository();
    const approve = new ApproveTaxonomySeasonalFactReview(repository, REVIEWERS, clock);

    await expect(approve.execute(FACT_ID, OUTSIDER)).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.approvedWith).toBeNull();
  });
});
