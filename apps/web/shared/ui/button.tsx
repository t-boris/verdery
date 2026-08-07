import type { ButtonHTMLAttributes, ReactNode } from 'react';

import styles from './button.module.css';
import { classNames } from './class-names';
import { ArrowRightIcon } from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'children'
> {
  readonly variant?: ButtonVariant;
  /** True while the action this button started is still running. */
  readonly busy?: boolean;
  /**
   * Render as a square icon control, the map rail's shape: exactly
   * `--control-min-size` on both axes, no visible text.
   *
   * `aria-label` becomes REQUIRED in practice — every icon in `icons.tsx` is
   * `aria-hidden`, so without one the button would have no accessible name at
   * all. Pass `title` too: it is the only way a pointer user learns what the
   * icon means, and `e2e/keyboard.spec.ts` already asserts that contract for
   * the rail's own buttons.
   */
  readonly iconOnly?: boolean;
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
  iconOnly = false,
  type = 'button',
  onClick,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={classNames(
        styles['button'],
        styles[variant],
        iconOnly ? styles['iconOnly'] : undefined,
      )}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={busy ? undefined : onClick}
    >
      {children}
      {variant === 'primary' && typeof children === 'string' && !iconOnly && (
        <span className={styles['defaultIcon']}>
          <ArrowRightIcon size={14} />
        </span>
      )}
    </button>
  );
}
