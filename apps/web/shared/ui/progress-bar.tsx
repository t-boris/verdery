import { useId } from 'react';

import styles from './progress-bar.module.css';

export interface ProgressBarProps {
  /** 0-100. Values outside that range are clamped rather than rendered out of bounds. */
  readonly value: number;
  readonly label: string;
}

/**
 * Determinate progress meter.
 *
 * Built on the native `<progress>` element rather than a styled `<div>`, so
 * assistive technology gets `role="progressbar"` and the current value for
 * free. The percentage is also rendered as plain text next to the bar —
 * state is never carried by the bar's fill alone.
 *
 * Source: architecture/web-application-design.md, section "14. Accessibility".
 */
export function ProgressBar({ value, label }: ProgressBarProps) {
  const labelId = useId();
  const clamped = Math.max(0, Math.min(100, value));
  const rounded = Math.round(clamped);

  return (
    <div className={styles['wrapper']}>
      <label id={labelId} className={styles['label']}>
        {label}
      </label>
      <div className={styles['row']}>
        <progress className={styles['bar']} value={clamped} max={100} aria-labelledby={labelId} />
        <span className={styles['percent']}>{rounded}%</span>
      </div>
    </div>
  );
}
