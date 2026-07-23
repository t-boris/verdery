'use client';

import { useLocalization } from '@/shared/localization/public';
import { StatusPill, type StatusTone } from '@/shared/ui/public';

import styles from './map-save-status.module.css';
import { SAVE_STATUS_LABEL_KEY, type SaveStatus } from './save-status';

export interface MapSaveStatusProps {
  readonly status: SaveStatus;
}

const TONE: Readonly<Record<Exclude<SaveStatus, 'idle'>, StatusTone>> = {
  saving: 'neutral',
  saved: 'positive',
  failed: 'negative',
};

/**
 * Persistent save-state indicator, distinct from the transient status toast
 * `map-editor.tsx` already renders from `editor-store.tsx`'s `StatusMessage`
 * (shown once per command, then gone). Renders nothing for `idle` — no
 * command has been submitted yet this session — and otherwise shows
 * "Saving…", "Saved", or "Not saved" persistently until the *next* command
 * settles; see `save-status.ts`'s doc comment for why `SaveStatus` already
 * carries that persistence for free.
 *
 * `aria-live="polite"` announces a transition (saving → saved, saving →
 * failed) without interrupting the user, matching the live-region pattern
 * `map-editor.tsx` already uses for its own status announcements.
 */
export function MapSaveStatus({ status }: MapSaveStatusProps) {
  const { t } = useLocalization();

  if (status === 'idle') {
    return null;
  }

  return (
    <div className={styles['status']} aria-live="polite">
      <StatusPill tone={TONE[status]} label={t(SAVE_STATUS_LABEL_KEY[status])} />
    </div>
  );
}
