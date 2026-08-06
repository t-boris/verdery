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
  AerialGardenExtractionOutcome,
  AerialGardenExtractionProviderAdapter,
} from '../application/aerial-garden-extraction-provider.js';
import type { AerialImage } from '../application/aerial-imagery-provider.js';
import type { VertexGenerativeClient } from './vertex-ai-plant-species-identification-adapter.js';

export const VERTEX_AERIAL_TRACE_PROMPT_TEMPLATE_VERSION = 1;

const SYSTEM_INSTRUCTION = [
  'Inspect this orthorectified aerial image and propose only garden geometry that is reasonably visible.',
  'The geocoded address point is at the exact image centre. Treat the property containing that point as the only target property.',
  'First distinguish the target property from its neighbours using visible parcel evidence. Never return objects belonging to neighbouring properties.',
  'If the target property cannot be isolated from neighbouring properties with reasonable confidence, return an empty objects array.',
  'Coordinates are normalized image coordinates [x,y] in 0..1, origin top-left.',
  'Return structures, driveways/walks/paths, fences, zones or beds, water features, utility exclusions, and tree trunk points where visible.',
  'Use polygons for lot/structure/zone/bed/waterFeature/utilityExclusion, lines for path/fence, and exactly one point for tree.',
  'Do not infer a lot boundary from roofs, lawns, shadows, or neighboring maintenance patterns.',
  'Propose a lot only when visible evidence such as a continuous fence/curb/hedge supports an approximate outline; mark boundaryEvidence visualEvidence and state limitations.',
  'This image contains no authoritative parcel geometry, so never return authoritativeParcel.',
  'Include concrete limitations for occlusion, shadows, resolution, ambiguity, and uncertain endpoints.',
  'Omit anything you cannot locate reliably. Do not identify people, vehicles, or private activity.',
].join('\n');

const pointSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const objectSchema = z
  .object({
    category: z.enum([
      'lot',
      'structure',
      'path',
      'fence',
      'zone',
      'bed',
      'waterFeature',
      'utilityExclusion',
      'tree',
    ]),
    label: z.string().max(200),
    points: z.array(pointSchema).min(1).max(200),
    confidence: z.number().min(0).max(1),
    limitations: z.array(z.string().min(1).max(500)).max(10),
    boundaryEvidence: z.enum(['notApplicable', 'visualEvidence', 'authoritativeParcel']),
  })
  .superRefine((value, context) => {
    const minimum =
      value.category === 'tree'
        ? 1
        : value.category === 'path' || value.category === 'fence'
          ? 2
          : 3;
    if (value.points.length < minimum || (value.category === 'tree' && value.points.length !== 1)) {
      context.addIssue({ code: 'custom', message: 'Geometry has too few points.' });
    }
    if (value.category === 'lot' && value.boundaryEvidence !== 'visualEvidence') {
      context.addIssue({ code: 'custom', message: 'A lot needs explicit visual evidence.' });
    }
    if (value.category !== 'lot' && value.boundaryEvidence !== 'notApplicable') {
      context.addIssue({ code: 'custom', message: 'Boundary evidence only applies to lots.' });
    }
  });

const responseSchema = z.object({ objects: z.array(objectSchema).max(200) });

export interface VertexAiAerialTraceConfiguration {
  readonly model: string;
  readonly maxOutputTokens: number;
}

export class VertexAiAerialGardenExtractionAdapter implements AerialGardenExtractionProviderAdapter {
  readonly identity;

  constructor(
    private readonly client: VertexGenerativeClient,
    private readonly configuration: VertexAiAerialTraceConfiguration,
  ) {
    if (configuration.model.trim() === '' || configuration.maxOutputTokens <= 0) {
      throw new InternalError(
        'integrations.vertex_ai_aerial_trace.invalid_configuration',
        'A model and positive output-token limit are required.',
      );
    }
    this.identity = {
      processor: 'vertex-ai-aerial-garden-extraction',
      model: configuration.model,
      promptTemplateVersion: VERTEX_AERIAL_TRACE_PROMPT_TEMPLATE_VERSION,
    };
  }

  async extractGarden(
    image: AerialImage,
    signal: AbortSignal,
  ): Promise<AerialGardenExtractionOutcome> {
    const response = await this.client.models.generateContent(
      buildAerialTraceParameters(image, this.configuration, signal),
    );
    return parseAerialTraceResponse(response);
  }
}

export function buildAerialTraceParameters(
  image: AerialImage,
  configuration: VertexAiAerialTraceConfiguration,
  signal: AbortSignal,
): GenerateContentParameters {
  return {
    model: configuration.model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              data: Buffer.from(image.bytes).toString('base64'),
              mimeType: image.mimeType,
            },
          },
          {
            text: `Ground resolution: ${image.groundResolutionMetres.toFixed(3)} metres/pixel. Acquisition date: ${image.identity.capturedOn ?? 'not supplied by provider'}.`,
          },
        ],
      },
    ],
    config: {
      abortSignal: signal,
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0,
      candidateCount: 1,
      maxOutputTokens: configuration.maxOutputTokens,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        required: ['objects'],
        properties: {
          objects: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: [
                'category',
                'label',
                'points',
                'confidence',
                'limitations',
                'boundaryEvidence',
              ],
              properties: {
                category: {
                  type: Type.STRING,
                  enum: [
                    'lot',
                    'structure',
                    'path',
                    'fence',
                    'zone',
                    'bed',
                    'waterFeature',
                    'utilityExclusion',
                    'tree',
                  ],
                },
                label: { type: Type.STRING },
                points: {
                  type: Type.ARRAY,
                  items: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                },
                confidence: { type: Type.NUMBER },
                limitations: { type: Type.ARRAY, items: { type: Type.STRING } },
                boundaryEvidence: {
                  type: Type.STRING,
                  enum: ['notApplicable', 'visualEvidence', 'authoritativeParcel'],
                },
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
      ].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE })),
    },
  };
}

export function parseAerialTraceResponse(
  response: GenerateContentResponse,
): AerialGardenExtractionOutcome {
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
  const rawText = candidate?.content?.parts?.[0]?.text;
  if (rawText === undefined) {
    return { kind: 'schemaInvalid' };
  }
  try {
    const parsed = responseSchema.safeParse(JSON.parse(rawText));
    if (!parsed.success) {
      return { kind: 'schemaInvalid' };
    }
    return parsed.data.objects.length === 0
      ? { kind: 'noVisibleGeometry' }
      : { kind: 'extracted', objects: parsed.data.objects };
  } catch {
    return { kind: 'schemaInvalid' };
  }
}
