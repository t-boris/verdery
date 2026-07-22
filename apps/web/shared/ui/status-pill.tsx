import styles from './status-pill.module.css';
import { classNames } from './class-names';

export type StatusTone = 'positive' | 'negative' | 'neutral';

const GLYPHS: Readonly<Record<StatusTone, string>> = {
  positive: '✓',
  negative: '✗',
  neutral: '–',
};

export interface StatusPillProps {
  readonly tone: StatusTone;
  readonly label: string;
}

/**
 * Compact state indicator.
 *
 * The tone is carried by a glyph and by the visible label as well as by colour,
 * because colour may not be the only carrier of state.
 *
 * Source: architecture/web-application-design.md, section "14. Accessibility".
 */
export function StatusPill({ tone, label }: StatusPillProps) {
  return (
    <span className={classNames(styles['pill'], styles[tone])}>
      <span className={styles['glyph']} aria-hidden="true">
        {GLYPHS[tone]}
      </span>
      {label}
    </span>
  );
}
