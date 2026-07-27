'use client';

import type { GardenContextKind } from '@verdery/api-contracts';
import { useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, Select, TextField } from '@/shared/ui/public';

import { contextValueOptions } from './labels';
import { useRecordGardenContextFact } from './queries';
import styles from './context-fact-edit-form.module.css';

export interface ContextFactEditFormProps {
  readonly gardenId: string;
  readonly contextKind: GardenContextKind;
  /** The currently declared value, or `null` when this kind has never been recorded. */
  readonly currentValue: string | null;
  readonly onDone: () => void;
}

/**
 * The edit panel for one context fact: a single value field — a `<select>`
 * for the four kinds with a fixed vocabulary, free text for `soil_type`/
 * `microclimate` — and the record command.
 *
 * A `useState`-managed field rather than React Hook Form: one field, the
 * same shortcut `postpone-form.tsx` takes for the identical reason (see
 * that file's own doc comment).
 *
 * `source` is always sent as `'user_declared'`, never exposed as a picker:
 * an ordinary member using this form IS declaring the fact themselves, by
 * definition — `'horticulturally_reviewed_default'` and `'imported'`
 * describe how OTHER pipelines populated a fact, not a choice this form
 * offers. This is the most conservative reading of an underspecified brief
 * ("editable via the existing PUT route" says nothing about who may set
 * which source), consistent with `RecordGardenContextFact`'s own
 * capability check, which governs editing at all but not which source a
 * caller may claim.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `GardenContext`.
 */
export function ContextFactEditForm({
  gardenId,
  contextKind,
  currentValue,
  onDone,
}: ContextFactEditFormProps) {
  const { t } = useLocalization();
  const isOnline = useIsOnline();
  const options = contextValueOptions(contextKind);
  const [value, setValue] = useState(currentValue ?? options?.[0]?.value ?? '');
  const [showRequiredError, setShowRequiredError] = useState(false);
  const mutation = useRecordGardenContextFact(gardenId);

  const onSubmit = () => {
    const trimmed = value.trim();
    if (trimmed === '') {
      setShowRequiredError(true);
      return;
    }
    setShowRequiredError(false);
    mutation.mutate(
      { contextKind, input: { value: trimmed, source: 'user_declared' } },
      { onSuccess: () => onDone() },
    );
  };

  return (
    <div className={styles['form']}>
      {options === null ? (
        <TextField
          label={t('contextQuality.valueLabel')}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          error={showRequiredError ? t('contextQuality.valueRequired') : undefined}
        />
      ) : (
        <Select
          label={t('contextQuality.valueLabel')}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          options={options.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
        />
      )}
      <div className={styles['actions']}>
        <Button variant="primary" busy={mutation.isPending} disabled={!isOnline} onClick={onSubmit}>
          {t('contextQuality.save')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('contextQuality.cancelEdit')}
        </Button>
      </div>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </div>
  );
}
