/**
 * Firebase App Check bootstrap (ReCaptchaEnterpriseProvider).
 *
 * This is rollout stage 1-2 only: token generation plus backend monitoring.
 * Nothing here enforces on App Check status, and nothing downstream may
 * start doing so without a deliberate, separate change — App Check failure
 * must never reveal whether a garden or account exists.
 *
 * The reCAPTCHA site key is a public per-site identifier, not a secret — the
 * same reasoning `firebase-app.ts` documents for the Firebase `apiKey` — see
 * `apps/web/.env.example`.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "12. App Check".
 */

import {
  getToken as getFirebaseAppCheckToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';

import { getFirebaseApp, requireEnv } from './firebase-app';
import { resolveWithinBudget } from './token-budget';

/**
 * How long a request may wait for an App Check token before proceeding
 * without one.
 *
 * A number chosen against what the token costs, not what it is worth: the
 * Firebase SDK caches and refreshes tokens in the background, so only the
 * first request of a session waits at all, and a request that ships without
 * the header costs a monitoring signal while App Check is monitor-only. An
 * unbounded wait, by contrast, cost the entire application — reCAPTCHA
 * Enterprise's `execute` can hang indefinitely (its own frame is loaded with
 * `execute-ms=30000`), and on 2026-08-04 every authenticated screen of the
 * deployed web client sat on a loading state forever because of it, having
 * never issued a single request.
 */
export const APP_CHECK_TOKEN_BUDGET_MS = 2_000;

let cachedAppCheck: AppCheck | undefined;

/** Returns the singleton App Check instance, creating it on first use. Never called during server rendering. */
export function getAppCheck(): AppCheck {
  if (cachedAppCheck !== undefined) {
    return cachedAppCheck;
  }

  const siteKey = requireEnv(
    'NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY',
    process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY,
  );

  cachedAppCheck = initializeAppCheck(getFirebaseApp(), {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return cachedAppCheck;
}

/**
 * Resolves the current App Check token, or `null` when the provider fails or
 * does not answer within `APP_CHECK_TOKEN_BUDGET_MS`.
 *
 * The budget belongs here, in the adapter that owns the provider, rather
 * than in `core/api/client.ts`: the transport knows only that some caller
 * may supply an optional header, and cannot know what a reasonable wait for
 * reCAPTCHA Enterprise is. `null` and a rejection mean the same thing to the
 * transport — send the request without the header — so this returns the one
 * shape it acts on.
 */
export function getAppCheckToken(): Promise<string | null> {
  return resolveWithinBudget(
    () => getFirebaseAppCheckToken(getAppCheck()).then((result) => result.token),
    APP_CHECK_TOKEN_BUDGET_MS,
  );
}
