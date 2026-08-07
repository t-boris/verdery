'use client';

import type { TaxonomyReference } from '@verdery/api-contracts';
import { useEffect, useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { SproutIcon, TextField } from '@/shared/ui/public';

import { useTaxonomyReferenceSearch } from './queries';
import styles from './taxonomy-reference-field.module.css';

export interface TaxonomyReferenceFieldProps {
  readonly gardenId: string;
  readonly value: string | null;
  readonly initialSelectionLabel?: string;
  readonly onChange: (taxonomyReferenceId: string | null) => void;
}

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
 * a compact set of direct choices. This keeps the catalog interaction visual
 * and avoids opening a system dropdown that clashes with the application.
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

  return (
    <div className={styles['field']}>
      <TextField
        label={t('plants.taxonomySearchLabel')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className={styles['results']} aria-label={t('plants.taxonomySelectLabel')}>
        <button type="button" aria-pressed={value === null} onClick={() => onChange(null)}>
          <SproutIcon />
          {t('plants.taxonomyNone')}
        </button>
        {value !== null && selectedMatch === undefined && (
          <button type="button" aria-pressed="true" onClick={() => onChange(value)}>
            <SproutIcon />
            {selectedLabel ?? initialSelectionLabel ?? value}
          </button>
        )}
        {matches.map((reference) => {
          const label = taxonomyReferenceLabel(reference);
          return (
            <button
              key={reference.id}
              type="button"
              aria-pressed={value === reference.id}
              onClick={() => {
                setSelectedLabel(label);
                onChange(reference.id);
              }}
            >
              <SproutIcon />
              {label}
            </button>
          );
        })}
      </div>
      {search.isError && <p className={styles['hint']}>{t('plants.taxonomySearchFailed')}</p>}
    </div>
  );
}
