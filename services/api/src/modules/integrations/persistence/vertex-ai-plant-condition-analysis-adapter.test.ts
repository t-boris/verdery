/**
 * Unit tests for the Vertex AI plant-condition-analysis adapter — request
 * shaping and response validation against CONSTRUCTED SDK response shapes,
 * no live Vertex anywhere. Mirrors
 * `vertex-ai-plant-species-identification-adapter.test.ts`'s own structure.
 */

import { FinishReason, GenerateContentResponse, Type } from '@google/genai';
import type { GenerateContentParameters, Part } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { InternalError } from '../../../platform/errors/application-error.js';
import type { PlantConditionAnalysisRequest } from '../application/plant-condition-analysis-provider.js';
import {
  buildGenerateContentParameters,
  parseResponse,
  VERTEX_PLANT_CONDITION_PROMPT_TEMPLATE_VERSION,
  VertexAiPlantConditionAnalysisAdapter,
} from './vertex-ai-plant-condition-analysis-adapter.js';
import type { VertexGenerativeClient } from './vertex-ai-plant-condition-analysis-adapter.js';

const NEW_PHOTO = {
  bucketName: 'verdery-user-media',
  objectKey: 'gardens/garden-1/plants/photo-new.jpg',
  mimeType: 'image/jpeg',
  byteSize: 1_024,
};
const PRIOR_PHOTO = {
  bucketName: 'verdery-user-media',
  objectKey: 'gardens/garden-1/plants/photo-old.jpg',
  mimeType: 'image/jpeg',
  byteSize: 1_024,
};

const REQUEST: PlantConditionAnalysisRequest = {
  photo: NEW_PHOTO,
  priorPhotos: [{ photo: PRIOR_PHOTO, observedAt: '2026-07-01T00:00:00Z' }],
};

const CONFIGURATION = { model: 'gemini-test-model', maxOutputTokens: 256 };

function response(overrides: Partial<GenerateContentResponse>): GenerateContentResponse {
  return Object.assign(new GenerateContentResponse(), overrides);
}

function textResponse(text: string): GenerateContentResponse {
  return response({
    candidates: [
      { content: { role: 'model', parts: [{ text }] }, finishReason: FinishReason.STOP },
    ],
  });
}

describe('buildGenerateContentParameters', () => {
  const signal = new AbortController().signal;
  const parameters = buildGenerateContentParameters(REQUEST, CONFIGURATION, signal);

  it('shapes the bounded call: model, JSON response schema, token budget, single candidate, low temperature, abort signal', () => {
    expect(parameters.model).toBe('gemini-test-model');
    expect(parameters.config?.abortSignal).toBe(signal);
    expect(parameters.config?.maxOutputTokens).toBe(256);
    expect(parameters.config?.candidateCount).toBe(1);
    expect(parameters.config?.temperature).toBe(0.2);
    expect(parameters.config?.responseMimeType).toBe('application/json');
    expect(parameters.config?.responseSchema).toMatchObject({
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
    });
  });

  it('sends every prior photo before the new one, oldest first, each as a fileData reference', () => {
    const content = (parameters.contents as { parts: Part[] }[])[0];
    const parts = content?.parts ?? [];
    expect(parts).toHaveLength(2);
    expect(parts[0]?.fileData).toEqual({
      fileUri: 'gs://verdery-user-media/gardens/garden-1/plants/photo-old.jpg',
      mimeType: 'image/jpeg',
    });
    expect(parts[1]?.fileData).toEqual({
      fileUri: 'gs://verdery-user-media/gardens/garden-1/plants/photo-new.jpg',
      mimeType: 'image/jpeg',
    });
  });

  it('sends only the new photo when there is no history', () => {
    const soloParameters = buildGenerateContentParameters(
      { photo: NEW_PHOTO, priorPhotos: [] },
      CONFIGURATION,
      signal,
    );
    const content = (soloParameters.contents as { parts: Part[] }[])[0];
    expect(content?.parts).toHaveLength(1);
  });

  it('instructs the versioned bounds: compare over time, known kinds only, never toxicity/edibility/regulatory, JSON-only', () => {
    expect(typeof parameters.config?.systemInstruction).toBe('string');
    const instruction = parameters.config?.systemInstruction as string;
    expect(instruction).toContain('ordered oldest to newest');
    expect(instruction).toContain('"stress", "disease", "pest", or "other"');
    expect(instruction).toContain('Never state or imply whether the plant is edible, toxic');
    expect(instruction).toContain('regulatory, invasive, or restricted-species status');
    expect(instruction).toContain('Respond with JSON only');
    expect(instruction).toContain('careGuidanceSuggestion');
    expect(instruction).toContain('evidenceSummary');
    expect(instruction).toContain('alternativeExplanations');
    expect(instruction).toContain('safetyClass');
    expect(instruction).toContain('requestedViewPurposes');
    expect(VERTEX_PLANT_CONDITION_PROMPT_TEMPLATE_VERSION).toBe(3);
  });
});

