import { describe, expect, it } from 'vitest';
import { InternalError } from '../../../platform/errors/application-error.js';
import type {
  AiExplanationRequest,
  GenerateAiExplanationResult,
} from '../../integrations/public.js';
import { createLaunchRuleCatalog } from '../domain/rules/launch-rule-catalog.js';
import { EmbellishRecommendationExplanations } from './embellish-recommendation-explanations.js';
import { seedRecommendationCandidate } from './recommendation-test-doubles.js';
import {
  createTasksRecommendationsFakes,
  FakeTasksRecommendationsUnitOfWork,
  fixedClock,
} from './tasks-recommendations-test-doubles.js';
import type { TasksRecommendationsFakes } from './tasks-recommendations-test-doubles.js';

const NOW = new Date('2026-07-25T09:00:00Z');
const GARDEN_ID = '019a5000-0000-7000-8000-000000000001';
const CANDIDATE_A = '019a5000-0000-7000-8000-00000000000a';
const CANDIDATE_B = '019a5000-0000-7000-8000-00000000000b';

const PROVENANCE = {
  providerKey: 'vertex-ai-explanation',
  model: 'gemini-test',
  promptTemplateVersion: 1,
};

/** Scripted generator: consumes `results` in call order; `requests` records every packet. */
function generator(results: readonly GenerateAiExplanationResult[]): {
  requests: AiExplanationRequest[];
  execute(request: AiExplanationRequest): Promise<GenerateAiExplanationResult>;
} {
  const queue = [...results];
  const requests: AiExplanationRequest[] = [];
  return {
    requests,
    execute(request) {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) {
        throw new Error('No scripted result left for this call.');
      }
      return Promise.resolve(next);
    },
  };
}

function acceptedDraft(text: string): GenerateAiExplanationResult {
  return {
    outcome: 'draft',
    draft: { explanation: text, evidenceKeysUsed: ['seed.fact'] },
    provenance: PROVENANCE,
  };
}

function buildEmbellisher(
  fakes: TasksRecommendationsFakes,
  generate: { execute(request: AiExplanationRequest): Promise<GenerateAiExplanationResult> },
): EmbellishRecommendationExplanations {
  return new EmbellishRecommendationExplanations(
    new FakeTasksRecommendationsUnitOfWork(fakes),
    // The seeded candidates pin `lifecycle.harvest-readiness-check` v1 —
    // the real launch catalog resolves its action title.
    createLaunchRuleCatalog(),
    generate,
    'en',
    fixedClock(NOW),
  );
}

