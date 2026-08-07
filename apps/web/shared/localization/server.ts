import { cookies, headers } from 'next/headers';

import { isSupportedLocale, LOCALE_COOKIE_NAME, negotiateLocale, type Locale } from './locales';
import { createTranslator, type Translate } from './translator';

/**
 * Server-only locale resolution.
 *
 * This module is deliberately not re-exported from `public.ts`: it reads request
 * headers and must never be pulled into a client bundle.
 *
 * Source: architecture/web-application-design.md, section "20. Dependency Rules".
 */
export async function getRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const preferredLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (preferredLocale !== undefined && isSupportedLocale(preferredLocale)) {
    return preferredLocale;
  }
  const requestHeaders = await headers();

  return negotiateLocale(requestHeaders.get('accept-language'));
}

export async function getRequestTranslator(): Promise<Translate> {
  return createTranslator(await getRequestLocale());
}
