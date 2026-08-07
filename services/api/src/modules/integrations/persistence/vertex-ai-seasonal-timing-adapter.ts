/**
 * `@google/genai`-backed `SeasonalTimingProposalProvider` — ADR-0013's
 * proposal lane, behind the same Vertex adapter boundary
 * `vertex-ai-explanation-adapter.ts` established.
 *
 * WHAT THE ADAPTER ENFORCES: the output schema (`responseMimeType:
 * application/json` plus a `responseSchema` constraining generation, then a
 * strict zod parse of what actually came back — the model is constrained
 * AND never trusted), a deterministic-leaning temperature, a bounded token
 * budget, every text harm category at the strictest generally-applicable
 * threshold, and the caller's abort signal.
 *
 * PRIVACY IS STRUCTURAL. The request is built from a taxon's NAMES and a
 * hemisphere, and nothing else can reach it — no garden, no plant, no
 * account, no location beyond a hemisphere. This is not a filter that could
 * be forgotten; there is no field on the port carrying anything more.
 *
 * THE EXCLUSIONS ARE STRUCTURAL TOO. Edibility, toxicity and chemical
 * guidance are excluded from AI authoring entirely by ADR-0013, and the
 * response schema below has no property that could carry them. A prompt
 * instruction can drift; an absent schema field cannot.
 *
 * NULL IS A FIRST-CLASS ANSWER. Every timing field is nullable and the
 * system instruction says so plainly, because a crop with no succession
 * benefit and a crop the model cannot speak to must produce different
 * results — and neither may be filled with a plausible number. A response
 * where every field is null becomes `declined` rather than an empty draft
 * nobody could review.
 *
 * Source: ADR-0013-ai-assisted-care-content-authoring.md;
 * architecture/recommendations-and-ai.md, sections "8. Vertex AI Boundary"
 * and "9. Structured Output".
 */

import { FinishReason, HarmBlockThreshold, HarmCategory, Type } from '@google/genai';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import type {
  SeasonalTimingDraft,
  SeasonalTimingProposalOutcome,
  SeasonalTimingProposalProvider,
  SeasonalTimingProposalRequest,
} from '../application/seasonal-timing-proposal-provider.js';
import type { VertexGenerativeClient } from './vertex-ai-explanation-adapter.js';

/** Bumped whenever the instruction below changes, so a later evaluation can identify which proposals were drafted under which wording. */
export const VERTEX_SEASONAL_TIMING_PROMPT_TEMPLATE_VERSION = 1;

const SYSTEM_INSTRUCTION = [
  'You draft SEASONAL TIMING for a single plant taxon, for review by a human horticulturist.',
  'Your output is a proposal. It is never shown to a gardener and never used by any',
  'automated system until a horticulturist has accepted or corrected it.',
  '',
  'Return months as integers 1-12 in the stated hemisphere.',
  '',
  'Use null for anything you cannot state with confidence for this taxon, and for anything',
  'that genuinely does not apply — a root crop that is never transplanted, a crop with no',
  'succession benefit. A null is a correct and expected answer. Never substitute a plausible',
  'number for a value you do not know: a reviewer can correct a null, but cannot tell a',
  'confident guess from knowledge.',
  '',
  'Do not state edibility, toxicity, pest treatment, or any chemical application. Those are',
  'authored by a human from a cited source and are not part of this task.',
].join('\n');

const draftSchema = z.object({
  sowIndoorsStartMonth: z.number().int().min(1).max(12).nullable(),
  sowIndoorsEndMonth: z.number().int().min(1).max(12).nullable(),
  sowOutdoorsStartMonth: z.number().int().min(1).max(12).nullable(),
  sowOutdoorsEndMonth: z.number().int().min(1).max(12).nullable(),
  transplantStartMonth: z.number().int().min(1).max(12).nullable(),
  transplantEndMonth: z.number().int().min(1).max(12).nullable(),
  harvestStartMonth: z.number().int().min(1).max(12).nullable(),
  harvestEndMonth: z.number().int().min(1).max(12).nullable(),
  daysToMaturityMin: z.number().int().positive().nullable(),
  daysToMaturityMax: z.number().int().positive().nullable(),
  successionIntervalDays: z.number().int().positive().nullable(),
  rotationRestSeasons: z.number().int().min(0).nullable(),
});

const MONTH = { type: Type.INTEGER, nullable: true } as const;

