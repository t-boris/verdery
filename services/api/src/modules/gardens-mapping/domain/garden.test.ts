import { describe, expect, it } from 'vitest';
import {
  DomainRuleViolatedError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import {
  archiveGarden,
  claimGardenForPurge,
  createGarden,
  renameGarden,
  requestGardenDeletion,
  restoreGarden,
} from './garden.js';
import { DELETION_RECOVERY_WINDOW_MS } from '../../../shared/deletion/deletion-policy.js';

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
      recoveryDeadlineAt: null,
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

describe('the recovery window and the point of no return (P8-DELETE-01)', () => {
  const requested = (): ReturnType<typeof requestGardenDeletion> =>
    requestGardenDeletion(createGarden(GARDEN_ID, 'Backyard', OWNER_ID, NOW), LATER);

  it('stamps the 30-day recovery deadline from the request instant', () => {
    expect(requested().recoveryDeadlineAt).toEqual(
      new Date(LATER.getTime() + DELETION_RECOVERY_WINDOW_MS),
    );
  });

  it('restores to active, clearing both the request instant and the deadline', () => {
    const restored = restoreGarden(requested(), LATER);

    expect(restored).toMatchObject({
      lifecycleState: 'active',
      deletionRequestedAt: null,
      recoveryDeadlineAt: null,
      revision: 3,
    });
  });

  it('refuses to restore a garden with no pending deletion', () => {
    const garden = createGarden(GARDEN_ID, 'Backyard', OWNER_ID, NOW);
    expect(() => restoreGarden(garden, LATER)).toThrow(DomainRuleViolatedError);
  });

  it('refuses to restore once the purge is claimed, and says so with its own code', () => {
    const purging = claimGardenForPurge(requested(), LATER);

    expect(() => restoreGarden(purging, LATER)).toThrow(
      expect.objectContaining({ code: 'deletion.not_recoverable' }) as Error,
    );
  });

  it('claims only from deletion_requested, and re-claiming a purging garden burns no revision', () => {
    const purging = claimGardenForPurge(requested(), LATER);
    expect(purging.lifecycleState).toBe('purging');
    expect(purging.revision).toBe(3);

    // The resume case: an interrupted purge's next sweep pass.
    expect(claimGardenForPurge(purging, LATER)).toBe(purging);

    expect(() => claimGardenForPurge(createGarden(GARDEN_ID, 'B', OWNER_ID, NOW), LATER)).toThrow(
      DomainRuleViolatedError,
    );
  });

  it('keeps a purging garden immutable, exactly like one merely pending deletion', () => {
    const purging = claimGardenForPurge(requested(), LATER);

    expect(() => renameGarden(purging, 'New name', LATER)).toThrow(DomainRuleViolatedError);
    expect(() => archiveGarden(purging, LATER)).toThrow(DomainRuleViolatedError);
    expect(() => requestGardenDeletion(purging, LATER)).toThrow(DomainRuleViolatedError);
  });
});
