/**
 * Firebase Admin SDK adapter for {@link AppCheckVerifier}.
 *
 * The second file in the service allowed to import `firebase-admin`, next to
 * `platform/authentication/firebase-token-verifier.ts`. Runs under the same
 * runtime service account identity as the rest of the service's Google Cloud
 * clients — no downloaded service account key.
 *
 * Every verification failure (expired, malformed, unknown app, network error)
 * collapses to `'invalid'`: this is a monitor-only signal, so the distinction
 * between failure reasons is not worth carrying past this adapter.
 */

import type { App } from 'firebase-admin/app';
import { type AppCheck, getAppCheck } from 'firebase-admin/app-check';
import type { AppCheckClassification, AppCheckVerifier } from './app-check-verifier.js';

export class FirebaseAppCheckVerifier implements AppCheckVerifier {
  private readonly appCheck: AppCheck;

  constructor(app: App) {
    this.appCheck = getAppCheck(app);
  }

  async classify(token: string | undefined): Promise<AppCheckClassification> {
    if (token === undefined) {
      return 'missing';
    }

    try {
      await this.appCheck.verifyToken(token);
      return 'valid';
    } catch {
      return 'invalid';
    }
  }
}
