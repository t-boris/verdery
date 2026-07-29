import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { createTaxonomyName } from './taxonomy-name.js';

const ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const TAXONOMY_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const NOW = new Date('2026-07-29T12:00:00Z');

function baseInput() {
  return {
    id: ID,
    taxonomyReferenceId: TAXONOMY_ID,
    rawNameKind: 'common',
    locale: 'en-US',
    rawNameText: 'Common fig',
    rawSource: 'system_catalog',
    providerKey: null,
    now: NOW,
  };
}

describe('createTaxonomyName', () => {
  it('creates a well-formed locale-tagged common name', () => {
    const name = createTaxonomyName(baseInput());
    expect(name.nameText).toBe('Common fig');
  });

  it('creates a locale-less scientific synonym', () => {
    const name = createTaxonomyName({
      ...baseInput(),
      rawNameKind: 'synonym_scientific',
      locale: null,
      rawNameText: 'Ficus caprificus',
    });
    expect(name.locale).toBeNull();
  });

  it('rejects an unrecognized nameKind', () => {
    expect(() => createTaxonomyName({ ...baseInput(), rawNameKind: 'nickname' })).toThrow(
      ValidationError,
    );
  });

  it('rejects a common name with no locale', () => {
    expect(() => createTaxonomyName({ ...baseInput(), locale: null })).toThrow(ValidationError);
  });

  it('rejects a non-common name carrying a locale', () => {
    expect(() =>
      createTaxonomyName({ ...baseInput(), rawNameKind: 'synonym_scientific', locale: 'en-US' }),
    ).toThrow(ValidationError);
  });

  it('rejects a blank nameText', () => {
    expect(() => createTaxonomyName({ ...baseInput(), rawNameText: '   ' })).toThrow(
      ValidationError,
    );
  });

  it('rejects provider_sourced with no providerKey', () => {
    expect(() => createTaxonomyName({ ...baseInput(), rawSource: 'provider_sourced' })).toThrow(
      ValidationError,
    );
  });

  it('accepts provider_sourced with a providerKey', () => {
    const name = createTaxonomyName({
      ...baseInput(),
      rawSource: 'provider_sourced',
      providerKey: 'wikidata',
    });
    expect(name.providerKey).toBe('wikidata');
  });
});
