import { describe, expect, it } from 'vitest';
import {
  DomainRuleViolatedError,
  StaleRevisionError,
} from '../../../platform/errors/application-error.js';
import { createLaunchRuleCatalog } from '../domain/rules/launch-rule-catalog.js';
import { ConvertRecommendationToTask } from './convert-recommendation-to-task.js';
import { seedRecommendationCandidate } from './recommendation-test-doubles.js';
import {
  FakeTasksRecommendationsUnitOfWork,
  authorizationGranting,
  createTasksRecommendationsFakes,
  fixedClock,
} from './tasks-recommendations-test-doubles.js';

const GARDEN_ID = '019a5000-0000-7000-8000-000000000001';
const PLANT_ID = '019a5000-0000-7000-8000-000000000002';
const PROFILE_ID = '019a5000-0000-7000-8000-000000000003';
const CANDIDATE_ID = '019a5000-0000-7000-8000-00000000000a';
const KEY = '019a5000-0000-7000-8000-0000000000f1';
const NOW = new Date('2026-07-25T09:00:00Z');
const PRESENTED_AT = new Date('2026-07-24T18:00:00Z');
const WINDOW_START = new Date('2026-07-24T09:00:00Z');
const WINDOW_END = new Date('2026-07-29T09:00:00Z');

function makeCommand(fakes: ReturnType<typeof createTasksRecommendationsFakes>) {
  return new ConvertRecommendationToTask(
    fakes.recommendationCandidates,
    fakes.idempotency,
    new FakeTasksRecommendationsUnitOfWork(fakes),
    authorizationGranting({
      id: 'membership-1',
      gardenId: GARDEN_ID,
      profileId: PROFILE_ID,
      role: 'editor',
    }),
    createLaunchRuleCatalog(),
    fixedClock(NOW),
  );
}

function seedPresented(fakes: ReturnType<typeof createTasksRecommendationsFakes>) {
  return seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
    id: CANDIDATE_ID,
    gardenId: GARDEN_ID,
    state: 'presented',
    presentedAt: PRESENTED_AT,
    revision: 3,
    targetPlantId: PLANT_ID,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
  });
}

describe('ConvertRecommendationToTask', () => {
  it('creates the suggested task, completes the candidate, and appends the feedback row — one transactional pass', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);

    const result = await makeCommand(fakes).execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID, 3, KEY);

    // The candidate: completed, revision bumped, presentation fact kept.
    expect(result.recommendation).toMatchObject({
      id: CANDIDATE_ID,
      state: 'completed',
      revision: 4,
    });
    expect(fakes.recommendationCandidates.candidates.get(CANDIDATE_ID)).toMatchObject({
      state: 'completed',
      revision: 4,
      presentedAt: PRESENTED_AT,
    });

    // The feedback row: FR-24's closed vocabulary — `completed`, with the
    // task linkage below carrying the conversion distinction.
    expect(fakes.recommendationCandidates.feedback).toEqual([
      expect.objectContaining({
        candidateId: CANDIDATE_ID,
        kind: 'completed',
        actorProfileId: PROFILE_ID,
      }),
    ]);

    // The task: source 'suggested' + origin set together, status 'planned',
    // action title as title, stored explanation as notes, target/urgency/
    // window carried over verbatim.
    expect(result.task).toMatchObject({
      gardenId: GARDEN_ID,
      targetKind: 'plant',
      targetPlantId: PLANT_ID,
      title: 'Check ripeness and harvest what is ready',
      notes: 'Stored deterministic explanation.',
      status: 'planned',
      urgency: 'high',
      source: 'suggested',
      originObservationId: null,
      dueDate: null,
      timeWindowStart: WINDOW_START.toISOString(),
      timeWindowEnd: WINDOW_END.toISOString(),
      revision: 1,
      createdByProfileId: PROFILE_ID,
    });
    const storedTask = fakes.tasks.tasks.get(result.task.id);
    expect(storedTask).toMatchObject({
      source: 'suggested',
      originRecommendationId: CANDIDATE_ID,
    });

    // Journaled and sync-recorded exactly like CreateManualTask — the task
    // IS a synced record family.
    expect(fakes.revisionJournal.entries).toEqual([
      expect.objectContaining({
        taskId: result.task.id,
        revision: 1,
        commandType: 'convertRecommendationToTask',
        status: 'planned',
        actorProfileId: PROFILE_ID,
      }),
    ]);
    expect(fakes.syncChanges.entries).toEqual([
      expect.objectContaining({
        gardenId: GARDEN_ID,
        recordId: result.task.id,
        recordType: 'task',
        operation: 'upsert',
        recordRevision: 1,
      }),
    ]);
  });

  it('replays a retried request without creating a second task', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);
    const command = makeCommand(fakes);

    const first = await command.execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID, 3, KEY);
    const replay = await command.execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID, 3, KEY);

    expect(replay).toEqual(first);
    expect(fakes.tasks.tasks.size).toBe(1);
    expect(fakes.recommendationCandidates.feedback).toHaveLength(1);
  });

  it('refuses a second conversion under a different key: the candidate is already completed', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);
    const command = makeCommand(fakes);
    await command.execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID, 3, KEY);

    await expect(
      command.execute(
        GARDEN_ID,
        CANDIDATE_ID,
        PROFILE_ID,
        4,
        '019a5000-0000-7000-8000-0000000000f2',
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
    expect(fakes.tasks.tasks.size).toBe(1);
  });

  it('rejects a stale expectedRevision before writing anything', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);

    await expect(
      makeCommand(fakes).execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID, 2, KEY),
    ).rejects.toBeInstanceOf(StaleRevisionError);
    expect(fakes.tasks.tasks.size).toBe(0);
    expect(fakes.recommendationCandidates.feedback).toEqual([]);
  });
});
