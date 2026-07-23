'use client';

import { useLocalization } from '@/shared/localization/public';

import { Alert } from './alert';
import { Button } from './button';

export interface RecoveredDraftNoticeProps {
  readonly onDiscard: () => void;
}

/**
 * Shown after `core/drafts`' `useRecoverableDraft` restores a local draft on
 * mount, so recovered field values are never mistaken for a server-confirmed
 * state — architecture doc section "9. Online-First Behavior" ("The
 * interface never displays a server-confirmed state before confirmation"); a
 * local draft is unconfirmed by definition. See that hook's own doc comment
 * for why restoring happens automatically rather than behind a prompt — this
 * notice, plus the explicit discard action, is what keeps that automatic
 * restore honest and reversible.
 */
export function RecoveredDraftNotice({ onDiscard }: RecoveredDraftNoticeProps) {
  const { t } = useLocalization();

  return (
    <Alert tone="info" title={t('drafts.recoveredTitle')}>
      <p>{t('drafts.recoveredDescription')}</p>
      <Button type="button" variant="secondary" onClick={onDiscard}>
        {t('drafts.discard')}
      </Button>
    </Alert>
  );
}
