/**
 * `@google/genai`-backed `PlatExtractionProviderAdapter`.
 *
 * Reuses the client/transport idiom `vertex-ai-plant-species-identification-adapter.ts`
 * already establishes — same SDK, same Application Default Credentials
 * posture, same structural client for testability, the same
 * `responseMimeType: application/json` plus `responseSchema` plus strict zod
 * parse "constrained AND never trusted" discipline, and the same
 * `gs://bucket/object` `fileData` reference rather than shipping bytes. See
 * that file's header for the full reasoning, not repeated here.
 *
 * WHAT IS DIFFERENT, and why it matters: this asks a model to TRANSCRIBE, not
 * to conclude. Every field below is a string or a number printed on the page
 * — a bearing in degrees, minutes and seconds; a distance with the label it
 * was read from; the address as written. The model is told, in the
 * instruction and again by the schema's own shape, that it may not compute
 * the lot polygon, may not convert units, and may not infer an address from
 * a subdivision name. The polygon is walked from these calls by
 * `gardens-mapping/domain/survey-traverse.ts`, whose closure error is the
 * check that a transcription error shows up as a number rather than as a
 * plausible wrong shape (ADR-0018).
 *
 * Source: docs/architecture/decisions/ADR-0018-plat-extraction-as-reviewable-proposals.md;
 * architecture/external-integrations.md, section "9. AI Providers".
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
  PlatExtractionAdapterOutcome,
  PlatExtractionModelIdentity,
  PlatExtractionProviderAdapter,
  PlatExtractionRequest,
} from '../application/plat-extraction-provider.js';
import type { VertexGenerativeClient } from './vertex-ai-plant-species-identification-adapter.js';

/** Bumped whenever the instruction below changes; stamped on every stored proposal. */
export const VERTEX_PLAT_EXTRACTION_PROMPT_TEMPLATE_VERSION = 1;

const SYSTEM_INSTRUCTION = [
  'You transcribe a United States plat of survey. You do not interpret it.',
  '',
  'Return only what is PRINTED on the page:',
  '- The property address of the surveyed parcel, exactly as written. This is the',
  "  address OF THE LOT, not the surveying company's address and not the",
  '  subdivision name. If no property address is printed, return an empty string.',
  '- Every boundary call of the surveyed parcel, in the order they appear around',
  '  the lot: its quadrant bearing (north or south, degrees, minutes, seconds,',
  '  east or west) and its distance in feet. When a line shows both a RECORD and',
  '  a MEASURED distance, use MEASURED. When a line is a curve, use its CHORD',
  '  distance and its chord bearing. Copy the label you read the distance from.',
  '- The rotation of the north arrow, in degrees clockwise from the top of the',
  '  page. Zero means the arrow points straight up. Return -1 if there is no',
  '  north arrow.',
  '- The surveyed area in square feet, if the sheet states one. Return -1 if not.',
  '- The LOT OUTLINE, as points on the page: each point [x, y] in 0..1 of the',
  '  page width and height, origin at the top-left. Trace the surveyed parcel',
  '  boundary, corner by corner, in the order it is drawn.',
  '- EVERY OTHER THING DRAWN INSIDE OR ON the lot, each with its own outline in',
  '  the same page coordinates, its category, the label printed on it, and your',
  '  confidence from 0 to 1. Categories: structure (house, garage, shed, deck,',
  '  porch, patio), path (driveway, walk, asphalt, concrete), fence, zone',
  '  (lawn, planting bed, easement area), waterFeature, utilityExclusion',
  '  (utility or drainage easement strips), tree.',
  '',
  'You must NOT:',
  '- compute, close, or correct the polygon these calls describe;',
  '- state any dimension in feet or metres for anything except the boundary',
  '  calls. Outlines are page coordinates only; the survey supplies the scale.',
  '- convert any unit;',
  '- infer, complete, or correct an address, a bearing, or a distance you cannot',
  '  read. An unreadable value is omitted, never guessed.',
  '',
  'If the page is not a plat of survey — a landscape design, a photograph, a',
  'deed, a floor plan — set notAPlat and return nothing else.',
].join('\n');

export interface VertexAiPlatExtractionAdapterConfiguration {
  readonly model: string;
  readonly maxOutputTokens: number;
}

const bearingSchema = z.object({
  reference: z.enum(['north', 'south']),
  degrees: z.number().min(0).max(90),
  minutes: z.number().min(0).max(59),
  seconds: z.number().min(0).max(59),
  turn: z.enum(['east', 'west']),
});

const pageOutlineSchema = z
  .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
  .min(3);

const responseSchema = z.object({
  notAPlat: z.boolean(),
  lotPageOutline: pageOutlineSchema.or(z.array(z.never()).max(0)),
  pageObjects: z.array(
    z.object({
      category: z.enum([
        'structure',
        'path',
        'fence',
        'zone',
        'waterFeature',
        'utilityExclusion',
        'tree',
      ]),
      label: z.string(),
      pageOutline: pageOutlineSchema,
      confidence: z.number().min(0).max(1),
    }),
  ),
  address: z.string(),
  northRotationDegrees: z.number(),
  statedAreaSquareFeet: z.number(),
  boundaryCalls: z.array(
    z.object({
      bearing: bearingSchema,
      distanceFeet: z.number().positive(),
      sourceLabel: z.string(),
    }),
  ),
});

