import type { AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * Standalone-preview-bundle-only stand-in for `next/link`.
 *
 * The real `next/link` module reads several Next.js-internal
 * `process.env.__NEXT_*` compile-time constants at module scope — they only
 * exist inside a real Next.js build (its own bundler injects them). Loaded
 * outside one, `process` itself is undefined in the browser and the whole
 * shared IIFE bundle throws before any component reaches window.<global>.
 * Every preview card here is a static render, never a navigation, so a
 * plain anchor is behaviorally identical for this purpose. Wired via a
 * tsconfig `paths` alias (see .design-sync/NOTES.md) — the real
 * apps/web source is never touched.
 */
export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly href: string;
  readonly children?: ReactNode;
}

export default function Link({ href, children, ...rest }: LinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
