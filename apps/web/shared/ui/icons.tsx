import type { ReactNode } from 'react';

/**
 * Hand-authored inline SVG icons.
 *
 * A deliberately small set drawn on a 20x20 grid with a consistent 1.6px
 * stroke. Inline SVG keeps the application self-contained under the CSP —
 * no icon font, no CDN — and `currentColor` lets every icon inherit the
 * surrounding text colour in both themes.
 *
 * Every icon is decorative reinforcement of an adjacent visible label and is
 * therefore always `aria-hidden`; a control never relies on an icon alone
 * for its accessible name.
 *
 * Source: architecture/web-application-design.md, sections "14. Accessibility"
 * and "16. Security".
 */

export interface IconProps {
  /** Rendered square size in CSS pixels. */
  readonly size?: number;
}

function IconBase({ size = 16, children }: IconProps & { readonly children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Brand mark: a single leaf with its midrib. */
export function LeafIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 15.5C4.5 9 9.5 4.5 16 4.5c0 6.5-4.5 11-11.5 11Z" />
      <path d="M4.5 15.5C7 12 10.5 8.5 14.5 6" />
    </IconBase>
  );
}

/** Garden overview: a simple house-and-plot outline. */
export function HomeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 9.5 10 3.5l6.5 6" />
      <path d="M5.2 8.2V16a.9.9 0 0 0 .9.9h7.8a.9.9 0 0 0 .9-.9V8.2" />
    </IconBase>
  );
}

/** Today: a sun. */
export function SunIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10" cy="10" r="3.4" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" />
    </IconBase>
  );
}

/** Map: a folded plan with its creases. */
export function MapIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 5.2 7.6 3.5l4.8 1.7L17 3.5v11.3l-4.6 1.7-4.8-1.7L3 16.5Z" />
      <path d="M7.6 3.5v11.3M12.4 5.2v11.3" />
    </IconBase>
  );
}

/** Plants: a sprout with two leaves. */
export function SproutIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 17v-6.5" />
      <path d="M10 10.5C10 7 7.5 4.9 3.8 4.9c0 3.6 2.4 5.6 6.2 5.6Z" />
      <path d="M10 10.5c0-2.9 2.1-4.6 5.2-4.6 0 3-2.1 4.6-5.2 4.6Z" />
    </IconBase>
  );
}

/** Observations: an open eye. */
export function EyeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M2.5 10c2-4 4.6-6 7.5-6s5.5 2 7.5 6c-2 4-4.6 6-7.5 6s-5.5-2-7.5-6Z" />
      <circle cx="10" cy="10" r="2.4" />
    </IconBase>
  );
}

/** Tasks: a circled check. */
export function CheckCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="m6.9 10.3 2.1 2.1 4.1-4.5" />
    </IconBase>
  );
}

/** Seasonal plan: a calendar page with a bound-header. */
export function CalendarIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.2 4.5h11.6a1 1 0 0 1 1 1v9.8a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" />
      <path d="M3.2 8h13.6M7 3v3M13 3v3" />
    </IconBase>
  );
}

/** Sign out: a doorway with an outward arrow. */
export function SignOutIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8.5 3.5H5a1.2 1.2 0 0 0-1.2 1.2v10.6A1.2 1.2 0 0 0 5 16.5h3.5" />
      <path d="M12.2 6.7 15.5 10l-3.3 3.3M15.5 10H8" />
    </IconBase>
  );
}

/** Selection cursor. */
export function CursorIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m4 3 11 7-5 .9-2.7 4.3Z" />
    </IconBase>
  );
}

/** History step backward. */
export function UndoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m7 5-4 4 4 4" />
      <path d="M3 9h7.5a5 5 0 0 1 5 5v1" />
    </IconBase>
  );
}

/** History step forward. */
export function RedoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m13 5 4 4-4 4" />
      <path d="M17 9H9.5a5 5 0 0 0-5 5v1" />
    </IconBase>
  );
}

