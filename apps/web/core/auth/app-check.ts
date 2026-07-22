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
 * Resolves the current App Check token. Rejects on failure rather than
 * swallowing it: this is a thin wrapper over the Firebase SDK, and the
 * caller that attaches the result to a request (`core/api/client.ts`) is the
 * one place responsible for treating that rejection as the soft,
 * monitor-only signal it is.
 */
export function getAppCheckToken(): Promise<string> {
  return getFirebaseAppCheckToken(getAppCheck()).then((result) => result.token);
}
