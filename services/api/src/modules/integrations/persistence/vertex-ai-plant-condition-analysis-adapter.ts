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

export const VERTEX_PLANT_CONDITION_PROMPT_TEMPLATE_VERSION = 1;

const SYSTEM_INSTRUCTION =
  'You evaluate the condition of a garden plant across one or more photos of the SAME plant,' +
  ' ordered oldest to newest, ending with the most recent photo.\n' +
  'Rules:\n' +
  '- Look for visible signs of stress (wilting, discoloration, poor growth), disease, or pests.' +
  ' Compare the most recent photo against any earlier ones to judge change over time.\n' +
  '- kind must be exactly one of "stress", "disease", "pest", or "other". Use "other" when you see' +
  ' nothing notable, or are not reasonably confident.\n' +
  '- Set requestedAdditionalEvidence to true when the photo is unclear, too far away, or does not' +
  ' show enough of the plant to judge — do not guess in that case.\n' +
  '- Never state or imply whether the plant is edible, toxic, medicinal, or safe to touch or' +
  ' ingest, and never mention chemicals, pesticides, fertilizers, treatments, or dosages, even if' +
  ' asked.\n' +
  '- Respond with JSON only, matching the response schema exactly.';

const KNOWN_KINDS = ['stress', 'disease', 'pest', 'other'] as const;

const observationSchema = z
  .object({
    kind: z.enum(KNOWN_KINDS),
    suggestedLabel: z.string().transform((value) => value.trim()),
    confidenceScore: z.number().min(0).max(1),
    requestedAdditionalEvidence: z.boolean(),
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
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        required: ['kind', 'suggestedLabel', 'confidenceScore', 'requestedAdditionalEvidence'],
        properties: {
          kind: { type: Type.STRING, enum: [...KNOWN_KINDS] },
          suggestedLabel: { type: Type.STRING },
          confidenceScore: { type: Type.NUMBER },
          requestedAdditionalEvidence: { type: Type.BOOLEAN },
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
    },
  };
}
