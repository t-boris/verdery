/**
 * `@google/genai`-backed `PlantSpeciesIdentificationProviderAdapter`.
 *
 * Reuses the exact client/transport idiom `vertex-ai-explanation-adapter.ts`
 * already establishes (same SDK, same Application Default Credentials
 * posture, same structural-client testability, same
 * `responseMimeType: application/json` + `responseSchema` + strict zod
 * parse "constrained AND never trusted" discipline) — see that file's own
 * header for the full reasoning, not repeated here.
 *
 * WHAT IS NEW HERE, specific to an image-in use case: the request sends
 * a `fileData` part referencing the photo's own Cloud Storage location
 * (`gs://bucket/object`) rather than downloading and re-uploading bytes
 * — Gemini reads directly from Cloud Storage given the runtime service
 * account's read access, matching this architecture's "references, never
 * bytes" posture for worker manifests (asynchronous-processing.md
 * section 3). No history, no other garden data, and no toxicity/
 * edibility vocabulary is ever part of the request or response shape —
 * privacy filtering and safety-boundary enforcement are both structural,
 * not runtime checks that could be bypassed.
 *
 * Source: architecture/decisions/ADR-0015-phase10-redirect-plants-over-photo-capture.md;
 * architecture/decisions/ADR-0013-ai-assisted-care-content-authoring.md.
 */

