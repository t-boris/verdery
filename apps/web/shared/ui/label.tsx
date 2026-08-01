import type { ElementType, ReactNode } from 'react';

import { classNames } from './class-names';
import styles from './label.module.css';

export interface LabelProps {
  readonly children: ReactNode;
  /**
   * Element to render. Defaults to `span` so a label can sit anywhere without
   * implying structure it does not have; pass `'h2'`/`'h3'` where the label IS
   * the panel's heading, so the document outline stays real for a screen
   * reader rather than being faked with styling.
   */
  readonly as?: ElementType;
  /** Panel headings use this; field names and status strings do not. */
  readonly strong?: boolean;
  /** Associates the label with a control, when rendered `as="label"`. */
  readonly htmlFor?: string;
  readonly id?: string;
}

/**
 * Kern's one text treatment for field labels, panel headers, and status
 * strings: IBM Plex Mono, uppercase, 10px, `0.09em` tracking.
 *
 * A primitive rather than three repeated declarations — the direction applies
 * this to every label in the product, so the token pair
 * (`--label-size`/`--label-letter-spacing`) and the uppercase transform live in
 * exactly one place and change in one edit.
 *
 * NOT `text-transform` applied to translated copy carelessly: uppercase is a
 * presentational transform here, so the accessible name a screen reader
 * announces is the original mixed-case string, not the shouted form.
 *
 * Source: templates/kern-grid/IMPLEMENTATION.md, section 1 ("One new token pair").
 */
export function Label({ children, as, strong = false, htmlFor, id }: LabelProps) {
  const Component = as ?? 'span';

  return (
    <Component
      className={classNames(styles['label'], strong ? styles['strong'] : undefined)}
      htmlFor={htmlFor}
      id={id}
    >
      {children}
    </Component>
  );
}
