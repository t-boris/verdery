/**
 * Public surface of the client-side authentication layer.
 *
 * Source: architecture/web-application-design.md, section "7. Authentication Session".
 */
export { getFirebaseApp } from './firebase-app';
export { getAppCheckToken } from './app-check';
export {
  completeEmailSignIn,
  isSignInWithEmailLink,
  pendingEmailForSignIn,
  sendEmailSignInLink,
  signInWithApple,
  signInWithGoogle,
  signOutOfFirebase,
} from './sign-in';
export { SESSION_COOKIE_NAME } from './session-cookie';
