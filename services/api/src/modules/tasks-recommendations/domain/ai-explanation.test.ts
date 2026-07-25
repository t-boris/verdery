import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { createAiExplanationRecord } from './ai-explanation.js';
import type { CreateAiExplanationRecordInput } from './ai-explanation.js';

const NOW = new Date('2026-07-25T12:00:00Z');

function input(
  overrides: Partial<CreateAiExplanationRecordInput> = {},
): CreateAiExplanationRecordInput {
  return {
    id: '019a4000-0000-7000-8000-000000000001',
    candidateId: '019a4000-0000-7000-8000-000000000002',
    locale: 'en',
    providerKey: 'vertex-ai-explanation',
    model: 'gemini-test',
    promptTemplateVersion: 1,
    packetFactKeys: ['weather.dry_spell_observation'],
    generatedText: 'A friendlier phrasing of the stored reason.',
    validationOutcome: 'accepted',
    now: NOW,
    ...overrides,
  };
}

describe('createAiExplanationRecord', () => {
  it('constructs a record, trimming text and provenance', () => {
    const record = createAiExplanationRecord(
      input({ providerKey: ' vertex-ai-explanation ', generatedText: ' text ' }),
    );
    expect(record).toMatchObject({
      providerKey: 'vertex-ai-explanation',
      generatedText: 'text',
      validationOutcome: 'accepted',
      createdAt: NOW,
    });
  });

  it('permits a rejected record with its draft kept, and a text-less provider verdict', () => {
    expect(
      createAiExplanationRecord(
        input({ validationOutcome: 'unsupported_action', generatedText: 'rejected draft' }),
      ).generatedText,
    ).toBe('rejected draft');
    expect(
      createAiExplanationRecord(
        input({ validationOutcome: 'provider_safety_blocked', generatedText: null }),
      ).generatedText,
    ).toBeNull();
  });

  it('refuses accepted-without-text — an accepted record must carry what it accepts', () => {
    expect(() =>
      createAiExplanationRecord(input({ validationOutcome: 'accepted', generatedText: null })),
    ).toThrow(ValidationError);
    expect(() =>
      createAiExplanationRecord(input({ validationOutcome: 'accepted', generatedText: '  ' })),
    ).toThrow(ValidationError);
  });

  it('refuses blank provenance, a non-positive prompt version, and an empty or blank-keyed packet', () => {
    expect(() => createAiExplanationRecord(input({ providerKey: ' ' }))).toThrow(ValidationError);
    expect(() => createAiExplanationRecord(input({ model: '' }))).toThrow(ValidationError);
    expect(() => createAiExplanationRecord(input({ promptTemplateVersion: 0 }))).toThrow(
      ValidationError,
    );
    expect(() => createAiExplanationRecord(input({ packetFactKeys: [] }))).toThrow(ValidationError);
    expect(() => createAiExplanationRecord(input({ packetFactKeys: ['a', ' '] }))).toThrow(
      ValidationError,
    );
  });
});
