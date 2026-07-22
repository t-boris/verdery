import { useId, type ReactNode } from 'react';

import styles from './card.module.css';

export interface CardProps {
  readonly title: string;
  readonly children: ReactNode;
}

/**
 * Grouping primitive.
 *
 * The heading is associated with the region through `aria-labelledby` so that a
 * screen reader announces which group it entered rather than an unnamed region.
 */
export function Card({ title, children }: CardProps) {
  const titleId = useId();

  return (
    <section className={styles['card']} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles['title']}>
        {title}
      </h2>
      {children}
    </section>
  );
}