export interface VertexSeasonalTimingAdapterConfiguration {
  readonly model: string;
  readonly maxOutputTokens: number;
}

export class VertexAiSeasonalTimingAdapter implements SeasonalTimingProposalProvider {
  constructor(
    private readonly client: VertexGenerativeClient,
    private readonly configuration: VertexSeasonalTimingAdapterConfiguration,
  ) {}

  async proposeSeasonalTiming(
    request: SeasonalTimingProposalRequest,
    signal: AbortSignal,
  ): Promise<SeasonalTimingProposalOutcome> {
    const response = await this.client.models.generateContent(
      buildSeasonalTimingParameters(request, this.configuration, signal),
    );
    return parseSeasonalTimingResponse(response);
  }
}

/** Exported for the adapter's own request-shape tests. */
export function buildSeasonalTimingParameters(
  request: SeasonalTimingProposalRequest,
  configuration: VertexSeasonalTimingAdapterConfiguration,
  signal: AbortSignal,
): GenerateContentParameters {
  // The whole packet: a taxon's names and a hemisphere. Nothing about any
  // garden, plant, account or location can reach the provider, because
  // nothing else exists on the port.
  const packet = {
    scientificName: request.scientificName,
    commonName: request.commonName,
    family: request.family,
    hemisphere: request.hemisphere,
  };

  return {
    model: configuration.model,
    contents: JSON.stringify(packet),
    config: {
      abortSignal: signal,
      systemInstruction: SYSTEM_INSTRUCTION,
      // The task is recall of established horticultural timing, not
      // creative writing.
      temperature: 0.1,
      candidateCount: 1,
      maxOutputTokens: configuration.maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        // No edibility, toxicity or chemical property exists here, which
        // is what makes ADR-0013's exclusion structural rather than an
        // instruction the model could drift away from.
        properties: {
          sowIndoorsStartMonth: MONTH,
          sowIndoorsEndMonth: MONTH,
          sowOutdoorsStartMonth: MONTH,
          sowOutdoorsEndMonth: MONTH,
          transplantStartMonth: MONTH,
          transplantEndMonth: MONTH,
          harvestStartMonth: MONTH,
          harvestEndMonth: MONTH,
          daysToMaturityMin: { type: Type.INTEGER, nullable: true },
          daysToMaturityMax: { type: Type.INTEGER, nullable: true },
          successionIntervalDays: { type: Type.INTEGER, nullable: true },
          rotationRestSeasons: { type: Type.INTEGER, nullable: true },
        },
      },
      safetySettings: [
        HarmCategory.HARM_CATEGORY_HARASSMENT,
        HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      ].map((category) => ({
        category,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      })),
    },
  };
}

/** Exported for the adapter's own response-validation tests. */
export function parseSeasonalTimingResponse(
  response: GenerateContentResponse,
): SeasonalTimingProposalOutcome {
  if (response.promptFeedback?.blockReason !== undefined) {
    return { kind: 'unavailable', reason: 'safetyBlocked' };
  }
  const candidate = response.candidates?.[0];
  if (
    candidate?.finishReason === FinishReason.SAFETY ||
    candidate?.finishReason === FinishReason.PROHIBITED_CONTENT ||
    candidate?.finishReason === FinishReason.BLOCKLIST ||
    candidate?.finishReason === FinishReason.SPII
  ) {
    return { kind: 'unavailable', reason: 'safetyBlocked' };
  }
  if (candidate?.finishReason === FinishReason.MAX_TOKENS) {
    // A truncated JSON body is not a partial draft — it is not a draft.
    return { kind: 'unavailable', reason: 'truncated' };
  }

  const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (text.trim().length === 0) {
    return { kind: 'unavailable', reason: 'emptyResponse' };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { kind: 'unavailable', reason: 'malformedJson' };
  }

  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) {
    // Constrained generation is not trusted: a response that does not match
    // the schema is refused whole rather than repaired.
    return { kind: 'unavailable', reason: 'schemaMismatch' };
  }

  const draft: SeasonalTimingDraft = parsed.data;
  const claimsSomething = Object.values(draft).some((value) => value !== null);
  return claimsSomething
    ? { kind: 'drafted', draft }
    : // Every field null: the model declined. Recorded as a decline rather
      // than an empty proposal, because there is nothing here to review.
      { kind: 'declined', reason: 'noTimingClaimed' };
}
