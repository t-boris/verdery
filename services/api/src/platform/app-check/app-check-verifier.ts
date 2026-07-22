/**
 * Port for classifying a request's Firebase App Check token.
 *
 * Monitor-only by design: a classification is a fact to log, never a reason to
 * reject a request. `classify` therefore never throws — a token that fails
 * verification classifies as `'invalid'` rather than propagating the
 * underlying error, and no token at all classifies as `'missing'` without
 * calling Firebase.
 *
 * Source: architecture/identity-and-authorization.md, section "12. App Check"
 * (rollout stage 2, "Monitor valid, missing, and invalid traffic").
 */

export type AppCheckClassification = 'valid' | 'missing' | 'invalid';

export interface AppCheckVerifier {
  /**
   * Classifies the App Check token read from the request, or `undefined` when
   * the request carried none.
   */
  classify(token: string | undefined): Promise<AppCheckClassification>;
}
