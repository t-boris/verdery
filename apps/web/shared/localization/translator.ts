import type { MessageCatalogue, MessageKey } from './catalogue';
import type { Locale } from './locales';
import { englishMessages } from './messages/en';
import { russianMessages } from './messages/ru';

const CATALOGUES: Readonly<Record<Locale, MessageCatalogue>> = {
  en: englishMessages,
  ru: russianMessages,
};

/**
 * Values interpolated into a message.
 *
 * Numbers are formatted with the locale's `Intl` rules rather than with
 * `toString`, because decimal separators and grouping differ between the
 * supported languages.
 *
 * Source: architecture/web-application-design.md, section "15. Localization".
 */
export type MessageArguments = Readonly<Record<string, string | number>>;

export type Translate = (key: MessageKey, args?: MessageArguments) => string;

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

/**
 * Substitutes ICU simple arguments of the form `{name}`.
 *
 * The catalogue deliberately uses only this subset of ICU MessageFormat. Plural
 * and select categories arrive with the shared message package rather than with
 * a hand-written approximation, because Russian plural rules cannot be
 * approximated correctly.
 */
export function formatMessage(
  template: string,
  locale: Locale,
  args: MessageArguments | undefined,
): string {
  if (args === undefined) {
    return template;
  }

  return template.replace(PLACEHOLDER_PATTERN, (placeholder, name: string) => {
    const value = args[name];

    if (value === undefined) {
      return placeholder;
    }

    return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value;
  });
}

/** Returns the catalogue for a locale. */
export function getCatalogue(locale: Locale): MessageCatalogue {
  return CATALOGUES[locale];
}

/**
 * Creates a lookup function bound to one locale.
 *
 * It is a plain function rather than a hook so that server components, client
 * components, and the global error boundary — which renders outside every
 * provider — all use the same code path.
 */
export function createTranslator(locale: Locale): Translate {
  const catalogue = getCatalogue(locale);

  return (key, args) => formatMessage(catalogue[key], locale, args);
}
