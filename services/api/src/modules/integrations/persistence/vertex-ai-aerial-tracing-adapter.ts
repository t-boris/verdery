/**
 * Fetches a fixed-size, north-up USGS NAIP image and asks Vertex AI for
 * reviewable site-feature traces. The URL is fixed code, never caller input,
 * so this cannot become an arbitrary server-side fetch surface.
 */

import {
  FinishReason,
  HarmBlockThreshold,
  HarmCategory,
  Type,
  type GenerateContentResponse,
} from '@google/genai';
import { z } from 'zod';

import { InternalError } from '../../../platform/errors/application-error.js';
import type {
  AerialTracingAdapterOutcome,
  AerialTracingProviderAdapter,
  AerialTracingRequest,
} from '../application/aerial-tracing-provider.js';
import { AERIAL_TRACE_SPAN_METRES } from '../application/aerial-tracing-provider.js';
import type { VertexGenerativeClient } from './vertex-ai-plant-species-identification-adapter.js';

const IMAGE_SIZE_PX = 1024;
const MAX_IMAGE_BYTES = 8_000_000;
const METRES_PER_DEGREE_LATITUDE = 111_320;
const RADIANS_PER_DEGREE = Math.PI / 180;
const USGS_EXPORT_URL =
  'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage';

const SYSTEM_INSTRUCTION = [
  'You trace the target residential property from a north-up aerial image.',
  'The saved address point is exactly at the centre of the image. Analyse the',
  'property containing that centre point, not a neighbouring house.',
  '',
  'Return normalized image coordinates [x,y] in 0..1, origin top-left.',
  '- lotPoints: the best estimated property outline, corner by corner, without',
  '  repeating the first point. Use fences, hedges, road frontage, driveways,',
  '  neighbouring parcel rhythm and maintained-lawn boundaries as evidence.',
  '  An aerial image is not a cadastral survey: use evidence=inferred unless',
  '  every edge is directly visible. Return an empty array if no defensible',
  '  estimate is possible.',
  '- objects: only features belonging to that target property.',
  '- structure polygons: visible roof footprints for the house, garage, shed,',
  '  deck or patio; at least 3 points.',
  '- path lines: driveway and walk centre lines; at least 2 points.',
  '- zone polygons: visible parking pads and other paved parking areas; label',
  '  them Parking area. Do not use zone for ordinary lawn.',
  '- fence lines: visible fence centre lines; at least 2 points.',
  '- zone, waterFeature and utilityExclusion polygons: at least 3 points.',
  '- tree points: one point at each clearly visible mature tree trunk or crown',
  '  centre, no more than 30 trees.',
  '',
  'For each object provide a short label, confidence 0..1, and evidence:',
  'visible when the pixels directly show it, inferred only when contextual',
  'cues were necessary. Do not trace cars, shadows, neighbouring buildings,',
  'roof details, image seams, or objects outside the estimated lot.',
  'Set imageryUsable=false only when the image is blank, cloud-covered or does',
  'not contain readable aerial photography.',
].join('\n');

const pointSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const pointsSchema = z.array(pointSchema);
const evidenceSchema = z.enum(['visible', 'inferred']);
const responseSchema = z.object({
  imageryUsable: z.boolean(),
  lotPoints: pointsSchema,
  lotConfidence: z.number().min(0).max(1),
  lotEvidence: evidenceSchema,
  objects: z.array(
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
      imagePoints: pointsSchema,
      confidence: z.number().min(0).max(1),
      evidence: evidenceSchema,
    }),
  ),
});

export interface VertexAiAerialTracingConfiguration {
  readonly model: string;
  readonly maxOutputTokens: number;
}

type FetchLike = typeof fetch;

export class VertexAiAerialTracingAdapter implements AerialTracingProviderAdapter {
  constructor(
    private readonly client: VertexGenerativeClient,
    private readonly configuration: VertexAiAerialTracingConfiguration,
    private readonly fetchImage: FetchLike = fetch,
  ) {
    if (configuration.model.trim().length === 0 || configuration.maxOutputTokens <= 0) {
      throw new InternalError(
        'integrations.vertex_ai_aerial_tracing.invalid_configuration',
        'A model and positive output-token limit are required.',
      );
    }
  }

  async traceSite(
    request: AerialTracingRequest,
    signal: AbortSignal,
  ): Promise<AerialTracingAdapterOutcome> {
    const image = await this.fetchImage(imageUrl(request.geographicCenter), { signal });
    if (!image.ok) {
      return { kind: 'imageryUnavailable' };
    }
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      return { kind: 'imageryUnavailable' };
    }

    const response = await this.client.models.generateContent({
      model: this.configuration.model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: Buffer.from(bytes).toString('base64'),
                mimeType: image.headers.get('content-type') ?? 'image/jpeg',
              },
            },
            {
              text:
                request.displayAddress === null
                  ? 'Trace the property at the image centre.'
                  : `Trace the property at the image centre: ${request.displayAddress}`,
            },
          ],
        },
      ],
      config: {
        abortSignal: signal,
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0,
        candidateCount: 1,
        maxOutputTokens: this.configuration.maxOutputTokens,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json',
        responseSchema: vertexResponseSchema(),
        safetySettings: safetySettings(),
      },
    });
    return parseAerialTracingResponse(response);
  }
}

function imageUrl(center: readonly [number, number]): string {
  const [longitude, latitude] = center;
  const half = AERIAL_TRACE_SPAN_METRES / 2;
  const latitudeDelta = half / METRES_PER_DEGREE_LATITUDE;
  const longitudeDelta =
    half / (METRES_PER_DEGREE_LATITUDE * Math.cos(latitude * RADIANS_PER_DEGREE));
  const params = new URLSearchParams({
    bbox: [
      longitude - longitudeDelta,
      latitude - latitudeDelta,
      longitude + longitudeDelta,
      latitude + latitudeDelta,
    ].join(','),
    bboxSR: '4326',
    imageSR: '4326',
    size: `${String(IMAGE_SIZE_PX)},${String(IMAGE_SIZE_PX)}`,
    format: 'jpg',
    f: 'image',
  });
  return `${USGS_EXPORT_URL}?${params.toString()}`;
}

function vertexResponseSchema() {
  const points = { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.NUMBER } } };
  return {
    type: Type.OBJECT,
    required: ['imageryUsable', 'lotPoints', 'lotConfidence', 'lotEvidence', 'objects'],
    properties: {
      imageryUsable: { type: Type.BOOLEAN },
      lotPoints: points,
      lotConfidence: { type: Type.NUMBER },
      lotEvidence: { type: Type.STRING, enum: ['visible', 'inferred'] },
      objects: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['category', 'label', 'imagePoints', 'confidence', 'evidence'],
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
            imagePoints: points,
            confidence: { type: Type.NUMBER },
            evidence: { type: Type.STRING, enum: ['visible', 'inferred'] },
          },
        },
      },
    },
  };
}

function safetySettings() {
  return [
    HarmCategory.HARM_CATEGORY_HARASSMENT,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  ].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }));
}

export function parseAerialTracingResponse(
  response: GenerateContentResponse,
): AerialTracingAdapterOutcome {
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
  if (!result.data.imageryUsable) {
    return { kind: 'imageryUnavailable' };
  }
  return {
    kind: 'extracted',
    site: {
      lot:
        result.data.lotPoints.length < 3
          ? null
          : {
              imagePoints: result.data.lotPoints,
              confidence: result.data.lotConfidence,
              evidence: result.data.lotEvidence,
            },
      objects: result.data.objects,
    },
  };
}