export class VertexAiPlatExtractionAdapter implements PlatExtractionProviderAdapter {
  readonly identity: PlatExtractionModelIdentity;

  constructor(
    private readonly client: VertexGenerativeClient,
    private readonly configuration: VertexAiPlatExtractionAdapterConfiguration,
  ) {
    if (configuration.model.trim().length === 0) {
      throw new InternalError(
        'integrations.vertex_ai_plat_extraction.invalid_configuration',
        'model must not be blank.',
      );
    }
    if (!Number.isInteger(configuration.maxOutputTokens) || configuration.maxOutputTokens <= 0) {
      throw new InternalError(
        'integrations.vertex_ai_plat_extraction.invalid_configuration',
        'maxOutputTokens must be a positive integer.',
      );
    }
    this.identity = {
      model: configuration.model,
      promptTemplateVersion: VERTEX_PLAT_EXTRACTION_PROMPT_TEMPLATE_VERSION,
    };
  }

  async extractPlat(
    request: PlatExtractionRequest,
    signal: AbortSignal,
  ): Promise<PlatExtractionAdapterOutcome> {
    const response = await this.client.models.generateContent(
      buildPlatExtractionParameters(request, this.configuration, signal),
    );
    return parsePlatExtractionResponse(response);
  }
}

/** Exported for this adapter's own request-shaping tests — never called outside this file and its test. */
export function buildPlatExtractionParameters(
  request: PlatExtractionRequest,
  configuration: VertexAiPlatExtractionAdapterConfiguration,
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
              fileUri: `gs://${request.page.bucketName}/${request.page.objectKey}`,
              mimeType: request.page.mimeType,
            },
          },
        ],
      },
    ],
    config: {
      abortSignal: signal,
      systemInstruction: SYSTEM_INSTRUCTION,
      // Transcription, not judgement: the same numbers must come back from
      // the same page every time, or the closure error stops meaning
      // anything from one run to the next.
      temperature: 0,
      candidateCount: 1,
      maxOutputTokens: configuration.maxOutputTokens,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        required: [
          'notAPlat',
          'address',
          'northRotationDegrees',
          'statedAreaSquareFeet',
          'boundaryCalls',
          'lotPageOutline',
          'pageObjects',
        ],
        properties: {
          notAPlat: { type: Type.BOOLEAN },
          address: { type: Type.STRING },
          northRotationDegrees: { type: Type.NUMBER },
          statedAreaSquareFeet: { type: Type.NUMBER },
          lotPageOutline: {
            type: Type.ARRAY,
            items: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          },
          pageObjects: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['category', 'label', 'pageOutline', 'confidence'],
              properties: {
                category: {
                  type: Type.STRING,
                  enum: [
                    'structure',
                    'path',
                    'fence',
                    'zone',
                    'waterFeature',
                    'utilityExclusion',
                    'tree',
                  ],
                },
                label: { type: Type.STRING },
                pageOutline: {
                  type: Type.ARRAY,
                  items: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                },
                confidence: { type: Type.NUMBER },
              },
            },
          },
          boundaryCalls: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['bearing', 'distanceFeet', 'sourceLabel'],
              properties: {
                bearing: {
                  type: Type.OBJECT,
                  required: ['reference', 'degrees', 'minutes', 'seconds', 'turn'],
                  properties: {
                    reference: { type: Type.STRING, enum: ['north', 'south'] },
                    degrees: { type: Type.NUMBER },
                    minutes: { type: Type.NUMBER },
                    seconds: { type: Type.NUMBER },
                    turn: { type: Type.STRING, enum: ['east', 'west'] },
                  },
                },
                distanceFeet: { type: Type.NUMBER },
                sourceLabel: { type: Type.STRING },
              },
            },
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

/** Exported for this adapter's own response-validation tests. */
export function parsePlatExtractionResponse(
  response: GenerateContentResponse,
): PlatExtractionAdapterOutcome {
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

  const rawText = candidate?.content?.parts?.[0]?.text ?? null;
  if (rawText === null) {
    return { kind: 'schemaInvalid', rawText: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { kind: 'schemaInvalid', rawText };
  }

  const result = responseSchema.safeParse(parsed);
  if (!result.success) {
    return { kind: 'schemaInvalid', rawText };
  }
  if (result.data.notAPlat) {
    return { kind: 'notAPlat' };
  }

  const address = result.data.address.trim();
  return {
    kind: 'extracted',
    plat: {
      address: address === '' ? null : address,
      // The instruction asks for -1 rather than null because the response
      // schema has no nullable numbers; translating it here keeps the
      // sentinel out of the port's own vocabulary.
      northRotationDegrees:
        result.data.northRotationDegrees < 0 ? null : result.data.northRotationDegrees % 360,
      statedAreaSquareFeet:
        result.data.statedAreaSquareFeet < 0 ? null : result.data.statedAreaSquareFeet,
      boundaryCalls: result.data.boundaryCalls,
      lotPageOutline: result.data.lotPageOutline,
      pageObjects: result.data.pageObjects,
    },
  };
}
