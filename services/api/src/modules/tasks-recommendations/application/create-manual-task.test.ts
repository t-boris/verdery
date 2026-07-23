import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import type { Observation } from '../../observations-history/public.js';
import type { MapObjectSummary } from '../../gardens-mapping/public.js';
import type { Plant } from '../../plants-inventory/public.js';
import { CreateManualTask } from './create-manual-task.js';
import {
  authorizationDenying,
  authorizationGranting,
  createTasksRecommendationsFakes,
  FakeTasksRecommendationsUnitOfWork,
  fixedClock,
  getObservationResolving,
} from './tasks-recommendations-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const OTHER_GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const GARDEN_AREA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f';
const OBSERVATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10';
const NOW = new Date('2026-07-21T09:00:00Z');

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function activeMapObjectSummary(id: string, gardenId: string): MapObjectSummary {
  return { id, gardenId, category: 'bed', lifecycleState: 'active', currentRevision: 1 };
}

function plant(overrides: Partial<Plant> & { id: string; gardenId: string }): Plant {
  return {
    displayName: 'Tomato',
    taxonomyReferenceId: null,
    varietyLabel: null,
    gardenAreaMapObjectId: null,
    placementMapObjectId: null,
    acceptedIdentificationId: null,
    acquisitionDate: null,
    acquisitionDateType: null,
    groupingKind: 'individual',
    quantity: null,
    lifecycleStage: 'planned',
    status: 'active',
    conditionNote: null,
    careGuidanceNote: null,
    revision: 1,
    createdByProfileId: PROFILE_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function noObservations() {
  return getObservationResolving(new Map<string, Observation>());
}

describe('CreateManualTask', () => {
  it('creates a garden-level task with no target references', async () => {
    const fakes = createTasksRecommendationsFakes();
    const createManualTask = new CreateManualTask(
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      noObservations(),
      fixedClock(NOW),
    );

    const task = await createManualTask.execute(
      GARDEN_ID,
      PROFILE_ID,
      { target: { kind: 'garden' }, title: 'Water the whole garden' },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11',
    );

    expect(task).toMatchObject({
      gardenId: GARDEN_ID,
      targetKind: 'garden',
      title: 'Water the whole garden',
      status: 'planned',
      source: 'manual',
      revision: 1,
    });
    expect(fakes.revisionJournal.entries).toEqual([
      {
        taskId: task.id,
        revision: 1,
        commandType: 'createManualTask',
        status: 'planned',
        dueDate: null,
        actorProfileId: PROFILE_ID,
      },
    ]);
  });

  it('creates a garden_area task against a real, active map object', async () => {
    const fakes = createTasksRecommendationsFakes({
      mapObjectSummaries: new Map([
        [GARDEN_AREA_ID, activeMapObjectSummary(GARDEN_AREA_ID, GARDEN_ID)],
      ]),
    });
    const createManualTask = new CreateManualTask(
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      noObservations(),
      fixedClock(NOW),
    );

    const task = await createManualTask.execute(
      GARDEN_ID,
      PROFILE_ID,
      {
        target: { kind: 'garden_area', gardenAreaMapObjectId: GARDEN_AREA_ID },
        title: 'Weed the bed',
      },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a12',
    );

    expect(task.targetKind).toBe('garden_area');
    expect(task.targetGardenAreaMapObjectId).toBe(GARDEN_AREA_ID);
  });

  it('creates a plant task against a real plant belonging to the garden', async () => {
    const fakes = createTasksRecommendationsFakes({
      plants: new Map([[PLANT_ID, plant({ id: PLANT_ID, gardenId: GARDEN_ID })]]),
    });
    const createManualTask = new CreateManualTask(
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      noObservations(),
      fixedClock(NOW),
    );

    const task = await createManualTask.execute(
      GARDEN_ID,
      PROFILE_ID,
      { target: { kind: 'plant', plantId: PLANT_ID }, title: 'Check for pests' },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a13',
    );

    expect(task.targetKind).toBe('plant');
    expect(task.targetPlantId).toBe(PLANT_ID);
  });

  it('rejects a mismatched target/kind combination, mirroring task_target_consistency_check', async () => {
    const fakes = createTasksRecommendationsFakes();
    const createManualTask = new CreateManualTask(
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      noObservations(),
      fixedClock(NOW),
    );

    await expect(
      createManualTask.execute(
        GARDEN_ID,
        PROFILE_ID,
        { target: { kind: 'garden', plantId: PLANT_ID }, title: 'Bad target' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a14',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fakes.tasks.tasks.size).toBe(0);
  });

  it('rejects a plant reference belonging to a different garden', async () => {
    const fakes = createTasksRecommendationsFakes({
      plants: new Map([[PLANT_ID, plant({ id: PLANT_ID, gardenId: OTHER_GARDEN_ID })]]),
    });
    const createManualTask = new CreateManualTask(
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      noObservations(),
      fixedClock(NOW),
    );

    await expect(
      createManualTask.execute(
        GARDEN_ID,
        PROFILE_ID,
        { target: { kind: 'plant', plantId: PLANT_ID }, title: 'Check for pests' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a15',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('validates originObservationId via GetObservation, rejecting one from a different garden', async () => {
    const observation: Observation = {
      id: OBSERVATION_ID,
      gardenId: OTHER_GARDEN_ID,
      plantId: null,
      gardenObjectId: null,
      actorType: 'user',
      createdByProfileId: PROFILE_ID,
      noteText: 'Looks dry.',
      conditionSummary: null,
      correctionKind: null,
      correctsObservationId: null,
      observedAt: NOW,
      recordedAt: NOW,
    };
    const fakes = createTasksRecommendationsFakes();
    const createManualTask = new CreateManualTask(
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      getObservationResolving(new Map([[OBSERVATION_ID, observation]])),
      fixedClock(NOW),
    );

    await expect(
      createManualTask.execute(
        GARDEN_ID,
        PROFILE_ID,
        { target: { kind: 'garden' }, title: 'Follow up', originObservationId: OBSERVATION_ID },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a16',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts a valid originObservationId from the same garden', async () => {
    const observation: Observation = {
      id: OBSERVATION_ID,
      gardenId: GARDEN_ID,
      plantId: null,
      gardenObjectId: null,
      actorType: 'user',
      createdByProfileId: PROFILE_ID,
      noteText: 'Looks dry.',
      conditionSummary: null,
      correctionKind: null,
      correctsObservationId: null,
      observedAt: NOW,
      recordedAt: NOW,
    };
    const fakes = createTasksRecommendationsFakes();
    const createManualTask = new CreateManualTask(
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      getObservationResolving(new Map([[OBSERVATION_ID, observation]])),
      fixedClock(NOW),
    );

    const task = await createManualTask.execute(
      GARDEN_ID,
      PROFILE_ID,
      { target: { kind: 'garden' }, title: 'Follow up', originObservationId: OBSERVATION_ID },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a17',
    );

    expect(task.originObservationId).toBe(OBSERVATION_ID);
  });

  it('rejects an unauthorized caller before doing any work', async () => {
    const fakes = createTasksRecommendationsFakes();
    const createManualTask = new CreateManualTask(
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationDenying(),
      noObservations(),
      fixedClock(NOW),
    );

    await expect(
      createManualTask.execute(
        GARDEN_ID,
        PROFILE_ID,
        { target: { kind: 'garden' }, title: 'Water the garden' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a18',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a caller who lacks editGardenContent (a viewer)', async () => {
    const fakes = createTasksRecommendationsFakes();
    const createManualTask = new CreateManualTask(
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting({ ...OWNER_MEMBERSHIP, role: 'viewer' }),
      noObservations(),
      fixedClock(NOW),
    );

    await expect(
      createManualTask.execute(
        GARDEN_ID,
        PROFILE_ID,
        { target: { kind: 'garden' }, title: 'Water the garden' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a19',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
