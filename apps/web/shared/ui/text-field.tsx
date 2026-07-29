import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

import styles from './text-field.module.css';

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'className'
> {
  readonly label: string;
  /** Shown and announced when present; absence means the field is currently valid. */
  readonly error?: string | undefined;
  /** Decorative reinforcement of `label`, e.g. one of `shared/ui/icons.tsx`'s icons — never the field's only name, since every icon there is already `aria-hidden`. */
  readonly icon?: ReactNode;
}

/**
 * Labeled text input with an accessibly associated error message.
 *
 * `aria-invalid` and `aria-describedby` are wired from `error` alone, so a
 * form cannot show a red border without also exposing the reason to
 * assistive technology.
 *
 * Source: architecture/web-application-design.md, section "11. Forms and Validation".
 */
export function TextField({ label, error, icon, ...inputProps }: TextFieldProps) {
  const inputId = useId();
  const errorId = useId();

  return (
    <div className={styles['field']}>
      <label className={styles['label']} htmlFor={inputId}>
        {icon !== undefined && <span className={styles['labelIcon']}>{icon}</span>}
        {label}
      </label>
      <input
        {...inputProps}
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
