import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  DomainRuleViolatedError,
  NotFoundError,
  StaleRevisionError,
} from '../../../platform/errors/application-error.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import {
  CompleteRecommendation,
  DismissRecommendation,
  MarkRecommendationIrrelevant,
  PostponeRecommendation,
} from './recommendation-feedback-commands.js';
import { seedRecommendationCandidate } from './recommendation-test-doubles.js';
import {
  FakeTasksRecommendationsUnitOfWork,
  authorizationDenying,
  authorizationGranting,
  createTasksRecommendationsFakes,
  fixedClock,
} from './tasks-recommendations-test-doubles.js';

const GARDEN_ID = '019a4000-0000-7000-8000-000000000001';
const OTHER_GARDEN_ID = '019a4000-0000-7000-8000-000000000009';
const PROFILE_ID = '019a4000-0000-7000-8000-000000000002';
const CANDIDATE_ID = '019a4000-0000-7000-8000-00000000000a';
const KEY = '019a4000-0000-7000-8000-0000000000f1';
const NOW = new Date('2026-07-25T09:00:00Z');
const PRESENTED_AT = new Date('2026-07-24T18:00:00Z');

function makeDeps(
  fakes: ReturnType<typeof createTasksRecommendationsFakes>,
  authorization?: GardenAuthorization,
) {
  return {
    candidates: fakes.recommendationCandidates,
    idempotency: fakes.idempotency,
    unitOfWork: new FakeTasksRecommendationsUnitOfWork(fakes),
    authorization:
      authorization ??
      authorizationGranting({
        id: 'membership-1',
        gardenId: GARDEN_ID,
        profileId: PROFILE_ID,
        role: 'editor',
      }),
    clock: fixedClock(NOW),
  };
}

function seedPresented(fakes: ReturnType<typeof createTasksRecommendationsFakes>) {
  return seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
    id: CANDIDATE_ID,
    gardenId: GARDEN_ID,
    state: 'presented',
    presentedAt: PRESENTED_AT,
    revision: 3,
  });
}

describe('CompleteRecommendation', () => {
  it('appends completed feedback and transitions presented -> completed in one pass', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);

    const result = await new CompleteRecommendation(makeDeps(fakes)).execute(
      GARDEN_ID,
      CANDIDATE_ID,
      PROFILE_ID,
      3,
      KEY,
    );

    expect(result).toMatchObject({
      id: CANDIDATE_ID,
      state: 'completed',
      revision: 4,
      explanation: 'Stored deterministic explanation.',
    });
    expect(fakes.recommendationCandidates.candidates.get(CANDIDATE_ID)).toMatchObject({
      state: 'completed',
      revision: 4,
      presentedAt: PRESENTED_AT,
    });
    expect(fakes.recommendationCandidates.feedback).toEqual([
      expect.objectContaining({
        candidateId: CANDIDATE_ID,
        kind: 'completed',
        actorProfileId: PROFILE_ID,
        postponedUntil: null,
        recordedAt: NOW,
      }),
    ]);
  });

  it('replays the cached result for a retried idempotency key without a second feedback row', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);
    const command = new CompleteRecommendation(makeDeps(fakes));

    const first = await command.execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID, 3, KEY);
    const replay = await command.execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID, 3, KEY);

    expect(replay).toEqual(first);
    expect(fakes.recommendationCandidates.feedback).toHaveLength(1);
  });

  it('rejects a stale expectedRevision with the current revision disclosed', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);

    await expect(
      new CompleteRecommendation(makeDeps(fakes)).execute(
        GARDEN_ID,
        CANDIDATE_ID,
        PROFILE_ID,
        2,
        KEY,
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);
    expect(fakes.recommendationCandidates.feedback).toEqual([]);
  });

  it('rejects a candidate that is not presented with a state conflict', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_ID,
      gardenId: GARDEN_ID,
      state: 'eligible',
      revision: 2,
    });

    await expect(
      new CompleteRecommendation(makeDeps(fakes)).execute(
        GARDEN_ID,
        CANDIDATE_ID,
        PROFILE_ID,
        2,
        KEY,
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });

  it('conceals a candidate reached through the wrong garden path as not found', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);

    await expect(
      new CompleteRecommendation(makeDeps(fakes)).execute(
        OTHER_GARDEN_ID,
        CANDIDATE_ID,
        PROFILE_ID,
        3,
        KEY,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a caller without editGardenContent', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);

    await expect(
      new CompleteRecommendation(makeDeps(fakes, authorizationDenying())).execute(
        GARDEN_ID,
        CANDIDATE_ID,
        PROFILE_ID,
        3,
        KEY,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(fakes.recommendationCandidates.feedback).toEqual([]);
  });

  it('reuses an idempotency key for a different request as a conflict', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);
    const command = new CompleteRecommendation(makeDeps(fakes));
    await command.execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID, 3, KEY);
    // Same key, different expectedRevision -> different fingerprint.
    await expect(
      command.execute(GARDEN_ID, CANDIDATE_ID, PROFILE_ID, 4, KEY),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('PostponeRecommendation', () => {
  it('appends postponed feedback carrying the user horizon and transitions presented -> postponed', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);
    const until = new Date('2026-07-30T09:00:00Z');

    const result = await new PostponeRecommendation(makeDeps(fakes)).execute(
      GARDEN_ID,
      CANDIDATE_ID,
      PROFILE_ID,
      3,
      until,
      KEY,
    );

    expect(result).toMatchObject({ state: 'postponed', revision: 4 });
    expect(fakes.recommendationCandidates.feedback).toEqual([
      expect.objectContaining({ kind: 'postponed', postponedUntil: until }),
    ]);
  });

  it('accepts a horizon-less postponement — no default is invented', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);

    const result = await new PostponeRecommendation(makeDeps(fakes)).execute(
      GARDEN_ID,
      CANDIDATE_ID,
      PROFILE_ID,
      3,
      null,
      KEY,
    );

    expect(result.state).toBe('postponed');
    expect(fakes.recommendationCandidates.feedback[0]).toMatchObject({
      kind: 'postponed',
      postponedUntil: null,
    });
  });
});

