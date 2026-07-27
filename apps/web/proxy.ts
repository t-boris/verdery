/**
 * Two responsibilities, both of which have to happen before a page renders.
 *
 * 1. SESSION ROUTING. Routes based on session cookie *presence* only — not
 *    validity. This is a UX redirect, not the security boundary: a
 *    present-but-expired or -revoked cookie still reaches `/application/*`
 *    or `/client-portal/*`, and the API rejects the resulting requests with
 *    `401` exactly as it would with no cookie at all, because every actual
 *    request is verified server-side regardless of what this proxy
 *    (Next.js 16's rename of what was called "middleware") decided.
 *    `/client-portal/*` (P9C-WEB-01) shares this exact gate with
 *    `/application/*` rather than inventing a parallel one: both are
 *    authenticated-session route groups, gated by the identical session
 *    cookie — the client portal's own authorization (which engagement,
 *    which garden) is a server-side concern the API re-verifies on every
 *    request, the same "UX redirect, not the security boundary" posture as
 *    `/application` above.
 *
 * 2. THE CONTENT SECURITY POLICY (P8-SEC-02). Set here rather than in
 *    `next.config.ts` because it carries a per-request nonce, and a nonce
 *    that is identical on every response is not a nonce. `next.config.ts`
 *    builds one static header table at build time and therefore cannot
 *    produce one.
 *
 * WHY THE MATCHER COVERS EVERY DOCUMENT ROUTE NOW
 *
 * It used to list only `/application/:path*` and `/auth/sign-in`, which is
 * all the redirect logic needs. A CSP that protected only two routes would be
 * a CSP with holes exactly where the marketing page, the error pages, and the
 * status page are. The redirect conditions below are explicit path checks and
 * were already written that way, so widening the matcher changes nothing
 * about routing — the conditions simply do not fire elsewhere.
 *
 * The matcher excludes `_next/static`, `_next/image`, and the favicon: those
 * are subresources, not documents, a CSP on them protects nothing, and
 * running the proxy on every asset request costs latency for no benefit. It
 * also excludes the CSP report endpoint itself, so a violation report can
 * never generate a violation report.
 *
 * Source: architecture/web-application-design.md, section
 * "7. Authentication Session"; section "16. Security";
 * docs/development/threat-model.md, sections 16.3 and 16.4.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME } from '@/core/auth/session-cookie';
import {
  buildContentSecurityPolicy,
  cspHeaderName,
  reportingEndpointsHeader,
  resolveCspMode,
} from '@/shared/security/content-security-policy';
import { NONCE_HEADER, generateNonce } from '@/shared/security/security-headers';

/**
 * The Auth emulator origin `core/auth/firebase-app.ts` connects to when the
 * E2E harness sets `NEXT_PUBLIC_USE_FIREBASE_EMULATOR`. Hard-coded in both
 * places, and deliberately so: it is the address `firebase.json` fixes for
 * the emulator, not a configurable deployment value, and it must never be
 * admitted by `connect-src` on the strength of anything an operator could
 * accidentally set in a real environment.
 */
const AUTH_EMULATOR_ORIGIN = 'http://127.0.0.1:9099';

/**
 * The API origin, only when the browser really does call a different origin.
 *
 * The deployed build sets the `same-origin` sentinel because `next.config.ts`
 * proxies `/v1/*` through this server; `'self'` already covers that, so this
 * returns `undefined` and the policy stays as tight as it can be in the
 * environment that matters most.
 */
function crossOriginApiOrigin(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_API_ORIGIN;
  if (configured === undefined || configured === '' || configured === 'same-origin') {
    return undefined;
  }
  return configured.replace(/\/+$/u, '');
}

/** The policy for this request. Built once and used for both the response header and the inward one. */
function policyForRequest(nonce: string): string {
  return buildContentSecurityPolicy({
    nonce,
    firebaseAuthDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    apiOrigin: crossOriginApiOrigin(),
    authEmulatorOrigin:
      process.env['NEXT_PUBLIC_USE_FIREBASE_EMULATOR'] === 'true'
        ? AUTH_EMULATOR_ORIGIN
        : undefined,
    development: process.env.NODE_ENV === 'development',
  });
}

function applySecurityHeaders(response: NextResponse, policy: string): NextResponse {
  // THE GATED HALF OF P8-SEC-02, and the only line that decides it. Default
  // `report-only`; `WEB_CSP_MODE=enforce` is the flip. Nothing else in this
  // application branches on the mode, so turning it on cannot have a second,
  // surprising effect somewhere else. The policy string is byte-identical in
  // both modes — only the header name changes — which is what makes the
  // enforcing E2E run evidence about the report-only policy too.
  const mode = resolveCspMode(process.env['WEB_CSP_MODE']);

  response.headers.set(cspHeaderName(mode), policy);
  // Required for `report-to` to mean anything: without the group declaration
  // Chrome discards the report silently, which is the exact "declared but
  // collecting nothing" state this work package exists to end.
  response.headers.set('Reporting-Endpoints', reportingEndpointsHeader());
  return response;
}

export function proxy(request: NextRequest) {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);
  const { pathname } = request.nextUrl;

  const nonce = generateNonce();
  const policy = policyForRequest(nonce);

  const requiresSession =
    pathname.startsWith('/application') || pathname.startsWith('/client-portal');

  if (requiresSession && !hasSessionCookie) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/auth/sign-in';
    signIn.searchParams.set('next', pathname);
    return applySecurityHeaders(NextResponse.redirect(signIn), policy);
  }

  if (pathname === '/auth/sign-in' && hasSessionCookie) {
    const gardens = request.nextUrl.clone();
    gardens.pathname = '/application/gardens';
    gardens.search = '';
    return applySecurityHeaders(NextResponse.redirect(gardens), policy);
  }

  // Next.js stamps its own inline bootstrap and hydration scripts with the
  // nonce it finds on the REQUEST's CSP header, so the header has to be
  // forwarded inward as well as set outward. `NONCE_HEADER` carries the bare
  // value for any server component that later needs to nonce a script of its
  // own. Neither is needed on the redirect branches above: those responses
  // have no body to render.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set('content-security-policy', policy);

  return applySecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), policy);
}

export const config = {
  matcher: [
    /*
     * Every path except:
     * - `_next/static` and `_next/image`: build output and optimized images,
     *   both subresources rather than documents.
     * - `favicon.ico`.
     * - `internal/csp-report`: the violation sink. A CSP on the endpoint that
     *   receives CSP violations is a loop waiting to happen.
     * - `v1/`: proxied to the API by `next.config.ts` rewrites. Those
     *   responses are JSON consumed by `fetch`, not documents a CSP governs,
     *   and the API sets its own headers.
     */
    '/((?!_next/static|_next/image|favicon.ico|internal/csp-report|v1/).*)',
  ],
};
