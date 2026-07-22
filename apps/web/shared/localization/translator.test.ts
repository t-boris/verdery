import { describe, expect, it } from 'vitest';

import { SUPPORTED_LOCALES, negotiateLocale } from './locales';
import { englishMessages } from './messages/en';
import { createTranslator, formatMessage, getCatalogue } from './translator';

describe('message catalogues', () => {
  it('define exactly the same identifiers in every supported locale', () => {
    const referenceKeys = Object.keys(englishMessages).sort();

    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(getCatalogue(locale)).sort(), locale).toEqual(referenceKeys);
    }
  });

  it('translates a key into each supported locale', () => {
    expect(createTranslator('en')('notFound.title')).toBe('Page not found');
    expect(createTranslator('ru')('notFound.title')).toBe('Страница не найдена');
  });
});

describe('formatMessage', () => {
  it('substitutes named arguments', () => {
    expect(formatMessage('Version {version}', 'en', { version: '1.2.3' })).toBe('Version 1.2.3');
  });

  it('leaves a placeholder untouched when its argument is missing', () => {
    expect(formatMessage('Version {version}', 'en', {})).toBe('Version {version}');
  });

  it('formats numbers with the rules of the target locale', () => {
    // Intl separates Russian thousands with a non-breaking space, which is not
    // the point of this assertion.
    const normalizeSpaces = (value: string) => value.replace(/\s/gu, ' ');

    expect(formatMessage('{count}', 'en', { count: 1234.5 })).toBe('1,234.5');
    expect(normalizeSpaces(formatMessage('{count}', 'ru', { count: 1234.5 }))).toBe('1 234,5');
  });
});

describe('negotiateLocale', () => {
  it('falls back to English when no preference is expressed', () => {
    expect(negotiateLocale(null)).toBe('en');
    expect(negotiateLocale('')).toBe('en');
  });

  it('selects the highest-quality supported language', () => {
    expect(negotiateLocale('ru-RU,ru;q=0.9,en-US;q=0.8')).toBe('ru');
    expect(negotiateLocale('de;q=0.9,ru;q=0.4,en;q=0.7')).toBe('en');
  });

  it('ignores unsupported and unacceptable languages', () => {
    expect(negotiateLocale('de-DE,fr;q=0.9')).toBe('en');
    expect(negotiateLocale('ru;q=0,de')).toBe('en');
  });
});
