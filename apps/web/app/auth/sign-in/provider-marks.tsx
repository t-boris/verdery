/**
 * Identity-provider marks for the sign-in buttons.
 *
 * Deliberately NOT part of `shared/ui/icons.tsx`. That set is one visual
 * system — a 20×20 grid, a 1.6px stroke, `currentColor` — and these are not
 * ours to draw that way: a provider mark has fixed geometry and, for Google,
 * fixed colours. Putting them in the design system would invite someone to
 * restyle them, which is exactly what a brand mark may not be.
 *
 * Both are `aria-hidden`, like every icon in this application: each sits
 * beside a visible label that carries the button's accessible name, so a
 * screen reader announces "Continue with Google", not "Google logo".
 *
 * Inline SVG, no external asset — the CSP forbids remote images, and a
 * sign-in screen that waits on a CDN is a sign-in screen that can hang.
 *
 * Source: architecture/web-application-design.md, sections "14. Accessibility"
 * and "16. Security".
 */

export interface ProviderMarkProps {
  /** Rendered square size in CSS pixels. */
  readonly size?: number;
}

/** Google's four-colour "G". Fixed colours: this mark is never tinted by its surroundings. */
export function GoogleMark({ size = 18 }: ProviderMarkProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="presentation"
    >
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h6.19c-.27 1.44-1.08 2.66-2.3 3.48v2.89h3.72c2.18-2.01 3.45-4.97 3.45-8.38z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.11 0 5.72-1.03 7.63-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.91 1.1-3 0-5.55-2.03-6.46-4.76H1.69v2.98C3.59 21.42 7.5 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.54 14.66A7.2 7.2 0 0 1 5.16 12c0-.92.16-1.82.38-2.66V6.36H1.69A12 12 0 0 0 .41 12c0 1.94.46 3.77 1.28 5.64l3.85-2.98z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.69 0 3.21.58 4.4 1.72l3.3-3.3C17.71 1.2 15.1 0 12 0 7.5 0 3.59 2.58 1.69 6.36l3.85 2.98C6.45 6.61 9 4.75 12 4.75z"
      />
    </svg>
  );
}

/** Apple's mark, in the surrounding text colour so it reads in both themes. */
export function AppleMark({ size = 18 }: ProviderMarkProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="presentation"
    >
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08z" />
      <path d="M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
