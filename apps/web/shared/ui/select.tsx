import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';

import styles from './select.module.css';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'id' | 'className' | 'children'
> {
  readonly label: string;
  readonly options: readonly SelectOption[];
  /** Shown and announced when present; absence means the field is currently valid. */
  readonly error?: string | undefined;
}

/**
 * Labeled enum picker.
 *
 * A closed set of options is a `<select>` rather than a text field so an
 * invalid enum value cannot be typed in the first place — the category-detail
 * forms in `features/map` are its first users (`structureKind`, `fenceKind`,
 * and the like).
 *
 * Source: architecture/web-application-design.md, section "11. Forms and Validation".
 */
export function Select({ label, options, error, ...selectProps }: SelectProps): ReactNode {
  const selectId = useId();
  const errorId = useId();

  return (
    <div className={styles['field']}>
      <label className={styles['label']} htmlFor={selectId}>
        {label}
      </label>
      <select
        {...selectProps}
        id={selectId}
        className={styles['select']}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error !== undefined && (
        <p id={errorId} className={styles['error']} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
