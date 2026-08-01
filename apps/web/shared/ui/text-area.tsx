import { useId, type ReactNode, type TextareaHTMLAttributes } from 'react';

import styles from './text-area.module.css';

export interface TextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id' | 'className'
> {
  readonly label: string;
  /** Shown and announced when present; absence means the field is currently valid. */
  readonly error?: string | undefined;
  /** Decorative reinforcement of `label`, e.g. one of `shared/ui/icons.tsx`'s icons — never the field's only name, since every icon there is already `aria-hidden`. */
  readonly icon?: ReactNode;
}

/**
 * Labeled multi-line text input, for free-text content longer than
 * `TextField` comfortably holds (a publication summary, a withdrawal
 * reason). Structurally identical to `TextField` — same label/error/icon
 * shape, same `aria-invalid`/`aria-describedby` wiring — a `<textarea>`
 * standing in for the single-line `<input>`.
 *
 * Source: architecture/web-application-design.md, section "11. Forms and Validation".
 */
export function TextArea({ label, error, icon, ...textareaProps }: TextAreaProps) {
  const inputId = useId();
  const errorId = useId();

  return (
    <div className={styles['field']}>
      <label className={styles['label']} htmlFor={inputId}>
        {icon !== undefined && <span className={styles['labelIcon']}>{icon}</span>}
        {label}
      </label>
      <textarea
        {...textareaProps}
        id={inputId}
        className={styles['input']}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
      />
      {error !== undefined && (
        <p id={errorId} className={styles['error']} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
