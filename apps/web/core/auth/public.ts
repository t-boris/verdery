/**
 * Public surface of the client-side authentication layer.
 *
 * Source: architecture/web-application-design.md, section "7. Authentication Session".
 */
export { getFirebaseApp } from './firebase-app';
export { getAppCheckToken, APP_CHECK_TOKEN_BUDGET_MS } from './app-check';
export { refreshSessionCookie } from './session-refresh';
export { redirectToSignIn, SESSION_EXPIRED_PARAMETER } from './sign-in-redirect';
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
