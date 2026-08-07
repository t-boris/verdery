'use client';

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

export interface CommandSurfaceProps {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly onCommit: () => void | Promise<void>;
}

/**
 * A non-form command surface that keeps mouse and keyboard submission.
 * Buttons with `type="submit"` commit the command, while Enter from a text
 * input commits the current values. Textareas and selects retain their own
 * native Enter behavior.
 */
export function CommandSurface({ children, className, onCommit }: CommandSurfaceProps) {
  const commit = () => {
    void onCommit();
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const submitButton = event.target.closest('button[type="submit"]');
    if (submitButton !== null && event.currentTarget.contains(submitButton)) {
      commit();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    if (
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLButtonElement
    ) {
      return;
    }
    event.preventDefault();
    commit();
  };

  return (
    <div className={className} onClick={onClick} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
