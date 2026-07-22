/**
 * Public surface of the client-side authentication layer.
 *
 * Source: architecture/web-application-design.md, section "7. Authentication Session".
 */
export { getFirebaseApp } from './firebase-app';
export {
  completeEmailSignIn,
  isSignInWithEmailLink,
  pendingEmailForSignIn,
  sendEmailSignInLink,
  signInWithGoogle,
  signOutOfFirebase,
} from './sign-in';
export { SESSION_COOKIE_NAME } from './session-cookie';
