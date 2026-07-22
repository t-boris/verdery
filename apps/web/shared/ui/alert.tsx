import type { ReactNode } from 'react';

import styles from './alert.module.css';
import { classNames } from './class-names';

export type AlertTone = 'danger' | 'info';

export interface AlertProps {
  readonly tone: AlertTone;
  readonly title: string;
  readonly children?: ReactNode;
  /** Opaque support reference, rendered verbatim. Never a stack trace or a raw message. */
  readonly reference?: string;
}

/**
 * Inline message about the outcome of an action.
 *
 * A failure uses `role="alert"` so it interrupts and is announced immediately;
 * an informational message uses `role="status"` so it does not.
 *
 * Source: architecture/web-application-design.md, section "14. Accessibility".
 */
export function Alert({ tone, title, children, reference }: AlertProps) {
  return (
    <div
      className={classNames(styles['alert'], styles[tone])}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <p className={styles['title']}>{title}</p>
      {children}
      {reference !== undefined && <p className={styles['reference']}>{reference}</p>}
    </div>
  );
}
