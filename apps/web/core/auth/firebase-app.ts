/**
 * Firebase client SDK bootstrap.
 *
 * Every value here is a public per-project identifier, not a secret: Firebase
 * documents the web `apiKey` as safe to ship in a client bundle, protected by
 * Firebase Security Rules and App Check rather than by keeping it hidden.
 * `NEXT_PUBLIC_` is therefore the correct prefix, matching
 * architecture/web-application-design.md, section "16. Security"
 * ("Secrets never use `NEXT_PUBLIC_` variables" — these are not secrets).
 *
 * Source: architecture/identity-and-authorization.md, section
 * "2. Identity Authority".
 */

import { type FirebaseApp, type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import { type Auth, connectAuthEmulator, getAuth } from 'firebase/auth';

/**
 * Fails loudly and specifically, rather than letting the Firebase SDK reject a
 * `undefined` value with a generic error. Exported for reuse by sibling
 * modules in this directory that read their own `NEXT_PUBLIC_` values, such
 * as `app-check.ts`.
 */
export function requireEnv(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function firebaseConfig(): FirebaseOptions {
  return {
    apiKey: requireEnv('NEXT_PUBLIC_FIREBASE_API_KEY', process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: requireEnv(
      'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    ),
    projectId: requireEnv(
      'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    ),
    storageBucket: requireEnv(
      'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    ),
    messagingSenderId: requireEnv(
      'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    ),
    appId: requireEnv('NEXT_PUBLIC_FIREBASE_APP_ID', process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  };
}

let cachedApp: FirebaseApp | undefined;

/** Returns the singleton Firebase app, creating it on first use. Never called during server rendering. */
export function getFirebaseApp(): FirebaseApp {
  if (cachedApp !== undefined) {
    return cachedApp;
  }

  cachedApp = getApps()[0] ?? initializeApp(firebaseConfig());
  return cachedApp;
}

let cachedAuth: Auth | undefined;

/**
 * Returns the singleton Firebase Auth instance, pointing it at the local Auth
 * emulator exactly once, on first use, when `NEXT_PUBLIC_USE_FIREBASE_EMULATOR`
 * is set.
 *
 * This flag exists solely for the Playwright E2E harness (`apps/web/e2e`):
 * Google/Apple's real OAuth popups cannot be scripted in CI, but the Auth
 * emulator's REST API and fake-IDP page can. It must never be set in a
 * deployed environment — see `apps/web/e2e/run-e2e.sh`, which is the only
 * place that sets it, and `firebase.json` at the repository root for the
 * emulator this connects to.
 *
 * `connectAuthEmulator` must run before any other Auth call on this instance
 * or it has no effect; gating it here, behind the same cache that guards
 * `getAuth` itself, is what guarantees that ordering regardless of which
 * caller reaches `getFirebaseAuth()` first.
 *
 * Source: architecture/testing-strategy.md, section 9 ("Playwright for
 * browser end-to-end behavior").
 */
export function getFirebaseAuth(): Auth {
  if (cachedAuth !== undefined) {
    return cachedAuth;
  }

  cachedAuth = getAuth(getFirebaseApp());

  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
    connectAuthEmulator(cachedAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }

  return cachedAuth;
}
