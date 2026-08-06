'use client';

import { useState } from 'react';

import type { WireAerialTracingResult } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, CloseIcon } from '@/shared/ui/public';

import { categoryLabelKey } from './labels';
import styles from './aerial-tracing-panel.module.css';
import type { MapEditorActions } from './use-map-editor-actions';

export function AerialTracingPanel({
  tracing,
  actions,
  onDismiss,
}: {
  readonly tracing: WireAerialTracingResult;
  readonly actions: MapEditorActions;
  readonly onDismiss: () => void;
}) {
  const { t, locale } = useLocalization();
  const number = (value: number, digits = 0) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  const [selected, setSelected] = useState<readonly number[]>(
    tracing.proposals.map((_, index) => index),
  );
  const [saving, setSaving] = useState(false);

  const accept = async () => {
    setSaving(true);
    const created = await actions.acceptAerialProposals(tracing, selected);
    setSaving(false);
    if (created > 0) onDismiss();
  };

  return (
    <section className={styles['panel']} aria-label={t('map.aerial.reviewTitle')}>
      <div className={styles['header']}>
        <strong>{t('map.aerial.reviewTitle')}</strong>
        <Button
          iconOnly
          variant="secondary"
          aria-label={t('map.aerial.dismiss')}
          onClick={onDismiss}
        >
          <CloseIcon />
        </Button>
      </div>
      {tracing.proposals.length === 0 ? (
        <p>{t('map.aerial.noObjects')}</p>
      ) : (
        <ul className={styles['list']}>
          {tracing.proposals.map((proposal, index) => (
            <li key={`${proposal.category}-${String(index)}`}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(index)}
                  onChange={(event) => {
                    // React clears SyntheticEvent.currentTarget after this
                    // handler returns. Capture the primitive before the state
                    // updater runs so selecting a proposal cannot dereference
                    // a null currentTarget.
                    const checked = event.currentTarget.checked;
                    setSelected((current) =>
                      checked ? [...current, index] : current.filter((value) => value !== index),
                    );
                  }}
                />
                <span>
                  {proposal.label || t(categoryLabelKey(proposal.category))}
                  <small>
                    {t(`map.aerial.evidence.${proposal.evidence}`)} ·{' '}
                    {number(proposal.confidence * 100, 0)}%
                  </small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className={styles['disclaimer']}>{t('map.aerial.disclaimer')}</p>
      <Button
        variant="primary"
        busy={saving}
        disabled={selected.length === 0}
        onClick={() => void accept()}
      >
        {t('map.aerial.addSelected', { count: String(selected.length) })}
      </Button>
    </section>
  );
}