describe('EmbellishRecommendationExplanations', () => {
  it('embellishes a presentable candidate: minimal packet from stored content, accepted verdict recorded', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_A,
      gardenId: GARDEN_ID,
    });
    const generate = generator([acceptedDraft('It looks ready — check ripeness and harvest.')]);

    const result = await buildEmbellisher(fakes, generate).execute();

    expect(result).toEqual({
      candidatesConsidered: 1,
      accepted: 1,
      rejected: 0,
      rejectionOutcomes: {},
      transientFailures: 0,
      lostRaces: 0,
      stoppedOnQuotaExhaustion: false,
    });
    expect(generate.requests).toEqual([
      {
        ruleKey: 'lifecycle.harvest-readiness-check',
        ruleVersion: 1,
        actionTitle: 'Check ripeness and harvest what is ready',
        deterministicExplanation: 'Stored deterministic explanation.',
        locale: 'en',
        evidenceFacts: [{ factKey: 'seed.fact', factValue: { seeded: true } }],
      },
    ]);
    expect(fakes.aiExplanations.records).toHaveLength(1);
    expect(fakes.aiExplanations.records[0]).toMatchObject({
      candidateId: CANDIDATE_A,
      locale: 'en',
      providerKey: 'vertex-ai-explanation',
      model: 'gemini-test',
      promptTemplateVersion: 1,
      packetFactKeys: ['seed.fact'],
      generatedText: 'It looks ready — check ripeness and harvest.',
      validationOutcome: 'accepted',
    });
  });

  it('records a semantic rejection with the draft kept, and never re-attempts that candidate', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_A,
      gardenId: GARDEN_ID,
    });
    // The harvest baseline has no watering vocabulary — unsupported action.
    const generate = generator([acceptedDraft('Harvest it, then water it thoroughly.')]);
    const embellisher = buildEmbellisher(fakes, generate);

    const first = await embellisher.execute();
    const second = await embellisher.execute();

    expect(first.rejected).toBe(1);
    expect(first.rejectionOutcomes).toEqual({ unsupported_action: 1 });
    expect(fakes.aiExplanations.records[0]).toMatchObject({
      validationOutcome: 'unsupported_action',
      generatedText: 'Harvest it, then water it thoroughly.',
    });
    // The durable verdict removed the candidate from the selection.
    expect(second.candidatesConsidered).toBe(0);
    expect(generate.requests).toHaveLength(1);
  });

  it('records provider-side verdicts: schema_invalid keeps the raw text, safety block has none', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_A,
      gardenId: GARDEN_ID,
    });
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_B,
      gardenId: GARDEN_ID,
    });
    const generate = generator([
      { outcome: 'schemaInvalid', rawText: 'not json at all', provenance: PROVENANCE },
      { outcome: 'safetyBlocked', provenance: PROVENANCE },
    ]);

    const result = await buildEmbellisher(fakes, generate).execute();

    expect(result.rejected).toBe(2);
    expect(result.rejectionOutcomes).toEqual({ schema_invalid: 1, provider_safety_blocked: 1 });
    const byCandidate = new Map(
      fakes.aiExplanations.records.map((record) => [record.candidateId, record]),
    );
    expect(byCandidate.get(CANDIDATE_A)).toMatchObject({
      validationOutcome: 'schema_invalid',
      generatedText: 'not json at all',
    });
    expect(byCandidate.get(CANDIDATE_B)).toMatchObject({
      validationOutcome: 'provider_safety_blocked',
      generatedText: null,
    });
  });

  it('a transient failure records NOTHING, and the next run retries the same candidate', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_A,
      gardenId: GARDEN_ID,
    });
    const generate = generator([
      { outcome: 'unavailable', reason: 'providerTimeout' },
      acceptedDraft('Ready to harvest — check ripeness.'),
    ]);
    const embellisher = buildEmbellisher(fakes, generate);

    const first = await embellisher.execute();
    expect(first).toMatchObject({ transientFailures: 1, accepted: 0 });
    expect(fakes.aiExplanations.records).toHaveLength(0);

    const second = await embellisher.execute();
    expect(second).toMatchObject({ candidatesConsidered: 1, accepted: 1 });
  });

  it('quota exhaustion stops the batch and says so; the remainder is left for a later run', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_A,
      gardenId: GARDEN_ID,
    });
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_B,
      gardenId: GARDEN_ID,
    });
    const generate = generator([{ outcome: 'unavailable', reason: 'quotaExhausted' }]);

    const result = await buildEmbellisher(fakes, generate).execute();

    expect(result).toMatchObject({
      candidatesConsidered: 2,
      stoppedOnQuotaExhaustion: true,
      accepted: 0,
      rejected: 0,
    });
    // The FIRST call already exhausted — the second candidate was never attempted.
    expect(generate.requests).toHaveLength(1);
    expect(fakes.aiExplanations.records).toHaveLength(0);
  });

  it('a lost insert race is counted, not double-counted as a verdict', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_A,
      gardenId: GARDEN_ID,
    });
    // A concurrent run's record lands between selection and this run's
    // insert: seed the selection result first, then pre-insert.
    const generate = {
      requests: [] as AiExplanationRequest[],
      execute(request: AiExplanationRequest): Promise<GenerateAiExplanationResult> {
        this.requests.push(request);
        // Simulate the concurrent writer winning mid-flight.
        fakes.aiExplanations.records.push({
          id: '019a5000-0000-7000-8000-0000000000ff',
          candidateId: CANDIDATE_A,
          locale: 'en',
          providerKey: 'vertex-ai-explanation',
          model: 'gemini-test',
          promptTemplateVersion: 1,
          packetFactKeys: ['seed.fact'],
          generatedText: 'the other run won',
          validationOutcome: 'accepted',
          createdAt: NOW,
        });
        return Promise.resolve(acceptedDraft('this run lost'));
      },
    };

    const result = await buildEmbellisher(fakes, generate).execute();

    expect(result).toMatchObject({ accepted: 0, rejected: 0, lostRaces: 1 });
    expect(fakes.aiExplanations.records).toHaveLength(1);
    expect(fakes.aiExplanations.records[0]?.generatedText).toBe('the other run won');
  });

  it('fails loudly when a selected candidate pins a rule version this build does not ship', async () => {
    const fakes = createTasksRecommendationsFakes();
    seedRecommendationCandidate(fakes.recommendationCandidates, fakes.ruleVersions, {
      id: CANDIDATE_A,
      gardenId: GARDEN_ID,
      ruleVersion: 99,
    });
    const generate = generator([]);

    await expect(buildEmbellisher(fakes, generate).execute()).rejects.toThrow(InternalError);
  });
});