const FULL_OBSERVATION_JSON =
  '{"kind": "stress", "suggestedLabel": " Wilting leaves ", "confidenceScore": 0.7,' +
  ' "requestedAdditionalEvidence": false, "careGuidanceSuggestion": " Water more consistently ",' +
  ' "evidenceSummary": " Lower leaves yellowing ", "alternativeExplanations": ["Nutrient deficiency"],' +
  ' "safetyClass": "monitor", "requestedViewPurposes": []}';

describe('parseResponse', () => {
  it('parses a confident observation, trimming string fields', () => {
    const outcome = parseResponse(textResponse(FULL_OBSERVATION_JSON));
    expect(outcome).toEqual({
      kind: 'observation',
      observation: {
        kind: 'stress',
        suggestedLabel: 'Wilting leaves',
        confidenceScore: 0.7,
        requestedAdditionalEvidence: false,
        careGuidanceSuggestion: 'Water more consistently',
        evidenceSummary: 'Lower leaves yellowing',
        alternativeExplanations: ['Nutrient deficiency'],
        safetyClass: 'monitor',
        requestedViewPurposes: [],
      },
    });
  });

  it('parses requestedViewPurposes when non-empty', () => {
    const outcome = parseResponse(
      textResponse(
        '{"kind": "other", "suggestedLabel": "", "confidenceScore": 0,' +
          ' "requestedAdditionalEvidence": true, "careGuidanceSuggestion": "",' +
          ' "evidenceSummary": "", "alternativeExplanations": [], "safetyClass": "informational",' +
          ' "requestedViewPurposes": ["leaf_back", "symptom_close_up"]}',
      ),
    );
    expect(outcome).toMatchObject({
      kind: 'observation',
      observation: { requestedViewPurposes: ['leaf_back', 'symptom_close_up'] },
    });
  });

  it('rejects non-JSON text as schemaInvalid, keeping the raw text for the record', () => {
    const outcome = parseResponse(textResponse('The plant looks a bit stressed.'));
    expect(outcome).toEqual({ kind: 'schemaInvalid', rawText: 'The plant looks a bit stressed.' });
  });

  it.each([
    [
      'unknown kind',
      '{"kind": "toxicity", "suggestedLabel": "x", "confidenceScore": 0.5, "requestedAdditionalEvidence": false, "careGuidanceSuggestion": "", "evidenceSummary": "", "alternativeExplanations": [], "safetyClass": "informational", "requestedViewPurposes": []}',
    ],
    [
      'confidence out of range',
      '{"kind": "pest", "suggestedLabel": "x", "confidenceScore": 2, "requestedAdditionalEvidence": false, "careGuidanceSuggestion": "", "evidenceSummary": "", "alternativeExplanations": [], "safetyClass": "informational", "requestedViewPurposes": []}',
    ],
    ['missing fields', '{"kind": "pest"}'],
    [
      'unexpected extra field',
      '{"kind": "pest", "suggestedLabel": "x", "confidenceScore": 0.5, "requestedAdditionalEvidence": false, "careGuidanceSuggestion": "", "evidenceSummary": "", "alternativeExplanations": [], "safetyClass": "informational", "requestedViewPurposes": [], "treatment": "spray"}',
    ],
    [
      'unrecognized safetyClass',
      '{"kind": "pest", "suggestedLabel": "x", "confidenceScore": 0.5, "requestedAdditionalEvidence": false, "careGuidanceSuggestion": "", "evidenceSummary": "", "alternativeExplanations": [], "safetyClass": "urgent", "requestedViewPurposes": []}',
    ],
    [
      'unrecognized requestedViewPurposes entry',
      '{"kind": "pest", "suggestedLabel": "x", "confidenceScore": 0.5, "requestedAdditionalEvidence": false, "careGuidanceSuggestion": "", "evidenceSummary": "", "alternativeExplanations": [], "safetyClass": "informational", "requestedViewPurposes": ["close_up"]}',
    ],
  ])('rejects a schema violation — %s — as schemaInvalid', (_name, body) => {
    const outcome = parseResponse(textResponse(body));
    expect(outcome).toEqual({ kind: 'schemaInvalid', rawText: body });
  });

  it('treats an empty response as schemaInvalid with no raw text', () => {
    expect(parseResponse(response({ candidates: [] }))).toEqual({
      kind: 'schemaInvalid',
      rawText: null,
    });
  });

  it('maps a SAFETY finish to safetyBlocked', () => {
    expect(
      parseResponse(response({ candidates: [{ finishReason: FinishReason.SAFETY }] })),
    ).toEqual({ kind: 'safetyBlocked' });
  });
});

