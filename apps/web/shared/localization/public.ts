/**
 * Public surface of the localization module.
 *
 * Features import this module rather than reaching into catalogue files, so a
 * change to how messages are stored does not ripple through the application.
 *
 * Source: architecture/web-application-design.md, section "20. Dependency Rules".
 */
export type { MessageCatalogue, MessageKey } from './catalogue';
export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  negotiateLocale,
  type Locale,
} from './locales';
export { createTranslator, getCatalogue, formatMessage, type Translate } from './translator';
export { LocalizationProvider, useLocalization, type Localization } from './localization-provider';
