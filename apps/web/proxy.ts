/**
 * Routes based on session cookie *presence* only — not validity. This is a
 * UX redirect, not the security boundary: a present-but-expired or -revoked
 * cookie still reaches `/application/*`, and the API rejects the resulting
 * requests with `401` exactly as it would with no cookie at all, because
 * every actual request is verified server-side regardless of what this
 * proxy (Next.js 16's rename of what was called "middleware") decided.
 *
 * Source: architecture/web-application-design.md, section
 * "7. Authentication Session" ("The Next.js server may use the session to
 * render the application shell").
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME } from '@/core/auth/session-cookie';

export function proxy(request: NextRequest) {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/application') && !hasSessionCookie) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/auth/sign-in';
    signIn.searchParams.set('next', pathname);
    return NextResponse.redirect(signIn);
  }

  if (pathname === '/auth/sign-in' && hasSessionCookie) {
    const gardens = request.nextUrl.clone();
    gardens.pathname = '/application/gardens';
    gardens.search = '';
    return NextResponse.redirect(gardens);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/application/:path*', '/auth/sign-in'],
};
