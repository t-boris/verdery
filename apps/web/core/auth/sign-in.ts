/**
 * Client-side Firebase sign-in.
 *
 * Every function returns the freshly obtained ID token; nothing here talks to
 * the Verdery API directly. Exchanging that token for a session is a
 * transport concern owned by `core/api/session-gateway.ts`, kept separate so
 * this module has no HTTP client dependency.
 *
 * Apple is deliberately absent: Sign in with Apple awaits the repository
 * owner's own Apple Developer credentials (Services ID, Team ID, Key ID,
 * `.p8` key) before it can be configured in Firebase.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "3. Initial Sign-In Methods".
 */

import {
  getAuth,
  GoogleAuthProvider,
  isSignInWithEmailLink as firebaseIsSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
} from 'firebase/auth';

import { getFirebaseApp } from './firebase-app';

/** Where the pending email-link sign-in's address is held between "send" and "complete", possibly in a different tab. */
const EMAIL_FOR_SIGN_IN_STORAGE_KEY = 'verdery.emailForSignIn';

function auth() {
  return getAuth(getFirebaseApp());
}

export async function signInWithGoogle(): Promise<string> {
  const credential = await signInWithPopup(auth(), new GoogleAuthProvider());
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
