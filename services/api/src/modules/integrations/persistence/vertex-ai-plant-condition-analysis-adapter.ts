/**
 * `@google/genai`-backed `PlantConditionAnalysisProviderAdapter`. Reuses
 * the same client/transport idiom as `vertex-ai-explanation-adapter.ts`
 * and `vertex-ai-plant-species-identification-adapter.ts` — see those
 * files for the full transport/schema/safety reasoning, not repeated
 * here.
 *
 * WHAT IS NEW HERE: the request sends the new photo plus every prior
 * photo of the SAME plant as separate `fileData` parts, oldest first, so
 * the model can compare change over time rather than judge one frame in
 * isolation — matching `image-analysis-result.ts`'s own framing of this
 * capability as a plant's photo HISTORY, not a single snapshot.
 *
 * Source: architecture/decisions/ADR-0015-phase10-redirect-plants-over-photo-capture.md.
 */

import {
  FinishReason,
  HarmBlockThreshold,
  HarmCategory,
  Type,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
} from '@google/genai';
import { z } from 'zod';
import { InternalError } from '../../../platform/errors/application-error.js';
import type {
  PlantConditionAnalysisAdapterOutcome,
  PlantConditionAnalysisProviderAdapter,
  PlantConditionAnalysisRequest,
  PlantConditionModelIdentity,
} from '../application/plant-condition-analysis-provider.js';

export const VERTEX_PLANT_CONDITION_PROMPT_TEMPLATE_VERSION = 3;

const SYSTEM_INSTRUCTION =
  'You evaluate the condition of a garden plant across one or more photos of the SAME plant,' +
  ' ordered oldest to newest, ending with the most recent photo.\n' +
  'Rules:\n' +
  '- Look for visible signs of stress (wilting, discoloration, poor growth), disease, or pests.' +
  ' Compare the most recent photo against any earlier ones to judge change over time.\n' +
  '- kind must be exactly one of "stress", "disease", "pest", or "other". Use "other" when you see' +
  ' nothing notable, or are not reasonably confident.\n' +
  '- In evidenceSummary, describe what is visibly supporting your suggestion — leave it empty when' +
  ' kind is "other".\n' +
  '- In alternativeExplanations, list other plausible causes as short labels, not full sentences —' +
  ' an empty list when you have no meaningful alternative to name.\n' +
  '- safetyClass must be exactly one of "informational" (routine, cosmetic, or nothing notable),' +
  ' "monitor" (worth watching, no urgent action), or "expert_review_recommended" (potentially' +
  ' serious — suggest the grower consult a nursery or expert). This never authorizes or implies a' +
  ' specific treatment.\n' +
  '- Set requestedAdditionalEvidence to true when the photo is unclear, too far away, or does not' +
  ' show enough of the plant to judge — do not guess in that case. When true, list which of these' +
  ' views would help most in requestedViewPurposes: "whole_plant", "leaf_front", "leaf_back",' +
  ' "stem_or_bark", "flower", "fruit", "symptom_close_up", "context_or_free_form". Leave' +
  ' requestedViewPurposes empty when requestedAdditionalEvidence is false.\n' +
  '- If you have a general care suggestion (e.g. watering, light, pruning), report it in' +
  ' careGuidanceSuggestion — leave it empty when you have nothing specific to add.\n' +
  '- Never state or imply whether the plant is edible, toxic, medicinal, or safe to touch or' +
  ' ingest, never mention chemicals, pesticides, fertilizers, treatments, or dosages, and never' +
  ' state or imply a regulatory, invasive, or restricted-species status, even if asked — this' +
  ' applies to every field, including careGuidanceSuggestion (which may only ever suggest general' +
  ' cultural care, never a treatment or a dosage) and evidenceSummary/alternativeExplanations.\n' +
  '- Respond with JSON only, matching the response schema exactly.';

const KNOWN_KINDS = ['stress', 'disease', 'pest', 'other'] as const;
// Mirror `PLANT_CONDITION_SAFETY_CLASSES`/`PLANT_CONDITION_VIEW_PURPOSES`
// (plant-condition-analysis-provider.ts) as local literal tuples — `zod`'s
// `.enum()` needs a tuple type, and those two are plain `readonly T[]`
// (built for iteration, not for this), so this file keeps its own
// `as const` copies rather than reshaping the port's own exported type.
const KNOWN_SAFETY_CLASSES = ['informational', 'monitor', 'expert_review_recommended'] as const;
const KNOWN_VIEW_PURPOSES = [
  'whole_plant',
  'leaf_front',
  'leaf_back',
  'stem_or_bark',
  'flower',
  'fruit',
  'symptom_close_up',
  'context_or_free_form',
] as const;

const observationSchema = z
  .object({
    kind: z.enum(KNOWN_KINDS),
    suggestedLabel: z.string().transform((value) => value.trim()),
    confidenceScore: z.number().min(0).max(1),
    requestedAdditionalEvidence: z.boolean(),
    careGuidanceSuggestion: z.string().transform((value) => value.trim()),
    evidenceSummary: z.string().transform((value) => value.trim()),
    alternativeExplanations: z.array(z.string().transform((value) => value.trim())),
    safetyClass: z.enum(KNOWN_SAFETY_CLASSES),
    requestedViewPurposes: z.array(z.enum(KNOWN_VIEW_PURPOSES)),
  })
  .strict();

