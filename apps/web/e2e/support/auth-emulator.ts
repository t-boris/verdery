/**
 * Firebase Auth emulator REST helpers.
 *
 * The emulator exposes pending out-of-band (OOB) codes — the same codes it
 * would otherwise only ever deliver by email — through a plain REST API, so a
 * Playwright test can complete the email magic-link flow deterministically:
 * request a link through the app's real UI, fetch it here, navigate to it.
 * No real email delivery, and no manual step, is ever involved.
 *
 * `AUTH_EMULATOR_ORIGIN` and `AUTH_EMULATOR_PROJECT_ID` must match
 * `firebase.json` / `.firebaserc` at the repository root and the
 * `FIREBASE_PROJECT_ID` / `NEXT_PUBLIC_FIREBASE_PROJECT_ID` values
 * `apps/web/e2e/run-e2e.sh` exports for the API and the web app.
 *
 * Verified against a locally running emulator while building this suite
 * (`firebase emulators:start --only auth`): the REST shape below is not
 * guessed from documentation alone.
 */

export const AUTH_EMULATOR_ORIGIN = 'http://127.0.0.1:9099';
export const AUTH_EMULATOR_PROJECT_ID = 'demo-verdery-e2e';

interface OobCodeEntry {
  readonly email: string;
  readonly requestType: string;
  readonly oobCode: string;
  /**
   * A link to the emulator's OWN `/emulator/action` page, not the app.
   * Unused directly — see {@link fetchEmailSignInLink} for why.
   */
  readonly oobLink: string;
}

interface OobCodesResponse {
  readonly oobCodes: readonly OobCodeEntry[];
}

async function listOobCodes(): Promise<readonly OobCodeEntry[]> {
  const response = await fetch(
    `${AUTH_EMULATOR_ORIGIN}/emulator/v1/projects/${AUTH_EMULATOR_PROJECT_ID}/oobCodes`,
  );

  if (!response.ok) {
    throw new Error(`Auth emulator oobCodes request failed with status ${String(response.status)}`);
  }

  const body = (await response.json()) as OobCodesResponse;
  return body.oobCodes;
}

/**
 * Polls the emulator for the most recent `EMAIL_SIGNIN` OOB code issued to
 * `email`, and returns it rewritten into a link the app itself can open.
 *
 * The emulator's own `oobLink` targets `/emulator/action` on the emulator's
 * own origin — a fake IDP-style confirmation page, not part of this
 * application. `isSignInWithEmailLink` / `signInWithEmailLink` (see
 * `core/auth/sign-in.ts`) only ever read the `mode`, `oobCode`, and `apiKey`
 * query parameters off whatever URL they are given; they never check the
 * host. Rewriting the code onto the app's own `continueUrl` therefore
 * produces an equally valid sign-in link without ever loading the emulator's
 * action page — the deterministic path the primary E2E scenario relies on.
 *
 * Polls rather than fetching once because `sendSignInLinkToEmail` resolves
 * before the emulator is guaranteed to have indexed the code for retrieval.
 */
export async function fetchEmailSignInLink(email: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const codes = await listOobCodes();
    const match = codes.findLast(
      (entry) => entry.email === email && entry.requestType === 'EMAIL_SIGNIN',
    );

    if (match !== undefined) {
      const emulatorLink = new URL(match.oobLink);
      const continueUrl = emulatorLink.searchParams.get('continueUrl');
      if (continueUrl === null) {
        throw new Error('Auth emulator oobLink had no continueUrl parameter.');
      }

      const appLink = new URL(continueUrl);
      appLink.searchParams.set(
        'apiKey',
        emulatorLink.searchParams.get('apiKey') ?? 'demo-verdery-e2e-api-key',
      );
      appLink.searchParams.set('oobCode', match.oobCode);
      appLink.searchParams.set('mode', 'signIn');
      return appLink.toString();
    }

    if (Date.now() > deadline) {
      throw new Error(
        `No EMAIL_SIGNIN oobCode appeared for ${email} within ${String(timeoutMs)}ms.`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** A fresh, never-before-used address, so every test run starts a genuinely new identity. */
export function freshTestEmail(label: string): string {
  const unique = `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
  return `e2e-${label}-${unique}@example.com`;
}
