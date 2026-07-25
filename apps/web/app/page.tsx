import { redirect } from 'next/navigation';

/**
 * The root is the application's front door, not a landing page: it forwards
 * straight into the product, and the session middleware (`proxy.ts`) decides
 * where that actually lands — `/application/gardens` with a session cookie,
 * `/auth/sign-in` without one.
 *
 * Replaces the Phase 1 shell placeholder, which survived unnoticed until the
 * first person opened the DEPLOYED root and found "features arrive in later
 * phases" fronting a finished application — the E2E suite navigates straight
 * to `/auth/sign-in`, so nothing ever looked at `/`.
 */
export default function HomePage() {
  redirect('/application/gardens');
}
