/**
 * Supported interface locales.
 *
 * English and Russian ship together from the first production release, so the
 * locale set is a closed union rather than an open string: adding a language is
 * a deliberate change that the type system propagates to every catalogue.
 *
 * Source: architecture/web-application-design.md, section "15. Localization".
 */
export const SUPPORTED_LOCALES = ['en', 'ru'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Locale used when the request expresses no usable preference. */
export const DEFAULT_LOCALE: Locale = 'en';

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

interface LanguageRange {
  readonly tag: string;
  readonly quality: number;
}

/** Parses one `Accept-Language` entry, returning `null` when it is unusable. */
function parseLanguageRange(entry: string): LanguageRange | null {
  const [rawTag, ...parameters] = entry.trim().split(';');

  if (rawTag === undefined || rawTag === '') {
    return null;
  }

  const qualityParameter = parameters
    .map((parameter) => parameter.trim())
    .find((parameter) => parameter.startsWith('q='));

  const quality = qualityParameter === undefined ? 1 : Number.parseFloat(qualityParameter.slice(2));

  if (Number.isNaN(quality) || quality <= 0) {
    return null;
  }

  return { tag: rawTag.trim().toLowerCase(), quality };
}

/**
 * Chooses an interface locale from an `Accept-Language` header value.
 *
 * Region subtags are ignored because the catalogue is keyed by language only;
 * region-sensitive presentation is handled by `Intl` formatting rather than by
 * separate message files.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (acceptLanguage === null || acceptLanguage === undefined || acceptLanguage.trim() === '') {
    return DEFAULT_LOCALE;
  }

  const ranked = acceptLanguage
    .split(',')
    .map(parseLanguageRange)
    .filter((range): range is LanguageRange => range !== null)
    .sort((left, right) => right.quality - left.quality);

  for (const range of ranked) {
    if (range.tag === '*') {
      return DEFAULT_LOCALE;
    }

    const language = range.tag.split('-')[0];

    if (language !== undefined && isSupportedLocale(language)) {
      return language;
    }
  }

  return DEFAULT_LOCALE;
}
