import type { englishMessages } from './messages/en';

/**
 * Message identifier shared by every catalogue.
 *
 * Deriving the union from the English catalogue is what makes a missing or
 * misspelled translation a compile error rather than a string that silently
 * falls back at runtime.
 *
 * Source: architecture/web-application-design.md, section "15. Localization".
 */
export type MessageKey = keyof typeof englishMessages;

/** A complete set of messages for one locale. */
export type MessageCatalogue = Readonly<Record<MessageKey, string>>;