describe('VertexAiPlantConditionAnalysisAdapter', () => {
  it('calls the client with the shaped parameters and returns the parsed outcome', async () => {
    const seen: GenerateContentParameters[] = [];
    const client: VertexGenerativeClient = {
      models: {
        generateContent: (params) => {
          seen.push(params);
          return Promise.resolve(
            textResponse(
              '{"kind": "disease", "suggestedLabel": "Leaf spot", "confidenceScore": 0.65,' +
                ' "requestedAdditionalEvidence": false, "careGuidanceSuggestion": "Remove affected leaves",' +
                ' "evidenceSummary": "Dark spots on leaves", "alternativeExplanations": [],' +
                ' "safetyClass": "expert_review_recommended", "requestedViewPurposes": []}',
            ),
          );
        },
      },
    };
    const adapter = new VertexAiPlantConditionAnalysisAdapter(client, CONFIGURATION);

    const outcome = await adapter.analyzeCondition(REQUEST, new AbortController().signal);

    expect(outcome).toEqual({
      kind: 'observation',
      observation: {
        kind: 'disease',
        suggestedLabel: 'Leaf spot',
        confidenceScore: 0.65,
        requestedAdditionalEvidence: false,
        careGuidanceSuggestion: 'Remove affected leaves',
        evidenceSummary: 'Dark spots on leaves',
        alternativeExplanations: [],
        safetyClass: 'expert_review_recommended',
        requestedViewPurposes: [],
      },
    });
    expect(seen[0]?.model).toBe('gemini-test-model');
    expect(adapter.identity).toEqual({
      model: 'gemini-test-model',
      promptTemplateVersion: VERTEX_PLANT_CONDITION_PROMPT_TEMPLATE_VERSION,
    });
  });

  it('refuses a blank model or non-positive token budget at construction', () => {
    const client: VertexGenerativeClient = {
      models: { generateContent: () => Promise.reject(new Error('never called')) },
    };
    expect(
      () => new VertexAiPlantConditionAnalysisAdapter(client, { model: ' ', maxOutputTokens: 256 }),
    ).toThrow(InternalError);
    expect(
      () =>
        new VertexAiPlantConditionAnalysisAdapter(client, {
          model: 'gemini-test',
          maxOutputTokens: 0,
        }),
    ).toThrow(InternalError);
  });
});
