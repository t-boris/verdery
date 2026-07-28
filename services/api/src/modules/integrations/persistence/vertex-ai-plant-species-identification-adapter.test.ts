/**
 * Unit tests for the Vertex AI plant-species-identification adapter —
 * request shaping and response validation against CONSTRUCTED SDK response
 * shapes (real `GenerateContentResponse` instances), no live Vertex
 * anywhere. Mirrors `vertex-ai-explanation-adapter.test.ts`'s own structure.
 */

import {
  BlockedReason,
  FinishReason,
  GenerateContentResponse,
  HarmBlockThreshold,
  Type,
} from '@google/genai';
import type { GenerateContentParameters } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { InternalError } from '../../../platform/errors/application-error.js';
import type { PlantSpeciesIdentificationRequest } from '../application/plant-species-identification-provider.js';
import {
  buildGenerateContentParameters,
  parseResponse,
  VERTEX_PLANT_SPECIES_PROMPT_TEMPLATE_VERSION,
  VertexAiPlantSpeciesIdentificationAdapter,
} from './vertex-ai-plant-species-identification-adapter.js';
import type { VertexGenerativeClient } from './vertex-ai-plant-species-identification-adapter.js';

const REQUEST: PlantSpeciesIdentificationRequest = {
  photo: {
    bucketName: 'verdery-user-media',
    objectKey: 'gardens/garden-1/plants/photo-1.jpg',
    mimeType: 'image/jpeg',
  },
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
        'noConfidentCandidate',
        'commonName',
        'scientificNameGuess',
        'confidenceScore',
        'varietyGuess',
        'lifecycleStageConfident',
        'lifecycleStageGuess',
      ],
    });
  });

  it('sets every text harm category to BLOCK_MEDIUM_AND_ABOVE — explicit safety settings, not provider defaults', () => {
    const settings = parameters.config?.safetySettings ?? [];
    expect(settings).toHaveLength(4);
    expect(new Set(settings.map((setting) => setting.threshold))).toEqual(
      new Set([HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE]),
    );
  });

  it('sends the photo as a fileData reference, never as inline bytes', () => {
    const content = (parameters.contents as { parts: { fileData?: unknown }[] }[])[0];
    const part = content?.parts[0];
    expect(part?.fileData).toEqual({
      fileUri: 'gs://verdery-user-media/gardens/garden-1/plants/photo-1.jpg',
      mimeType: 'image/jpeg',
    });
  });

  it('instructs the versioned bounds: identify-only, no-guess-if-unsure, never toxicity/edibility, JSON-only', () => {
    expect(typeof parameters.config?.systemInstruction).toBe('string');
    const instruction = parameters.config?.systemInstruction as string;
    expect(instruction).toContain('do not guess');
    expect(instruction).toContain('Never state or imply whether the plant is edible, toxic');
    expect(instruction).toContain('Respond with JSON only');
    expect(instruction).toContain('varietyGuess');
    expect(instruction).toContain('lifecycleStageGuess');
    expect(VERTEX_PLANT_SPECIES_PROMPT_TEMPLATE_VERSION).toBe(2);
  });
});

