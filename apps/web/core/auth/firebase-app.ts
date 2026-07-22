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

/** Fails loudly and specifically, rather than letting the Firebase SDK reject a `undefined` value with a generic error. */
function requireEnv(name: string, value: string | undefined): string {
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
