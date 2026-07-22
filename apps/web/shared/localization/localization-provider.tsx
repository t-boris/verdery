'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { DEFAULT_LOCALE, type Locale } from './locales';
import { createTranslator, type Translate } from './translator';

export interface Localization {
  readonly locale: Locale;
  readonly t: Translate;
}

const LocalizationContext = createContext<Localization>({
  locale: DEFAULT_LOCALE,
  t: createTranslator(DEFAULT_LOCALE),
});

export interface LocalizationProviderProps {
  readonly locale: Locale;
  readonly children: ReactNode;
}

/**
 * Publishes the negotiated locale to client components.
 *
 * The locale is resolved on the server and passed down, so the first paint is
 * already in the user's language and no string flips after hydration.
 */
export function LocalizationProvider({ locale, children }: LocalizationProviderProps) {
  const value = useMemo<Localization>(() => ({ locale, t: createTranslator(locale) }), [locale]);

  return <LocalizationContext value={value}>{children}</LocalizationContext>;
}

export function useLocalization(): Localization {
  return useContext(LocalizationContext);
}
