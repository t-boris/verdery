import type { ReactNode } from 'react';

import styles from './visually-hidden.module.css';

export interface VisuallyHiddenProps {
  readonly children: ReactNode;
  /** Politeness of the live region, when this element announces changing state. */
  readonly liveRegion?: 'polite' | 'assertive';
}

/** Content available to assistive technology only, such as an announcement region. */
export function VisuallyHidden({ children, liveRegion }: VisuallyHiddenProps) {
  return (
    <span
      className={styles['visuallyHidden']}
      aria-live={liveRegion}
      role={liveRegion === undefined ? undefined : 'status'}
    >
      {children}
    </span>
  );
}
