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
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default nextConfig;
