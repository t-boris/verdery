/**
 * Name of the `HttpOnly` session cookie the API sets. Application code never
 * reads its value — that would be impossible, being `HttpOnly` — only checks
 * for its presence, in `middleware.ts`, to decide routing. Verification of
 * the cookie's actual validity happens server-side, on every API request.
 *
 * Source: services/api/src/platform/authentication/authentication-plugin.ts.
 */
export const SESSION_COOKIE_NAME = '__session';
