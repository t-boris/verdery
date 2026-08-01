'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useLocalization } from '@/shared/localization/public';

import { Label } from './label';
import styles from './status-bar.module.css';

/** One `label: value` readout. `value` absent means the field is not applicable right now and is omitted entirely rather than shown empty. */
export interface StatusBarField {
  readonly label: string;
  readonly value: string | null;
}

export interface StatusBarProps {
  /**
   * Readouts shown at the leading edge, in order. Every one is optional
   * because the bar is mounted by the application shell on EVERY route, not
   * only the map editor — a route with no tool or selection simply passes
   * none, and the disclosure still shows.
   */
  readonly fields?: readonly StatusBarField[];
}

const StatusBarFieldsContext = createContext<{
  readonly fields: readonly StatusBarField[];
  readonly publish: (fields: readonly StatusBarField[]) => void;
} | null>(null);

/**
 * Lets a route publish readouts into the shell's footer, which is mounted
 * above it and cannot receive them as props.
 *
 * A context rather than a store: the values are ephemeral view state owned by
 * whichever route is mounted, they never outlive it, and nothing else reads
 * them. It lives in `shared/ui` beside `StatusBar` because a FEATURE may not
 * import from `app/` (architecture doc, "20. Dependency Rules") and the map
 * editor is the first publisher.
 */
export function StatusBarFieldsProvider({ children }: { readonly children: ReactNode }) {
  const [fields, publish] = useState<readonly StatusBarField[]>([]);
  const value = useMemo(() => ({ fields, publish }), [fields]);

  return (
    <StatusBarFieldsContext.Provider value={value}>{children}</StatusBarFieldsContext.Provider>
  );
}

/**
 * Publishes `fields` while the calling component is mounted, and clears them
 * on unmount so a stale tool or selection can never outlive the route that
 * set it.
 *
 * A no-op outside a provider, so a component using it stays renderable in a
 * test or a preview without extra scaffolding.
 */
export function usePublishStatusBarFields(fields: readonly StatusBarField[]): void {
  const context = useContext(StatusBarFieldsContext);
  const publish = context?.publish;
  // Serialized rather than compared by reference: callers build this array
  // inline every render, so an identity check would republish every frame.
  const serialized = JSON.stringify(fields);

  useEffect(() => {
    if (publish === undefined) {
      return;
    }
    publish(JSON.parse(serialized) as readonly StatusBarField[]);
    return () => publish([]);
  }, [publish, serialized]);
}

/**
 * The application's permanent 24px footer: contextual readouts on the left,
 * and the planning-accuracy disclosure pinned to the right.
 *
 * WHY THE DISCLOSURE LIVES HERE. It replaces `MapDisclosureBanner`, which
 * stated the same thing as a dismissible banner above the canvas and had two
 * problems this fixes: it could be dismissed, and it existed only on the map
 * editor — yet every measurement the product shows anywhere (a bed's area in
 * the plant library, a distance on a task) carries the same caveat. A
 * permanent bar states it once, everywhere, and cannot be turned off. That
 * banner and its `map.disclosure.dismiss` string are deleted, not merely
 * unmounted; `map.disclosure.text` survives as the full sentence below.
 *
 * The short form is used here because the bar is 24px tall; the full sentence
 * remains the element's `title` and its accessible name, so nothing is lost to
 * a screen reader or to a user who hovers.
 *
 * Source: templates/kern-grid/IMPLEMENTATION.md, section 2 ("Application shell").
 */
export function StatusBar({ fields }: StatusBarProps) {
  const { t } = useLocalization();
  const context = useContext(StatusBarFieldsContext);
  const full = t('map.disclosure.text');
  // An explicit `fields` prop wins; otherwise whatever the mounted route published.
  const resolved = fields ?? context?.fields ?? [];

  return (
    <div className={styles['bar']} role="status" aria-live="off">
      {resolved
        .filter((field): field is StatusBarField & { value: string } => field.value !== null)
        .map((field) => (
          <span key={field.label} className={styles['field']}>
            <Label>{field.label}</Label>
            <span className={styles['value']}>{field.value}</span>
          </span>
        ))}

      <span className={styles['disclosure']} title={full}>
        <Label>{t('statusBar.disclosure')}</Label>
      </span>
    </div>
  );
}