export interface VertexGenerativeClient {
  readonly models: {
    generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse>;
  };
}

export interface VertexAiPlantConditionAnalysisAdapterConfiguration {
  readonly model: string;
  readonly maxOutputTokens: number;
}

export class VertexAiPlantConditionAnalysisAdapter implements PlantConditionAnalysisProviderAdapter {
  readonly identity: PlantConditionModelIdentity;

  constructor(
    private readonly client: VertexGenerativeClient,
    private readonly configuration: VertexAiPlantConditionAnalysisAdapterConfiguration,
  ) {
    if (configuration.model.trim().length === 0) {
      throw new InternalError(
        'integrations.vertex_ai_plant_condition.invalid_configuration',
        'model must not be blank.',
      );
    }
    if (!Number.isInteger(configuration.maxOutputTokens) || configuration.maxOutputTokens <= 0) {
      throw new InternalError(
        'integrations.vertex_ai_plant_condition.invalid_configuration',
        'maxOutputTokens must be a positive integer.',
      );
    }
    this.identity = {
      model: configuration.model,
      promptTemplateVersion: VERTEX_PLANT_CONDITION_PROMPT_TEMPLATE_VERSION,
    };
  }

  async analyzeCondition(
    request: PlantConditionAnalysisRequest,
    signal: AbortSignal,
  ): Promise<PlantConditionAnalysisAdapterOutcome> {
    const response = await this.client.models.generateContent(
      buildGenerateContentParameters(request, this.configuration, signal),
    );
    return parseResponse(response);
  }
}

/** Exported for the adapter's own request-shaping tests. */
export function buildGenerateContentParameters(
  request: PlantConditionAnalysisRequest,
  configuration: VertexAiPlantConditionAnalysisAdapterConfiguration,
  signal: AbortSignal,
): GenerateContentParameters {
  const orderedPhotos = [...request.priorPhotos.map((entry) => entry.photo), request.photo];
  const parts: Part[] = orderedPhotos.map((photo) => ({
    fileData: {
      fileUri: `gs://${photo.bucketName}/${photo.objectKey}`,
      mimeType: photo.mimeType,
    },
  }));

  return {
    model: configuration.model,
    contents: [{ role: 'user', parts }],
    config: {
      abortSignal: signal,
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.2,
      candidateCount: 1,
      maxOutputTokens: configuration.maxOutputTokens,
      // See vertex-ai-plant-species-identification-adapter.ts's identical
      // comment: a bounded classification task, not open-ended reasoning —
      // extended thinking can exhaust maxOutputTokens on invisible
      // reasoning tokens before any visible JSON answer is emitted.
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        required: [
          'kind',
          'suggestedLabel',
          'confidenceScore',
          'requestedAdditionalEvidence',
          'careGuidanceSuggestion',
          'evidenceSummary',
          'alternativeExplanations',
          'safetyClass',
          'requestedViewPurposes',
        ],
        properties: {
          kind: { type: Type.STRING, enum: [...KNOWN_KINDS] },
          suggestedLabel: { type: Type.STRING },
          confidenceScore: { type: Type.NUMBER },
          requestedAdditionalEvidence: { type: Type.BOOLEAN },
          careGuidanceSuggestion: { type: Type.STRING },
          evidenceSummary: { type: Type.STRING },
          alternativeExplanations: { type: Type.ARRAY, items: { type: Type.STRING } },
          safetyClass: { type: Type.STRING, enum: [...KNOWN_SAFETY_CLASSES] },
          requestedViewPurposes: {
            type: Type.ARRAY,
            items: { type: Type.STRING, enum: [...KNOWN_VIEW_PURPOSES] },
          },
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
export function parseResponse(
  response: GenerateContentResponse,
): PlantConditionAnalysisAdapterOutcome {
  if (response.promptFeedback?.blockReason !== undefined) {
    return { kind: 'safetyBlocked' };
  }
  const candidate = response.candidates?.[0];
  if (
    candidate?.finishReason === FinishReason.SAFETY ||
    candidate?.finishReason === FinishReason.PROHIBITED_CONTENT ||
    candidate?.finishReason === FinishReason.BLOCKLIST ||
    candidate?.finishReason === FinishReason.SPII
  ) {
    return { kind: 'safetyBlocked' };
  }

  const text = response.text;
  if (text === undefined || text.trim().length === 0) {
    return { kind: 'schemaInvalid', rawText: null };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return { kind: 'schemaInvalid', rawText: text };
  }

  const parsed = observationSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { kind: 'schemaInvalid', rawText: text };
  }

  return {
    kind: 'observation',
    observation: {
      kind: parsed.data.kind,
      suggestedLabel: parsed.data.suggestedLabel,
      confidenceScore: parsed.data.confidenceScore,
      requestedAdditionalEvidence: parsed.data.requestedAdditionalEvidence,
      careGuidanceSuggestion: parsed.data.careGuidanceSuggestion,
      evidenceSummary: parsed.data.evidenceSummary,
      alternativeExplanations: parsed.data.alternativeExplanations,
      safetyClass: parsed.data.safetyClass,
      requestedViewPurposes: parsed.data.requestedViewPurposes,
    },
  };
}
