import { describe, expect, it } from 'vitest';
import {
  DomainRuleViolatedError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import { archiveGarden, createGarden, renameGarden, requestGardenDeletion } from './garden.js';

const OWNER_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const NOW = new Date('2026-07-21T09:00:00Z');
const LATER = new Date('2026-07-21T10:00:00Z');

describe('createGarden', () => {
  it('starts active at revision 1, trimmed, with the creator as the only implicit owner reference', () => {
    const garden = createGarden(GARDEN_ID, '  Backyard  ', OWNER_ID, NOW);

    expect(garden).toEqual({
      id: GARDEN_ID,
      name: 'Backyard',
      lifecycleState: 'active',
      revision: 1,
      createdByProfileId: OWNER_ID,
      createdAt: NOW,
      updatedAt: NOW,
      deletionRequestedAt: null,
    });
  });

  it('rejects a blank name, including one that is blank only after trimming', () => {
    expect(() => createGarden(GARDEN_ID, '   ', OWNER_ID, NOW)).toThrow(ValidationError);
  });

  it('rejects a name over 120 characters', () => {
    expect(() => createGarden(GARDEN_ID, 'x'.repeat(121), OWNER_ID, NOW)).toThrow(ValidationError);
  });

  it('accepts a name at exactly the 120 character limit', () => {
    const garden = createGarden(GARDEN_ID, 'x'.repeat(120), OWNER_ID, NOW);
    expect(garden.name).toHaveLength(120);
  });
});

describe('renameGarden', () => {
  it('increments the revision and updates the timestamp', () => {
    const garden = createGarden(GARDEN_ID, 'Backyard', OWNER_ID, NOW);
    const renamed = renameGarden(garden, 'Front Yard', LATER);

    expect(renamed.name).toBe('Front Yard');
    expect(renamed.revision).toBe(2);
    expect(renamed.updatedAt).toBe(LATER);
  });

  it('rejects renaming a garden pending deletion', () => {
    const garden = requestGardenDeletion(createGarden(GARDEN_ID, 'Backyard', OWNER_ID, NOW), LATER);
    expect(() => renameGarden(garden, 'New Name', LATER)).toThrow(DomainRuleViolatedError);
  });

  it('allows renaming an archived garden', () => {
    const garden = archiveGarden(createGarden(GARDEN_ID, 'Backyard', OWNER_ID, NOW), LATER);
    expect(() => renameGarden(garden, 'New Name', LATER)).not.toThrow();
  });
});

describe('archiveGarden', () => {
  it('transitions active to archived', () => {
    const garden = createGarden(GARDEN_ID, 'Backyard', OWNER_ID, NOW);
    const archived = archiveGarden(garden, LATER);

    expect(archived.lifecycleState).toBe('archived');
    expect(archived.revision).toBe(2);
  });

  it('rejects archiving an already-archived garden', () => {
    const garden = archiveGarden(createGarden(GARDEN_ID, 'Backyard', OWNER_ID, NOW), LATER);
    expect(() => archiveGarden(garden, LATER)).toThrow(DomainRuleViolatedError);
  });

  it('rejects archiving a garden pending deletion', () => {
    const garden = requestGardenDeletion(createGarden(GARDEN_ID, 'Backyard', OWNER_ID, NOW), LATER);
    expect(() => archiveGarden(garden, LATER)).toThrow(DomainRuleViolatedError);
  });
});

describe('requestGardenDeletion', () => {
  it('transitions active or archived to deletion_requested and records the timestamp', () => {
    const garden = createGarden(GARDEN_ID, 'Backyard', OWNER_ID, NOW);
    const requested = requestGardenDeletion(garden, LATER);

    expect(requested.lifecycleState).toBe('deletion_requested');
    expect(requested.deletionRequestedAt).toBe(LATER);
    expect(requested.revision).toBe(2);
  });

  it('is not idempotent at the domain layer: a second request on an already-requested garden is a conflict', () => {
    const garden = requestGardenDeletion(createGarden(GARDEN_ID, 'Backyard', OWNER_ID, NOW), LATER);
    expect(() => requestGardenDeletion(garden, LATER)).toThrow(DomainRuleViolatedError);
  });
});