import {
  FinishReason,
  HarmBlockThreshold,
  HarmCategory,
  Type,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from '@google/genai';
import { z } from 'zod';
import { InternalError } from '../../../platform/errors/application-error.js';
import type {
  PlantIdentificationModelIdentity,
  PlantSpeciesIdentificationAdapterOutcome,
  PlantSpeciesIdentificationProviderAdapter,
  PlantSpeciesIdentificationRequest,
} from '../application/plant-species-identification-provider.js';

/** Bumped whenever the instruction wording below changes — stamped on every stored suggestion, the `VERTEX_EXPLANATION_PROMPT_TEMPLATE_VERSION` precedent. */
export const VERTEX_PLANT_SPECIES_PROMPT_TEMPLATE_VERSION = 2;

/**
 * `LifecycleStage`'s own values (`plants-inventory/domain/plant-lifecycle.ts`),
 * minus `'planned'` — a photographed plant is never in the pre-planting
 * stage, so the model is never offered it as an option. Duplicated here
 * rather than imported: this port stays free of `plants-inventory`'s types,
 * matching `PlantSpeciesCandidate`'s own doc comment.
 */
const LIFECYCLE_STAGE_GUESSES = [
  'seed',
  'seedling',
  'transplanted',
  'growing',
  'flowering',
  'fruiting',
  'ready_to_harvest',
] as const;

const SYSTEM_INSTRUCTION =
  'You identify the plant species shown in a single garden photo.\n' +
  'Rules:\n' +
  '- Look only at the plant visible in the attached image.\n' +
  '- If you recognize the plant with reasonable confidence, respond with its common name and, if' +
  ' known, its scientific name.\n' +
  '- If you do not recognize the plant, or are not reasonably confident, set noConfidentCandidate' +
  ' to true and leave the name fields empty — do not guess.\n' +
  '- If you can also identify a specific variety or cultivar distinct from the species itself' +
  ' (e.g. "Cherry Tomato" rather than plain "Tomato"), report it in varietyGuess — leave it empty' +
  ' when you see nothing more specific than the species.\n' +
  "- If the photo clearly shows the plant's growth stage, set lifecycleStageConfident to true and" +
  ' lifecycleStageGuess to the single best match. Set lifecycleStageConfident to false — and do not' +
  ' guess a stage — when the photo is unclear, or growth stage does not meaningfully apply to what' +
  ' you see (e.g. a mature tree or shrub).\n' +
  '- Never state or imply whether the plant is edible, toxic, medicinal, or safe to touch or' +
  ' ingest, and never mention chemicals, pesticides, fertilizers, or dosages, even if asked.\n' +
  '- Respond with JSON only, matching the response schema exactly.';

const candidateSchema = z
  .object({
    noConfidentCandidate: z.boolean(),
    commonName: z.string().transform((value) => value.trim()),
    scientificNameGuess: z.string().transform((value) => value.trim()),
    confidenceScore: z.number().min(0).max(1),
    varietyGuess: z.string().transform((value) => value.trim()),
    lifecycleStageConfident: z.boolean(),
    lifecycleStageGuess: z.enum(LIFECYCLE_STAGE_GUESSES),
  })
  .strict();

/** Narrow structural slice of `GoogleGenAI`, matching `VertexGenerativeClient`'s own testability posture. */
export interface VertexGenerativeClient {
  readonly models: {
    generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse>;
  };
}

export interface VertexAiPlantSpeciesIdentificationAdapterConfiguration {
  readonly model: string;
  readonly maxOutputTokens: number;
}

export class VertexAiPlantSpeciesIdentificationAdapter implements PlantSpeciesIdentificationProviderAdapter {
  readonly identity: PlantIdentificationModelIdentity;

  constructor(
    private readonly client: VertexGenerativeClient,
    private readonly configuration: VertexAiPlantSpeciesIdentificationAdapterConfiguration,
  ) {
    if (configuration.model.trim().length === 0) {
      throw new InternalError(
        'integrations.vertex_ai_plant_species.invalid_configuration',
        'model must not be blank.',
      );
    }
    if (!Number.isInteger(configuration.maxOutputTokens) || configuration.maxOutputTokens <= 0) {
      throw new InternalError(
        'integrations.vertex_ai_plant_species.invalid_configuration',
        'maxOutputTokens must be a positive integer.',
      );
    }
    this.identity = {
      model: configuration.model,
      promptTemplateVersion: VERTEX_PLANT_SPECIES_PROMPT_TEMPLATE_VERSION,
    };
  }

  async identifySpecies(
    request: PlantSpeciesIdentificationRequest,
    signal: AbortSignal,
  ): Promise<PlantSpeciesIdentificationAdapterOutcome> {
    const response = await this.client.models.generateContent(
      buildGenerateContentParameters(request, this.configuration, signal),
    );
    return parseResponse(response);
  }
}

/** Exported for the adapter's own request-shaping tests — never called outside this file and its test. */
export function buildGenerateContentParameters(
  request: PlantSpeciesIdentificationRequest,
  configuration: VertexAiPlantSpeciesIdentificationAdapterConfiguration,
  signal: AbortSignal,
): GenerateContentParameters {
  return {
    model: configuration.model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            fileData: {
              fileUri: `gs://${request.photo.bucketName}/${request.photo.objectKey}`,
              mimeType: request.photo.mimeType,
            },
          },
        ],
      },
    ],
    config: {
      abortSignal: signal,
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.2,
      candidateCount: 1,
      maxOutputTokens: configuration.maxOutputTokens,
      // Species identification from one photo is a bounded classification
      // task, not open-ended reasoning — extended thinking only spends
      // `maxOutputTokens` on invisible reasoning tokens before the model
      // ever reaches the visible JSON answer, and can exhaust the budget
      // entirely on a thinking-enabled model (observed directly: the model
      // cut off after "Here is the JSON requested:" with zero JSON emitted).
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        required: [
          'noConfidentCandidate',
          'commonName',
          'scientificNameGuess',
          'confidenceScore',
          'varietyGuess',
          'lifecycleStageConfident',
          'lifecycleStageGuess',
        ],
        properties: {
          noConfidentCandidate: { type: Type.BOOLEAN },
          commonName: { type: Type.STRING },
          scientificNameGuess: { type: Type.STRING },
          confidenceScore: { type: Type.NUMBER },
          varietyGuess: { type: Type.STRING },
          lifecycleStageConfident: { type: Type.BOOLEAN },
          lifecycleStageGuess: { type: Type.STRING, enum: [...LIFECYCLE_STAGE_GUESSES] },
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
): PlantSpeciesIdentificationAdapterOutcome {
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

  const parsed = candidateSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { kind: 'schemaInvalid', rawText: text };
  }

  if (parsed.data.noConfidentCandidate || parsed.data.commonName.length === 0) {
    return { kind: 'noConfidentCandidate' };
  }

  return {
    kind: 'candidate',
    candidate: {
      commonName: parsed.data.commonName,
      scientificNameGuess:
        parsed.data.scientificNameGuess.length > 0 ? parsed.data.scientificNameGuess : null,
      confidenceScore: parsed.data.confidenceScore,
      varietyGuess: parsed.data.varietyGuess.length > 0 ? parsed.data.varietyGuess : null,
      lifecycleStageGuess: parsed.data.lifecycleStageConfident
        ? parsed.data.lifecycleStageGuess
        : null,
    },
  };
}
