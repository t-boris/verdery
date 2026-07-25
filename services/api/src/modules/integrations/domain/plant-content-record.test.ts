import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { CreatePlantContentRecordInput } from './plant-content-record.js';
import { createPlantContentRecord } from './plant-content-record.js';

const RECORD_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e01';
const FETCHED_AT = new Date('2026-07-25T12:00:00Z');

function validInput(
  overrides: Partial<CreatePlantContentRecordInput> = {},
): CreatePlantContentRecordInput {
  return {
    id: RECORD_ID,
    rawProviderKey: 'fake-plant-provider-a',
    rawProviderTaxonId: 'taxon-1001',
    source: {
      providerRecordId: 'content-2001',
      providerContentVersion: 'v1',
      contentLanguage: 'en',
    },
    sections: {
      description: 'A warm-season fruiting vegetable.',
      careGuidance: 'Water regularly; avoid wetting foliage.',
    },
    fetchedAt: FETCHED_AT,
    rawLicenseNote: 'test license: internal use only',
    attributionText: 'Plant content by fake-plant-provider-a',
    jurisdiction: 'EU',
    rawPresentationNote: 'verbatim with attribution',
    now: FETCHED_AT,
    ...overrides,
  };
}

describe('createPlantContentRecord', () => {
  it('builds a normalized record, trimming free-text fields', () => {
    const record = createPlantContentRecord(
      validInput({
        rawProviderKey: '  fake-plant-provider-a  ',
        rawLicenseNote: '  some license  ',
        rawPresentationNote: '  summaries allowed  ',
        jurisdiction: '  EU  ',
      }),
    );

    expect(record.providerKey).toBe('fake-plant-provider-a');
    expect(record.providerTaxonId).toBe('taxon-1001');
    expect(record.licenseNote).toBe('some license');
    expect(record.presentationNote).toBe('summaries allowed');
    expect(record.jurisdiction).toBe('EU');
    expect(record.source.providerContentVersion).toBe('v1');
    expect(record.sections.careGuidance).toBe('Water regularly; avoid wetting foliage.');
    expect(record.createdAt).toBe(FETCHED_AT);
  });

  it('accepts a single-section payload and null optional source facts: missing facts remain missing', () => {
    const record = createPlantContentRecord(
      validInput({
        source: { providerRecordId: null, providerContentVersion: null, contentLanguage: 'ru' },
        sections: { description: null, careGuidance: 'Prune after flowering.' },
        attributionText: null,
        jurisdiction: null,
      }),
    );

    expect(record.source).toEqual({
      providerRecordId: null,
      providerContentVersion: null,
      contentLanguage: 'ru',
    });
    expect(record.sections).toEqual({ description: null, careGuidance: 'Prune after flowering.' });
    expect(record.attributionText).toBeNull();
    expect(record.jurisdiction).toBeNull();
  });

  it('rejects blank provider identity', () => {
    expect(() => createPlantContentRecord(validInput({ rawProviderKey: '  ' }))).toThrow(
      ValidationError,
    );
    expect(() => createPlantContentRecord(validInput({ rawProviderTaxonId: '' }))).toThrow(
      ValidationError,
    );
  });

  it('rejects blank source facts: a present field must say something, and the language is required', () => {
    expect(() =>
      createPlantContentRecord(
        validInput({
          source: { providerRecordId: ' ', providerContentVersion: 'v1', contentLanguage: 'en' },
        }),
      ),
    ).toThrow(ValidationError);
    expect(() =>
      createPlantContentRecord(
        validInput({
          source: { providerRecordId: null, providerContentVersion: '', contentLanguage: 'en' },
        }),
      ),
    ).toThrow(ValidationError);
    expect(() =>
      createPlantContentRecord(
        validInput({
          source: { providerRecordId: null, providerContentVersion: null, contentLanguage: '  ' },
        }),
      ),
    ).toThrow(ValidationError);
  });

  it('rejects a record with no content section: a row with neither section records nothing', () => {
    expect(() =>
      createPlantContentRecord(validInput({ sections: { description: null, careGuidance: null } })),
    ).toThrow(ValidationError);
  });

  it('rejects blank-when-present sections', () => {
    expect(() =>
      createPlantContentRecord(
        validInput({ sections: { description: '  ', careGuidance: 'fine' } }),
      ),
    ).toThrow(ValidationError);
    expect(() =>
      createPlantContentRecord(validInput({ sections: { description: 'fine', careGuidance: '' } })),
    ).toThrow(ValidationError);
  });

  it('rejects blank license and presentation metadata — the snapshot is mandatory', () => {
    expect(() => createPlantContentRecord(validInput({ rawLicenseNote: ' ' }))).toThrow(
      ValidationError,
    );
    expect(() => createPlantContentRecord(validInput({ rawPresentationNote: '' }))).toThrow(
      ValidationError,
    );
    expect(() => createPlantContentRecord(validInput({ attributionText: '  ' }))).toThrow(
      ValidationError,
    );
    expect(() => createPlantContentRecord(validInput({ jurisdiction: '' }))).toThrow(
      ValidationError,
    );
  });
});
