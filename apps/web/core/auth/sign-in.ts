/**
 * Client-side Firebase sign-in.
 *
 * Every function returns the freshly obtained ID token; nothing here talks to
 * the Verdery API directly. Exchanging that token for a session is a
 * transport concern owned by `core/api/session-gateway.ts`, kept separate so
 * this module has no HTTP client dependency.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "3. Initial Sign-In Methods".
 */

import {
  GoogleAuthProvider,
  OAuthProvider,
  isSignInWithEmailLink as firebaseIsSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
} from 'firebase/auth';

import { getFirebaseAuth as auth } from './firebase-app';

/** Where the pending email-link sign-in's address is held between "send" and "complete", possibly in a different tab. */
const EMAIL_FOR_SIGN_IN_STORAGE_KEY = 'verdery.emailForSignIn';

export async function signInWithGoogle(): Promise<string> {
  const credential = await signInWithPopup(auth(), new GoogleAuthProvider());
  return credential.user.getIdToken();
}

/**
 * Apple requires the `email` and `name` scopes to be requested explicitly,
 * and returns them only on a user's very first authorization for this
 * Services ID — Firebase still carries the verified email on every
 * subsequent sign-in via the ID token itself, which is all this application
 * reads.
 */
export async function signInWithApple(): Promise<string> {
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  const credential = await signInWithPopup(auth(), provider);
  return credential.user.getIdToken();
}

function emailLinkCallbackUrl(): string {
  return `${globalThis.location.origin}/auth/email-link`;
}

export async function sendEmailSignInLink(email: string): Promise<void> {
  await sendSignInLinkToEmail(auth(), email, {
    url: emailLinkCallbackUrl(),
    handleCodeInApp: true,
  });
  globalThis.localStorage.setItem(EMAIL_FOR_SIGN_IN_STORAGE_KEY, email);
}

export function isSignInWithEmailLink(link: string): boolean {
  return firebaseIsSignInWithEmailLink(auth(), link);
}

/** The address `sendEmailSignInLink` stored, for when the link is opened in a fresh tab that never asked for it. */
export function pendingEmailForSignIn(): string | null {
  return globalThis.localStorage.getItem(EMAIL_FOR_SIGN_IN_STORAGE_KEY);
}

export async function completeEmailSignIn(email: string, link: string): Promise<string> {
  const credential = await signInWithEmailLink(auth(), email, link);
  globalThis.localStorage.removeItem(EMAIL_FOR_SIGN_IN_STORAGE_KEY);
  return credential.user.getIdToken();
}

export async function signOutOfFirebase(): Promise<void> {
  await auth().signOut();
}