/** Hidden visibility state. */
export function EyeOffIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 3 17 17" />
      <path d="M7.2 5C8.1 4.4 9 4 10 4c2.9 0 5.5 2 7.5 6a13 13 0 0 1-2 3" />
      <path d="M12.6 15.5c-.8.3-1.7.5-2.6.5-2.9 0-5.5-2-7.5-6a13.5 13.5 0 0 1 2-3" />
    </IconBase>
  );
}

/** Locked state. */
export function LockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4.2" y="8.5" width="11.6" height="8" rx="1.2" />
      <path d="M6.8 8.5V6.7a3.2 3.2 0 0 1 6.4 0v1.8" />
    </IconBase>
  );
}

/** Unlocked state. */
export function UnlockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4.2" y="8.5" width="11.6" height="8" rx="1.2" />
      <path d="M7 8.5V6.7a3.2 3.2 0 0 1 6-1.6" />
    </IconBase>
  );
}

/** Destructive remove action. */
export function TrashIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 6h12M7 6V3.8h6V6M6 6l.7 10h6.6L14 6" />
      <path d="M8.5 9v4.5M11.5 9v4.5" />
    </IconBase>
  );
}

/** Physical dimensions and measurements. */
export function RulerIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m4 14.5 10.5-10.5 2 2L6 16.5H4Z" />
      <path d="m10 8.5 1.5 1.5M12 6.5 13.5 8M8 10.5l1.5 1.5" />
    </IconBase>
  );
}

/** A plant's name/title field. */
export function TypeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 5h10M10 5v10" />
    </IconBase>
  );
}

/** Variety: a price/identification tag. */
export function TagIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 4.5h5.6L16 10.4l-5.9 5.9L4.5 10.7V4.5Z" />
      <circle cx="7.3" cy="7.3" r="1" />
    </IconBase>
  );
}

/** A count of individual plants in a row or group. */
export function HashIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7.5 3.5 5.5 16.5M14.5 3.5l-2 13M3.5 8h13M2.7 12.5h13" />
    </IconBase>
  );
}

/** Condition: a pulse/ECG line. */
export function PulseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M2.5 10.5h3l1.5-4 3 8 1.5-4h3" />
    </IconBase>
  );
}

/** Care guidance: a lit lightbulb. */
export function LightbulbIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 3.5a5 5 0 0 0-2.8 9.1c.5.35.8.9.8 1.5v.4h4v-.4c0-.6.3-1.15.8-1.5A5 5 0 0 0 10 3.5Z" />
      <path d="M8.2 16.5h3.6M8.7 18h2.6" />
    </IconBase>
  );
}

/*
 * ACTION ICONS. The set above names things the product HAS — a garden, a
 * plant, an observation. These name things a button DOES, which the set had
 * none of, so every action button in the application was text-only while the
 * map rail's were not. Same 20-unit grid and 1.6 stroke, so they sit beside
 * the others without a second visual language.
 */

/** Create or add: a plus. */
export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 4.5v11M4.5 10h11" />
    </IconBase>
  );
}

/** Confirm or save: a check. */
export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 10.5 8.5 14.5 15.5 6" />
    </IconBase>
  );
}

/** Dismiss or cancel: a cross. Never used for delete — that is `TrashIcon`. */
export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
    </IconBase>
  );
}

/** Retry or recalculate: a circular arrow. */
export function RefreshIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M16 10a6 6 0 1 1-1.9-4.4" />
      <path d="M16.2 4v3.4h-3.4" />
    </IconBase>
  );
}

/** Send a file to storage: an arrow into a tray. */
export function UploadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 13.5V4.5M6.5 8 10 4.5 13.5 8" />
      <path d="M4.5 13v2.6a.9.9 0 0 0 .9.9h9.2a.9.9 0 0 0 .9-.9V13" />
    </IconBase>
  );
}

/**
 * Suspend an upload: the two-bar transport symbol, drawn as strokes on the
 * same grid rather than filled bars, so it carries the set's single weight.
 */
export function PauseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 4.5v11M12 4.5v11" />
    </IconBase>
  );
}

/** Load the next page of a list: a downward chevron. */
export function ChevronDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5.5 8 10 12.5 14.5 8" />
    </IconBase>
  );
}
