import { FinishReason, type GenerateContentResponse } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { walkTraverse } from '../../gardens-mapping/domain/survey-traverse.js';
import {
  buildPlatExtractionParameters,
  parsePlatExtractionResponse,
  VertexAiPlatExtractionAdapter,
} from './vertex-ai-plat-extraction-adapter.js';

const CONFIGURATION = { model: 'gemini-test', maxOutputTokens: 2_048 };

const PAGE = {
  bucketName: 'verdery-derived',
  objectKey: 'plans/plat-page-1.png',
  mimeType: 'image/png',
  byteSize: 2_000_000,
};

function responseWith(text: string): GenerateContentResponse {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason: FinishReason.STOP }],
  } as unknown as GenerateContentResponse;
}

/**
 * What the owner's own plat says, transcribed the way the instruction asks
 * for it — three straight lot lines and the road frontage's chord.
 */
const CASCADE_WAY = {
  notAPlat: false,
  address: '7612 CASCADE WAY, GURNEE, IL 60031',
  northRotationDegrees: 0,
  statedAreaSquareFeet: 10068,
  lotPageOutline: [
    [0.3, 0.7],
    [0.7, 0.6],
    [0.6, 0.3],
    [0.25, 0.4],
  ],
  pageObjects: [
    {
      category: 'structure',
      label: '2 STORY FRAME #7612',
      pageOutline: [
        [0.42, 0.55],
        [0.52, 0.53],
        [0.5, 0.45],
        [0.4, 0.47],
      ],
      confidence: 0.82,
    },
  ],
  boundaryCalls: [
    {
      bearing: { reference: 'north', degrees: 46, minutes: 54, seconds: 11, turn: 'east' },
      distanceFeet: 135.06,
      sourceLabel: 'MEASURED = 135.06',
    },
    {
      bearing: { reference: 'south', degrees: 44, minutes: 55, seconds: 39, turn: 'east' },
      distanceFeet: 70.02,
      sourceLabel: 'MEASURED = 70.02',
    },
    {
      bearing: { reference: 'south', degrees: 43, minutes: 12, seconds: 31, turn: 'west' },
      distanceFeet: 135.1,
      sourceLabel: 'MEASURED = 135.10',
    },
    {
      bearing: { reference: 'north', degrees: 45, minutes: 55, seconds: 0, turn: 'west' },
      distanceFeet: 78.66,
      sourceLabel: 'CHORD = 78.66',
    },
  ],
};

describe('buildPlatExtractionParameters', () => {
  it('sends the page by reference, never its bytes', () => {
    const parameters = buildPlatExtractionParameters(
      { page: PAGE },
      CONFIGURATION,
      new AbortController().signal,
    );

    const part = parameters.contents as { parts: { fileData?: { fileUri: string } }[] }[];
    expect(part[0]?.parts[0]?.fileData?.fileUri).toBe('gs://verdery-derived/plans/plat-page-1.png');
    expect(JSON.stringify(parameters)).not.toContain('inlineData');
  });

  /*
   * Transcription must repeat. A closure error computed from one reading and
   * compared against another only means something if the same page yields
   * the same numbers.
   */
  it('asks for a deterministic reading, not a creative one', () => {
    const parameters = buildPlatExtractionParameters(
      { page: PAGE },
      CONFIGURATION,
      new AbortController().signal,
    );

    expect(parameters.config?.temperature).toBe(0);
    expect(parameters.config?.responseMimeType).toBe('application/json');
  });

  it('forbids the model the geometry, in the instruction itself', () => {
    const parameters = buildPlatExtractionParameters(
      { page: PAGE },
      CONFIGURATION,
      new AbortController().signal,
    );

    const instruction = JSON.stringify(parameters.config?.systemInstruction);
    expect(instruction).toContain('compute, close, or correct the polygon');
    expect(instruction).toContain('convert any unit');
  });
});

describe('parsePlatExtractionResponse', () => {
  it('reads a real plat into calls a traverse can walk', () => {
    const outcome = parsePlatExtractionResponse(responseWith(JSON.stringify(CASCADE_WAY)));

    expect(outcome.kind).toBe('extracted');
    if (outcome.kind !== 'extracted') return;

    expect(outcome.plat.address).toBe('7612 CASCADE WAY, GURNEE, IL 60031');
    expect(outcome.plat.statedAreaSquareFeet).toBe(10068);
    expect(outcome.plat.boundaryCalls).toHaveLength(4);
    // The drawing's own objects come back outlined on the page — never in
    // metres, which is the survey's job.
    expect(outcome.plat.pageObjects).toHaveLength(1);
    expect(outcome.plat.pageObjects[0]?.category).toBe('structure');
    expect(outcome.plat.lotPageOutline).toHaveLength(4);

    // The whole point of transcribing rather than concluding: these calls go
    // straight into the traverse, and the walk closes.
    const traverse = walkTraverse(outcome.plat.boundaryCalls);
    expect(traverse?.closes).toBe(true);
  });

  it('translates the no-value sentinels out of the port’s vocabulary', () => {
    const outcome = parsePlatExtractionResponse(
      responseWith(
        JSON.stringify({
          ...CASCADE_WAY,
          address: '   ',
          northRotationDegrees: -1,
          statedAreaSquareFeet: -1,
        }),
      ),
    );

    expect(outcome.kind).toBe('extracted');
    if (outcome.kind !== 'extracted') return;
    expect(outcome.plat.address).toBeNull();
    expect(outcome.plat.northRotationDegrees).toBeNull();
    expect(outcome.plat.statedAreaSquareFeet).toBeNull();
  });

  it('says so when the page is not a plat at all', () => {
    const outcome = parsePlatExtractionResponse(
      responseWith(JSON.stringify({ ...CASCADE_WAY, notAPlat: true })),
    );

    expect(outcome.kind).toBe('notAPlat');
  });

  // Never trusted, however constrained: a bearing outside the quadrant
  // notation is a misreading, and a misreading is not a survey.
  it('refuses a bearing that cannot exist', () => {
    const outcome = parsePlatExtractionResponse(
      responseWith(
        JSON.stringify({
          ...CASCADE_WAY,
          boundaryCalls: [
            {
              bearing: { reference: 'north', degrees: 200, minutes: 0, seconds: 0, turn: 'east' },
              distanceFeet: 100,
              sourceLabel: 'x',
            },
          ],
        }),
      ),
    );

    expect(outcome.kind).toBe('schemaInvalid');
  });

  it('refuses text that is not JSON, and reports what came back', () => {
    const outcome = parsePlatExtractionResponse(responseWith('Here is the plat you asked for:'));

    expect(outcome).toEqual({
      kind: 'schemaInvalid',
      rawText: 'Here is the plat you asked for:',
    });
  });

  it('reports a safety block rather than an empty reading', () => {
    const blocked = {
      promptFeedback: { blockReason: 'SAFETY' },
    } as unknown as GenerateContentResponse;

    expect(parsePlatExtractionResponse(blocked)).toEqual({ kind: 'safetyBlocked' });
  });
});

describe('VertexAiPlatExtractionAdapter', () => {
  it('refuses a blank model rather than failing at call time', () => {
    expect(
      () =>
        new VertexAiPlatExtractionAdapter(
          { models: { generateContent: () => Promise.reject(new Error('never called')) } },
          {
            model: '  ',
            maxOutputTokens: 10,
          },
        ),
    ).toThrow();
  });
});
