import type { ReactNode } from 'react';

import styles from './field-grid.module.css';

export interface FieldGridProps {
  readonly children: ReactNode;
  /**
   * Narrowest a column may become before the grid drops to fewer of them.
   * The default suits short values — a coordinate, a date, a count. Raise it
   * for fields that hold a sentence.
   */
  readonly minimum?: 'narrow' | 'wide';
}

/**
 * Short fields side by side instead of stacked.
 *
 * A form column of full-width inputs is the default a flex column gives you,
 * and it is wrong for values that are three characters long: latitude and
 * longitude were two full-width boxes one above the other, each wide enough
 * for a sentence, together taller than the panel they belonged to. Pairs that
 * are read together should sit together.
 *
 * `auto-fit` with a minimum rather than a media query: the row becomes a
 * column when the SPACE runs out, wherever that happens — inside a narrow
 * inspector pane on a wide display just as much as on a phone — so no call
 * site has to know how much room it was given.
 *
 * Source: architecture/web-application-design.md, section "5. Application
 * Structure".
 */
export function FieldGrid({ children, minimum = 'narrow' }: FieldGridProps) {
  return <div className={styles[minimum === 'narrow' ? 'narrow' : 'wide']}>{children}</div>;
}
