'use client';

import type { TaxonomyReference } from '@verdery/api-contracts';
import { useEffect, useMemo, useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Select, TextField } from '@/shared/ui/public';

import { useTaxonomyReferenceSearch } from './queries';
import styles from './taxonomy-reference-field.module.css';

export interface TaxonomyReferenceFieldProps {
  readonly gardenId: string;
  readonly value: string | null;
  readonly initialSelectionLabel?: string;
  readonly onChange: (taxonomyReferenceId: string | null) => void;
}

const NONE_VALUE = '';

function taxonomyReferenceLabel(reference: TaxonomyReference): string {
  const parts = [reference.scientificName];
  if (reference.commonName !== null) {
    parts.push(`(${reference.commonName})`);
  }
  if (reference.varietyName !== null) {
    parts.push(`— ${reference.varietyName}`);
  }
  return parts.join(' ');
}

/**
 * Search-select over `GET /gardens/{gardenId}/taxonomy-references`, the
 * catalog `AddPlant`/`UpdatePlantDetails` callers pick `taxonomyReferenceId`
 * from. A free-text query narrows the catalog; the result set is then a
 * native `<select>`, so choosing a match stays one accessible, keyboard-
 * operable control rather than a hand-rolled combobox widget.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `searchTaxonomyReferences`.
 */
export function TaxonomyReferenceField({
  gardenId,
  value,
  initialSelectionLabel,
  onChange,
}: TaxonomyReferenceFieldProps) {
  const { t } = useLocalization();
  const [query, setQuery] = useState(initialSelectionLabel ?? '');
  const [selectedLabel, setSelectedLabel] = useState<string | null>(initialSelectionLabel ?? null);
  const search = useTaxonomyReferenceSearch(gardenId, query);
  const matches = search.data?.items ?? [];
  const selectedMatch = matches.find((reference) => reference.id === value);

  useEffect(() => {
    if (value === null) {
      setSelectedLabel(null);
      return;
    }
    if (selectedMatch !== undefined) {
      setSelectedLabel(taxonomyReferenceLabel(selectedMatch));
      return;
    }
    if (initialSelectionLabel !== undefined) {
      setSelectedLabel(initialSelectionLabel);
      setQuery(initialSelectionLabel);
    }
  }, [initialSelectionLabel, selectedMatch, value]);

  const options = useMemo(
    () => [
      { value: NONE_VALUE, label: t('plants.taxonomyNone') },
      ...(value !== null && selectedMatch === undefined
        ? [{ value, label: selectedLabel ?? initialSelectionLabel ?? value }]
        : []),
      ...matches.map((reference) => ({
        value: reference.id,
        label: taxonomyReferenceLabel(reference),
      })),
    ],
    [initialSelectionLabel, matches, selectedLabel, selectedMatch, t, value],
  );

  return (
    <div className={styles['field']}>
      <TextField
        label={t('plants.taxonomySearchLabel')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Select
        label={t('plants.taxonomySelectLabel')}
        value={value ?? NONE_VALUE}
        onChange={(event) => {
          const nextValue = event.target.value === NONE_VALUE ? null : event.target.value;
          const nextMatch = matches.find((reference) => reference.id === nextValue);
          setSelectedLabel(nextMatch === undefined ? null : taxonomyReferenceLabel(nextMatch));
          onChange(nextValue);
        }}
        options={options}
      />
      {search.isError && <p className={styles['hint']}>{t('plants.taxonomySearchFailed')}</p>}
    </div>
  );
}
