/**
 * English UI copy used to locate elements in the E2E specs.
 *
 * A small, deliberate duplicate of the relevant entries in
 * `shared/localization/messages/en.ts`, not an import of that module: the
 * Playwright config runs specs outside the Next.js build, and pinning
 * exact strings here makes a locale-catalogue rename fail LOUDLY here (a
 * broken selector) rather than silently, which is the property this file
 * exists for. Keep in sync by hand when the referenced keys change.
 */
export const copy = {
  emailLabel: 'Email address',
  emailSubmit: 'Send me a sign-in link',
  emailLinkSent: 'Check your email',
  signInWithGoogle: 'Continue with Google',
  signInFailed: 'Sign-in did not succeed. Try again.',
  gardensTitle: 'Gardens',
  gardensEmpty: 'You have no gardens yet. Create your first one below.',
  gardensCreateNameLabel: 'Garden name',
  gardensCreateSubmit: 'Create garden',
  signOut: 'Sign out',
} as const;
