import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { CreateTaskInput, TaskTarget } from './task.js';
import {
  createTask,
  createTaskFromRecommendation,
  updateTaskDetails,
  validateTaskTarget,
} from './task.js';

const TASK_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const GARDEN_AREA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f';
const NOW = new Date('2026-07-21T09:00:00Z');
const LATER = new Date('2026-07-21T10:00:00Z');

const GARDEN_TARGET: TaskTarget = { kind: 'garden', gardenAreaMapObjectId: null, plantId: null };

function baseInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    id: TASK_ID,
    gardenId: GARDEN_ID,
    target: GARDEN_TARGET,
    rawTitle: 'Water the tomatoes',
    notes: null,
    rawDueDate: null,
    timeWindowStart: null,
    timeWindowEnd: null,
    urgency: 'normal',
    originObservationId: null,
    createdByProfileId: PROFILE_ID,
    now: NOW,
    ...overrides,
  };
}

describe('validateTaskTarget', () => {
  it('accepts a garden target with neither id set', () => {
    expect(validateTaskTarget(GARDEN_TARGET)).toEqual(GARDEN_TARGET);
  });

  it('accepts a garden_area target with only gardenAreaMapObjectId set', () => {
    const target: TaskTarget = {
      kind: 'garden_area',
      gardenAreaMapObjectId: GARDEN_AREA_ID,
      plantId: null,
    };
    expect(validateTaskTarget(target)).toEqual(target);
  });

  it('accepts a plant target with only plantId set', () => {
    const target: TaskTarget = { kind: 'plant', gardenAreaMapObjectId: null, plantId: PLANT_ID };
    expect(validateTaskTarget(target)).toEqual(target);
  });

  it('rejects a garden target with a stray plantId, mirroring task_target_consistency_check', () => {
    const target: TaskTarget = { kind: 'garden', gardenAreaMapObjectId: null, plantId: PLANT_ID };
    expect(() => validateTaskTarget(target)).toThrow(ValidationError);
  });

  it('rejects a garden_area target missing gardenAreaMapObjectId', () => {
    const target: TaskTarget = { kind: 'garden_area', gardenAreaMapObjectId: null, plantId: null };
    expect(() => validateTaskTarget(target)).toThrow(ValidationError);
  });

  it('rejects a plant target that also sets gardenAreaMapObjectId', () => {
    const target: TaskTarget = {
      kind: 'plant',
      gardenAreaMapObjectId: GARDEN_AREA_ID,
      plantId: PLANT_ID,
    };
    expect(() => validateTaskTarget(target)).toThrow(ValidationError);
  });
});

describe('createTask', () => {
  it('creates a planned, manual task with revision 1', () => {
    const task = createTask(baseInput());

    expect(task).toMatchObject({
      id: TASK_ID,
      gardenId: GARDEN_ID,
      targetKind: 'garden',
      title: 'Water the tomatoes',
      status: 'planned',
      source: 'manual',
      revision: 1,
      recurrenceRule: null,
      completedAt: null,
    });
    expect(task.createdAt).toBe(NOW);
    expect(task.updatedAt).toBe(NOW);
  });

  it('trims the title and rejects a blank one', () => {
    expect(createTask(baseInput({ rawTitle: '  Water the tomatoes  ' })).title).toBe(
      'Water the tomatoes',
    );
    expect(() => createTask(baseInput({ rawTitle: '   ' }))).toThrow(ValidationError);
  });

  it('rejects a malformed dueDate', () => {
    expect(() => createTask(baseInput({ rawDueDate: '07/21/2026' }))).toThrow(ValidationError);
  });

  it('accepts a well-formed dueDate', () => {
    expect(createTask(baseInput({ rawDueDate: '2026-08-01' })).dueDate).toBe('2026-08-01');
  });

  it('rejects a time window that ends before it starts', () => {
    expect(() => createTask(baseInput({ timeWindowStart: LATER, timeWindowEnd: NOW }))).toThrow(
      ValidationError,
    );
  });

  it('rejects an inconsistent target at construction time, not only via validateTaskTarget directly', () => {
    expect(() =>
      createTask(
        baseInput({ target: { kind: 'garden_area', gardenAreaMapObjectId: null, plantId: null } }),
      ),
    ).toThrow(ValidationError);
  });

  it('carries originObservationId through when given', () => {
    const observationId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10';
    expect(createTask(baseInput({ originObservationId: observationId })).originObservationId).toBe(
      observationId,
    );
  });
});