describe('DismissRecommendation', () => {
  it("appends dismissed feedback and transitions presented -> rejected — FR-24's verb, section 6's state", async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);

    const result = await new DismissRecommendation(makeDeps(fakes)).execute(
      GARDEN_ID,
      CANDIDATE_ID,
      PROFILE_ID,
      3,
      KEY,
    );

    expect(result).toMatchObject({ state: 'rejected', revision: 4 });
    expect(fakes.recommendationCandidates.feedback).toEqual([
      expect.objectContaining({ kind: 'dismissed' }),
    ]);
  });
});

describe('MarkRecommendationIrrelevant', () => {
  it('appends irrelevant feedback on a presented candidate without touching its state or revision', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedPresented(fakes);

    const result = await new MarkRecommendationIrrelevant(makeDeps(fakes)).execute(
      GARDEN_ID,
      CANDIDATE_ID,
      PROFILE_ID,
      3,
      KEY,
    );

    expect(result).toMatchObject({ state: 'presented', revision: 3 });
    expect(fakes.recommendationCandidates.candidates.get(CANDIDATE_ID)).toMatchObject({
      state: 'presented',
      revision: 3,
    });
    expect(fakes.recommendationCandidates.feedback).toEqual([
      expect.objectContaining({ kind: 'irrelevant', postponedUntil: null }),
    ]);
  });

  it('is legal on an already-rejected candidate — the signal that follows a dismissal', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_ID,
      gardenId: GARDEN_ID,
      state: 'rejected',
      presentedAt: PRESENTED_AT,
      revision: 4,
    });

    const result = await new MarkRecommendationIrrelevant(makeDeps(fakes)).execute(
      GARDEN_ID,
      CANDIDATE_ID,
      PROFILE_ID,
      4,
      KEY,
    );

    expect(result.state).toBe('rejected');
    expect(fakes.recommendationCandidates.feedback).toHaveLength(1);
  });

  it('conflicts on any other state', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_ID,
      gardenId: GARDEN_ID,
      state: 'completed',
      presentedAt: PRESENTED_AT,
      revision: 4,
    });

    await expect(
      new MarkRecommendationIrrelevant(makeDeps(fakes)).execute(
        GARDEN_ID,
        CANDIDATE_ID,
        PROFILE_ID,
        4,
        KEY,
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });
});
