import type { NextConfig } from 'next';

import { STATIC_SECURITY_HEADERS } from './shared/security/security-headers';

/**
 * The Content Security Policy is NO LONGER SET HERE (P8-SEC-02).
 *
 * `headers()` produces one static table at build time, and the policy now
 * carries a per-request nonce — a nonce that is identical on every response
 * is not a nonce, it is a password an attacker reads out of the page they are
 * injecting into. The policy is therefore built per request in
 * `apps/web/proxy.ts` from `shared/security/content-security-policy.ts`,
 * which is also where its correctness is pinned by tests and where the
 * report-only-to-enforce switch lives.
 *
 * What remains here are the headers that genuinely do not vary, applied to
 * every path including the static assets the proxy deliberately skips.
 *
 * Source: architecture/web-application-design.md, section "16. Security";
 * docs/development/threat-model.md, section 16.3.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `standalone` emits a self-contained server (server.js + traced
  // node_modules) — the canonical Next.js container deployment, and the only
  // output mode that does not need the whole pnpm workspace at runtime.
  // Local `next dev`/`next start` behavior is unchanged.
  // Source: implementation-plan.md Phase 8 (web deployment stage).
  output: 'standalone',
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: [...STATIC_SECURITY_HEADERS] }]);
  },
  // Same-origin API proxying for the DEPLOYED web app. The session cookie is
  // deliberately `SameSite=strict` and host-only; on `run.app` the web and
  // API services are different SITES (run.app is on the Public Suffix List),
  // so a browser would neither store nor send it cross-origin — sign-in
  // "succeeded" and then every authenticated call had no cookie, found live
  // by the owner. Proxying /v1/* through the web server makes the API
  // first-party to the browser: the cookie design stays strict and intact.
  // Build-time (rewrites compile into the routes manifest): CI passes the
  // API origin; locally this stays unset and no rewrite exists — local dev
  // talks to localhost:8080 directly, which IS same-site.
  rewrites() {
    const proxyOrigin = process.env['API_PROXY_ORIGIN'];
    if (proxyOrigin === undefined || proxyOrigin === '') {
      return Promise.resolve([]);
    }
    return Promise.resolve([{ source: '/v1/:path*', destination: `${proxyOrigin}/v1/:path*` }]);
  },
};

export default nextConfig;
