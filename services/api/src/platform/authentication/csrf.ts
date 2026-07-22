/**
 * Double-submit-cookie CSRF protection for cookie-authenticated mutations.
 *
 * Chosen over `@fastify/csrf-protection` because that plugin's usual pairing
 * — a secret held in a server-side session store — has no natural home in
 * this service: sessions are a stateless Firebase session cookie, not a
 * server-side session object. The double-submit pattern needs no server
 * state at all: a same-site attacker cannot read another origin's cookie to
 * echo its value in a custom header, which is the property this scheme
 * relies on.
 *
 * Only applies to session-cookie-authenticated requests. A Firebase ID
 * token in an `Authorization` header is not something a browser attaches to
 * a cross-site request automatically, so bearer-token requests are not a
 * CSRF target and never carry this cookie or header.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "5. Web Session Flow" ("Mutation requests authenticated by cookie require
 * CSRF protection").
 */

import { randomBytes } from 'node:crypto';

export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const TOKEN_BYTE_LENGTH = 32;

export function generateCsrfToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requiresCsrfCheck(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/** Constant-time-ish comparison is unnecessary here: both values are public to their own holder, not secrets being brute-forced over the network. */
export function csrfTokensMatch(
  cookieValue: string | undefined,
  headerValue: string | string[] | undefined,
): boolean {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return cookieValue !== undefined && header !== undefined && cookieValue === header;
}
