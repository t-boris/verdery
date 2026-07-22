import type { ButtonHTMLAttributes, ReactNode } from 'react';

import styles from './button.module.css';
import { classNames } from './class-names';

export type ButtonVariant = 'primary' | 'secondary';

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'children'
> {
  readonly variant?: ButtonVariant;
  /** True while the action this button started is still running. */
  readonly busy?: boolean;
  readonly children: ReactNode;
}

/**
 * Primitive button.
 *
 * A busy button stays focusable and keeps its accessible name instead of using
 * the `disabled` attribute, because a disabled control is removed from the tab
 * order and screen readers stop announcing the state change. The click is
 * suppressed in the handler instead.
 *
 * Source: architecture/web-application-design.md, section "14. Accessibility".
 */
export function Button({
  variant = 'secondary',
  busy = false,
  type = 'button',
  onClick,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={classNames(styles['button'], styles[variant])}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={busy ? undefined : onClick}
    >
      {children}
    </button>
  );
}
