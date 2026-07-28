/**
 * Security response headers, and the per-request nonce the CSP is built
 * around.
 *
 * WHY THESE LIVE HERE AND NOT IN `next.config.ts`
 *
 * threat-model.md section 16.3 asked for exactly this move, for exactly one
 * reason: the web test suite's include glob is
 * `{app,core,shared,features}/**\/*.test.{ts,tsx}`, so a module under
 * `shared/` can be pinned by tests while a root config file cannot. The
 * `P8-SEC-02` enforcement flip is then a tested change rather than a blind
 * one.
 *
 * There is a second reason the split matters more than convenience. A CSP
 * carrying a nonce CANNOT come from `next.config.ts` at all: `headers()`
 * produces one static table at build time, and a nonce that is the same on
 * every response is not a nonce — it is a password an attacker reads out of
 * the page they are injecting into. The nonce-bearing policy therefore has to
 * be set per request, which in Next.js means the proxy (`apps/web/proxy.ts`).
 * `next.config.ts` keeps the headers that genuinely are constant.
 *
 * Source: architecture/web-application-design.md, section "16. Security";
 * docs/development/threat-model.md, section 16.3.
 */

/**
 * Response headers that do not vary per request.
 *
 * The CSP is deliberately absent: see this file's header. These headers are
 * served from `next.config.ts` for every path, including static assets, which
 * the proxy does not run on.
 */
export const STATIC_SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Firebase Authentication opens a cross-origin OAuth popup and must be able
  // to observe when that popup closes. This mode isolates unrelated top-level
  // windows while preserving the opener relationship for windows this app
  // deliberately opened.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  // helmet's own default, which the API already sends (`app.ts` disables only
  // its CSP). Since the web client became the front door that carries the
  // session cookie and proxies `/v1/*`, it asserts the same transport
  // guarantee as the service behind it. `preload` is deliberately omitted: it
  // is a commitment for a domain this project does not own.
  // Source: threat-model.md section 16.3 (P8-SEC-01).
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

/** Request header the proxy uses to hand the nonce to the rendering pass. */
export const NONCE_HEADER = 'x-verdery-nonce';

/**
 * 128 bits of randomness, base64. The CSP specification requires at least 128
 * bits from a cryptographically secure source, and a nonce short enough to
 * guess is a nonce that grants inline execution to whoever guesses it.
 *
 * `crypto.getRandomValues` rather than `node:crypto`: this runs inside the
 * proxy, which must work under both the Edge and the Node.js runtime, and the
 * Web Crypto API is the one available in both.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
