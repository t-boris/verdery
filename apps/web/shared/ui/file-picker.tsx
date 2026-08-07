'use client';

import { useId, useState, type ChangeEvent } from 'react';

import { ImageIcon, PlusIcon } from './icons';
import styles from './file-picker.module.css';

export interface FilePickerProps {
  readonly label: string;
  /** Shown on the button itself, e.g. "Choose a photo". */
  readonly action: string;
  /** What is shown before anything is chosen, e.g. "No file chosen". */
  readonly emptyText: string;
  readonly accept?: string;
  readonly disabled?: boolean;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Shown and announced when present. */
  readonly error?: string | undefined;
}

/**
 * A file input that looks like the rest of the application.
 *
 * A bare `<input type="file">` renders the operating system's own button —
 * grey, square, differently sized in every browser — which is why the upload
 * panels were the one place a Verdery screen suddenly looked like a 2004 web
 * form. The native control is still what the browser opens: it is present and
 * focusable, only visually replaced by a label that carries the button's own
 * styling, which is the accessible way to do this. Clicking the label
 * activates the input; keyboard focus lands on the input and shows the focus
 * ring on the label through `:focus-within`.
 *
 * The chosen file's name is shown beside the button, because a picker that
 * forgets what you picked makes you open the dialog again to check.
 *
 * Source: architecture/web-application-design.md, section "14. Accessibility".
 */
export function FilePicker({
  label,
  action,
  emptyText,
  accept,
  disabled = false,
  onChange,
  error,
}: FilePickerProps) {
  const inputId = useId();
  const errorId = useId();
  const [chosenName, setChosenName] = useState<string | null>(null);

  return (
    <div className={styles['picker']}>
      <label className={styles['control']} htmlFor={inputId}>
        <input
          id={inputId}
          className={styles['input']}
          type="file"
          aria-label={label}
          aria-description={chosenName ?? emptyText}
          {...(accept === undefined ? {} : { accept })}
          disabled={disabled}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : errorId}
          onChange={(event) => {
            setChosenName(event.target.files?.[0]?.name ?? null);
            onChange(event);
          }}
        />
        <span className={styles['mediaIcon']} aria-hidden="true">
          <ImageIcon size={22} />
        </span>
        <span className={styles['copy']}>
          <strong>{chosenName ?? label}</strong>
          <span>{action}</span>
        </span>
        <span className={styles['actionIcon']} aria-hidden="true">
          <PlusIcon />
        </span>
      </label>
      {error !== undefined && (
        <p id={errorId} className={styles['error']} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
