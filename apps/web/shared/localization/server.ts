import { headers } from 'next/headers';

import { negotiateLocale, type Locale } from './locales';
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
  const requestHeaders = await headers();

  return negotiateLocale(requestHeaders.get('accept-language'));
}

export async function getRequestTranslator(): Promise<Translate> {
  return createTranslator(await getRequestLocale());
}
