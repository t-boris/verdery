import type { ReactNode } from 'react';

import { PlusIcon } from './icons';
import styles from './action-disclosure.module.css';

export interface ActionDisclosureProps {
  readonly title: string;
  readonly description?: string;
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
}

/**
 * Keeps secondary commands available without turning a read screen into a
 * wall of forms. Native details/summary preserves keyboard and no-script
 * behavior, while the visual treatment makes the closed state a clear action.
 */
export function ActionDisclosure({
  title,
  description,
  icon,
  children,
  defaultOpen = false,
}: ActionDisclosureProps) {
  return (
    <details className={styles['disclosure']} open={defaultOpen || undefined}>
      <summary className={styles['summary']}>
        <span className={styles['icon']}>{icon}</span>
        <span className={styles['copy']}>
          <span className={styles['title']}>{title}</span>
          {description !== undefined && (
            <span className={styles['description']}>{description}</span>
          )}
        </span>
        <span className={styles['toggle']}>
          <PlusIcon size={17} />
        </span>
      </summary>
      <div className={styles['body']}>{children}</div>
    </details>
  );
}
