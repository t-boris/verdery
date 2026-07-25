import type { NextConfig } from 'next';

/**
 * Content Security Policy, declared in report-only mode.
 *
 * The architecture requires the policy to be defined and monitored before it is
 * enforced, so violations are collected first and enforcement is turned on once
 * the report stream is clean.
 *
 * Source: architecture/web-application-design.md, section "16. Security".
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js injects inline bootstrap and hydration scripts.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // The API origin is added by deployment configuration once it is known.
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // helmet's own default, which the API already sends (`app.ts` disables
  // only its CSP). Since the web client became the front door that carries
  // the session cookie and proxies `/v1/*`, it should assert the same
  // transport guarantee as the service behind it.
  // Source: threat-model.md section 16 (P8-SEC-01).
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `standalone` emits a self-contained server (server.js + traced
  // node_modules) — the canonical Next.js container deployment, and the only
  // output mode that does not need the whole pnpm workspace at runtime.
  // Local `next dev`/`next start` behavior is unchanged.
  // Source: implementation-plan.md Phase 8 (web deployment stage).
  output: 'standalone',
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
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