describe('updateTaskDetails', () => {
  function plannedTask() {
    return createTask(baseInput());
  }

  it('applies only the given changes, bumping the revision', () => {
    const updated = updateTaskDetails(plannedTask(), { title: 'Water the tomatoes deeply' }, LATER);
    expect(updated.title).toBe('Water the tomatoes deeply');
    expect(updated.revision).toBe(2);
    expect(updated.updatedAt).toBe(LATER);
  });

  it('clears a nullable field with an explicit null and leaves it alone when omitted', () => {
    const withDueDate = createTask(baseInput({ rawDueDate: '2026-08-01' }));
    const cleared = updateTaskDetails(withDueDate, { dueDate: null }, LATER);
    expect(cleared.dueDate).toBeNull();

    const unchanged = updateTaskDetails(withDueDate, { title: 'New title' }, LATER);
    expect(unchanged.dueDate).toBe('2026-08-01');
  });

  it('stores recurrenceRule as opaque text with no parsing', () => {
    const updated = updateTaskDetails(
      plannedTask(),
      { recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' },
      LATER,
    );
    expect(updated.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO');
  });

  it('rejects a time window edit that would end before it starts, checked against the merged result', () => {
    const task = plannedTask();
    expect(() =>
      updateTaskDetails(task, { timeWindowStart: LATER, timeWindowEnd: NOW }, LATER),
    ).toThrow(ValidationError);
  });

  it('rejects editing a task that is not planned or suggested', () => {
    const completed = { ...plannedTask(), status: 'completed' as const };
    expect(() => updateTaskDetails(completed, { title: 'Too late' }, LATER)).toThrow(
      DomainRuleViolatedError,
    );
  });
});

describe('createTaskFromRecommendation', () => {
  const RECOMMENDATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10';

  it("pairs source 'suggested' with the origin id, status 'planned', and carries the candidate's schedule verbatim", () => {
    const windowStart = new Date('2026-07-21T09:00:00Z');
    const windowEnd = new Date('2026-07-26T09:00:00Z');
    const task = createTaskFromRecommendation({
      id: TASK_ID,
      gardenId: GARDEN_ID,
      target: { kind: 'plant', gardenAreaMapObjectId: null, plantId: PLANT_ID },
      rawTitle: 'Check ripeness and harvest what is ready',
      notes: 'Stored deterministic explanation.',
      timeWindowStart: windowStart,
      timeWindowEnd: windowEnd,
      urgency: 'high',
      originRecommendationId: RECOMMENDATION_ID,
      createdByProfileId: PROFILE_ID,
      now: NOW,
    });

    expect(task).toMatchObject({
      source: 'suggested',
      originRecommendationId: RECOMMENDATION_ID,
      originObservationId: null,
      status: 'planned',
      title: 'Check ripeness and harvest what is ready',
      notes: 'Stored deterministic explanation.',
      urgency: 'high',
      dueDate: null,
      recurrenceRule: null,
      timeWindowStart: windowStart,
      timeWindowEnd: windowEnd,
      revision: 1,
    });
  });

  it('validates target consistency and title like every task constructor', () => {
    expect(() =>
      createTaskFromRecommendation({
        id: TASK_ID,
        gardenId: GARDEN_ID,
        target: { kind: 'plant', gardenAreaMapObjectId: GARDEN_AREA_ID, plantId: PLANT_ID },
        rawTitle: 'Valid title',
        notes: null,
        timeWindowStart: null,
        timeWindowEnd: null,
        urgency: 'normal',
        originRecommendationId: RECOMMENDATION_ID,
        createdByProfileId: PROFILE_ID,
        now: NOW,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      createTaskFromRecommendation({
        id: TASK_ID,
        gardenId: GARDEN_ID,
        target: GARDEN_TARGET,
        rawTitle: '   ',
        notes: null,
        timeWindowStart: null,
        timeWindowEnd: null,
        urgency: 'normal',
        originRecommendationId: RECOMMENDATION_ID,
        createdByProfileId: PROFILE_ID,
        now: NOW,
      }),
    ).toThrow(ValidationError);
  });
});
