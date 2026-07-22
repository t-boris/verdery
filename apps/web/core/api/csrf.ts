/**
 * Double-submit-cookie CSRF header for cookie-authenticated mutations.
 *
 * The CSRF cookie is deliberately readable by script (unlike the session
 * cookie itself): the entire mechanism depends on this application reading
 * it and echoing it back in a header a cross-site request cannot forge.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "5. Web Session Flow"; services/api/src/platform/authentication/csrf.ts.
 */

const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const prefix = `${name}=`;
  for (const entry of document.cookie.split('; ')) {
    if (entry.startsWith(prefix)) {
      return decodeURIComponent(entry.slice(prefix.length));
    }
  }
  return null;
}

/** Header object to spread into a mutating request's headers. Empty before a session exists. */
export function csrfHeader(): Readonly<Record<string, string>> {
  const token = readCookie(CSRF_COOKIE_NAME);
  return token === null ? {} : { [CSRF_HEADER_NAME]: token };
}
