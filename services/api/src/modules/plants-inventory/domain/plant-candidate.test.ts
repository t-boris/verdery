import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import {
  createCandidate,
  setCandidateStatus,
  updateCandidateDetails,
  validatePurchaseFacts,
} from './plant-candidate.js';
import type { CandidatePlacement, CandidatePurchaseFacts } from './plant-candidate.js';

const CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const OTHER_CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const NOW = new Date('2026-07-29T09:00:00Z');
const LATER = new Date('2026-07-29T10:00:00Z');

const NO_PLACEMENT: CandidatePlacement = {
  proposedGardenAreaMapObjectId: null,
  proposedPlacementMapObjectId: null,
};
const NO_PURCHASE_FACTS: CandidatePurchaseFacts = {
  priceAmount: null,
  priceCurrency: null,
  purchaseSource: null,
};

function individualCandidate(): ReturnType<typeof createCandidate> {
  return createCandidate(
    CANDIDATE_ID,
    GARDEN_ID,
    NO_PLACEMENT,
    'Maybe a fig tree',
    null,
    null,
    'individual',
    undefined,
    null,
    null,
    NO_PURCHASE_FACTS,
    null,
    PROFILE_ID,
    NOW,
  );
}

describe('createCandidate', () => {
  it('starts at revision 1, active, trimmed name, no alternative', () => {
    expect(individualCandidate()).toEqual({
      id: CANDIDATE_ID,
      gardenId: GARDEN_ID,
      proposedGardenAreaMapObjectId: null,
      proposedPlacementMapObjectId: null,
      displayName: 'Maybe a fig tree',
      taxonomyReferenceId: null,
      varietyLabel: null,
      photoAnalysis: null,
      groupingKind: 'individual',
      quantity: null,
      status: 'active',
      rationaleNote: null,
      priority: null,
      priceAmount: null,
      priceCurrency: null,
      purchaseSource: null,
      alternativeToCandidateId: null,
      revision: 1,
      createdByProfileId: PROFILE_ID,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('rejects a blank display name — reuses validateDisplayName', () => {
    expect(() =>
      createCandidate(
        CANDIDATE_ID,
        GARDEN_ID,
        NO_PLACEMENT,
        '   ',
        null,
        null,
        'individual',
        undefined,
        null,
        null,
        NO_PURCHASE_FACTS,
        null,
        PROFILE_ID,
        NOW,
      ),
    ).toThrow(ValidationError);
  });

  it('rejects a quantity on an individual candidate — reuses validateQuantityForGroupingKind', () => {
    expect(() =>
      createCandidate(
        CANDIDATE_ID,
        GARDEN_ID,
        NO_PLACEMENT,
        'Fig tree',
        null,
        null,
        'individual',
        3,
        null,
        null,
        NO_PURCHASE_FACTS,
        null,
        PROFILE_ID,
        NOW,
      ),
    ).toThrow(ValidationError);
  });

  it('accepts a row candidate with a positive quantity', () => {
    const candidate = createCandidate(
      CANDIDATE_ID,
      GARDEN_ID,
      NO_PLACEMENT,
      'Carrot row',
      null,
      null,
      'row',
      12,
      null,
      null,
      NO_PURCHASE_FACTS,
      null,
      PROFILE_ID,
      NOW,
    );
    expect(candidate.quantity).toBe(12);
  });

  it('allows naming a different candidate as an alternative', () => {
    const candidate = createCandidate(
      CANDIDATE_ID,
      GARDEN_ID,
      NO_PLACEMENT,
      'Fig tree',
      null,
      null,
      'individual',
      undefined,
      null,
      null,
      NO_PURCHASE_FACTS,
      OTHER_CANDIDATE_ID,
      PROFILE_ID,
      NOW,
    );
    expect(candidate.alternativeToCandidateId).toBe(OTHER_CANDIDATE_ID);
  });
});

describe('validatePurchaseFacts', () => {
  it('accepts a matched price amount and currency', () => {
    expect(
      validatePurchaseFacts({ priceAmount: 12.5, priceCurrency: 'USD', purchaseSource: null }),
    ).toEqual({ priceAmount: 12.5, priceCurrency: 'USD', purchaseSource: null });
  });

  it('accepts neither price nor currency', () => {
    expect(validatePurchaseFacts(NO_PURCHASE_FACTS)).toEqual(NO_PURCHASE_FACTS);
  });

  it('rejects a price amount with no currency', () => {
    expect(() =>
      validatePurchaseFacts({ priceAmount: 12.5, priceCurrency: null, purchaseSource: null }),
    ).toThrow(ValidationError);
  });

  it('rejects a currency with no price amount', () => {
    expect(() =>
      validatePurchaseFacts({ priceAmount: null, priceCurrency: 'USD', purchaseSource: null }),
    ).toThrow(ValidationError);
  });

  it('rejects a negative price amount', () => {
    expect(() =>
      validatePurchaseFacts({ priceAmount: -1, priceCurrency: 'USD', purchaseSource: null }),
    ).toThrow(ValidationError);
  });
});

describe('updateCandidateDetails', () => {
  it('bumps revision and updatedAt, applies only the named changes', () => {
    const candidate = individualCandidate();
    const updated = updateCandidateDetails(
      candidate,
      { displayName: 'Definitely a fig tree', priority: 'high' },
      LATER,
    );

    expect(updated.displayName).toBe('Definitely a fig tree');
    expect(updated.priority).toBe('high');
    expect(updated.revision).toBe(2);
    expect(updated.updatedAt).toEqual(LATER);
    expect(updated.rationaleNote).toBeNull();
  });

  it('an explicit null clears a nullable field', () => {
    const candidate = updateCandidateDetails(
      individualCandidate(),
      { rationaleNote: 'Shady spot needs something' },
      NOW,
    );
    const cleared = updateCandidateDetails(candidate, { rationaleNote: null }, LATER);

    expect(cleared.rationaleNote).toBeNull();
  });

  it('rejects an unpaired price change', () => {
    expect(() => updateCandidateDetails(individualCandidate(), { priceAmount: 20 }, LATER)).toThrow(
      ValidationError,
    );
  });
});

describe('setCandidateStatus', () => {
  it('transitions freely between active/archived/rejected, bumping revision', () => {
    const candidate = individualCandidate();
    const archived = setCandidateStatus(candidate, 'archived', LATER);

    expect(archived.status).toBe('archived');
    expect(archived.revision).toBe(2);

    const rejected = setCandidateStatus(archived, 'rejected', LATER);
    expect(rejected.status).toBe('rejected');
  });
});