describe('parseResponse', () => {
  it('parses a confident candidate, trimming names, with variety and a confident growth stage', () => {
    const outcome = parseResponse(
      textResponse(
        '{"noConfidentCandidate": false, "commonName": " Tomato ", "scientificNameGuess": " Solanum lycopersicum ", "confidenceScore": 0.9,' +
          ' "varietyGuess": " Cherry Tomato ", "lifecycleStageConfident": true, "lifecycleStageGuess": "flowering"}',
      ),
    );
    expect(outcome).toEqual({
      kind: 'candidate',
      candidate: {
        commonName: 'Tomato',
        scientificNameGuess: 'Solanum lycopersicum',
        confidenceScore: 0.9,
        varietyGuess: 'Cherry Tomato',
        lifecycleStageGuess: 'flowering',
      },
    });
  });

  it('treats an explicit noConfidentCandidate as the honest non-guess outcome', () => {
    const outcome = parseResponse(
      textResponse(
        '{"noConfidentCandidate": true, "commonName": "", "scientificNameGuess": "", "confidenceScore": 0,' +
          ' "varietyGuess": "", "lifecycleStageConfident": false, "lifecycleStageGuess": "seed"}',
      ),
    );
    expect(outcome).toEqual({ kind: 'noConfidentCandidate' });
  });

  it('treats a blank scientificNameGuess/varietyGuess as null, not an empty string', () => {
    const outcome = parseResponse(
      textResponse(
        '{"noConfidentCandidate": false, "commonName": "Basil", "scientificNameGuess": "", "confidenceScore": 0.6,' +
          ' "varietyGuess": "", "lifecycleStageConfident": false, "lifecycleStageGuess": "seed"}',
      ),
    );
    expect(outcome).toEqual({
      kind: 'candidate',
      candidate: {
        commonName: 'Basil',
        scientificNameGuess: null,
        confidenceScore: 0.6,
        varietyGuess: null,
        lifecycleStageGuess: null,
      },
    });
  });

  it('treats lifecycleStageConfident false as null, regardless of what lifecycleStageGuess says', () => {
    const outcome = parseResponse(
      textResponse(
        '{"noConfidentCandidate": false, "commonName": "Basil", "scientificNameGuess": "", "confidenceScore": 0.7,' +
          ' "varietyGuess": "", "lifecycleStageConfident": false, "lifecycleStageGuess": "flowering"}',
      ),
    );
    expect(outcome).toMatchObject({ candidate: { lifecycleStageGuess: null } });
  });

  it('rejects non-JSON text as schemaInvalid, keeping the raw text for the record', () => {
    const outcome = parseResponse(textResponse('Looks like a tomato plant!'));
    expect(outcome).toEqual({ kind: 'schemaInvalid', rawText: 'Looks like a tomato plant!' });
  });

  it.each([
    ['missing fields', '{"commonName": "Tomato"}'],
    [
      'confidence out of range',
      '{"noConfidentCandidate": false, "commonName": "Tomato", "scientificNameGuess": "", "confidenceScore": 1.5,' +
        ' "varietyGuess": "", "lifecycleStageConfident": false, "lifecycleStageGuess": "seed"}',
    ],
    [
      'unexpected extra field',
      '{"noConfidentCandidate": false, "commonName": "Tomato", "scientificNameGuess": "", "confidenceScore": 0.5,' +
        ' "varietyGuess": "", "lifecycleStageConfident": false, "lifecycleStageGuess": "seed", "isEdible": true}',
    ],
    [
      'invalid lifecycleStageGuess enum value',
      '{"noConfidentCandidate": false, "commonName": "Tomato", "scientificNameGuess": "", "confidenceScore": 0.5,' +
        ' "varietyGuess": "", "lifecycleStageConfident": false, "lifecycleStageGuess": "planned"}',
    ],
    ['wrong root type', '["Tomato"]'],
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

  it('maps a prompt-level block and a SAFETY/PROHIBITED_CONTENT finish to safetyBlocked', () => {
    expect(
      parseResponse(response({ promptFeedback: { blockReason: BlockedReason.SAFETY } })),
    ).toEqual({ kind: 'safetyBlocked' });
    expect(
      parseResponse(response({ candidates: [{ finishReason: FinishReason.SAFETY }] })),
    ).toEqual({ kind: 'safetyBlocked' });
  });
});

describe('VertexAiPlantSpeciesIdentificationAdapter', () => {
  it('calls the client with the shaped parameters and returns the parsed outcome', async () => {
    const seen: GenerateContentParameters[] = [];
    const client: VertexGenerativeClient = {
      models: {
        generateContent: (params) => {
          seen.push(params);
          return Promise.resolve(
            textResponse(
              '{"noConfidentCandidate": false, "commonName": "Tomato", "scientificNameGuess": "Solanum lycopersicum", "confidenceScore": 0.9,' +
                ' "varietyGuess": "", "lifecycleStageConfident": false, "lifecycleStageGuess": "seed"}',
            ),
          );
        },
      },
    };
    const adapter = new VertexAiPlantSpeciesIdentificationAdapter(client, CONFIGURATION);

    const outcome = await adapter.identifySpecies(REQUEST, new AbortController().signal);

    expect(outcome).toEqual({
      kind: 'candidate',
      candidate: {
        commonName: 'Tomato',
        scientificNameGuess: 'Solanum lycopersicum',
        confidenceScore: 0.9,
        varietyGuess: null,
        lifecycleStageGuess: null,
      },
    });
    expect(seen[0]?.model).toBe('gemini-test-model');
    expect(adapter.identity).toEqual({
      model: 'gemini-test-model',
      promptTemplateVersion: VERTEX_PLANT_SPECIES_PROMPT_TEMPLATE_VERSION,
    });
  });

  it('refuses a blank model or non-positive token budget at construction', () => {
    const client: VertexGenerativeClient = {
      models: { generateContent: () => Promise.reject(new Error('never called')) },
    };
    expect(
      () =>
        new VertexAiPlantSpeciesIdentificationAdapter(client, { model: ' ', maxOutputTokens: 256 }),
    ).toThrow(InternalError);
    expect(
      () =>
        new VertexAiPlantSpeciesIdentificationAdapter(client, {
          model: 'gemini-test',
          maxOutputTokens: 0,
        }),
    ).toThrow(InternalError);
  });
});
