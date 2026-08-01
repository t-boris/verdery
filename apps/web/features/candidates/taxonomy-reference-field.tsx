'use client';

import type { TaxonomyReference } from '@verdery/api-contracts';
import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Select, TextField } from '@/shared/ui/public';

import styles from './taxonomy-reference-field.module.css';
import { useTaxonomyReferenceSearch } from './taxonomy-queries';

export interface TaxonomyReferenceFieldProps {
  readonly gardenId: string;
  readonly value: string | null;
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
 * catalog `AddCandidate`/`UpdateCandidateDetails` callers pick
 * `taxonomyReferenceId` from. Duplicates
 * `features/plants/taxonomy-reference-field.tsx` verbatim rather than
 * importing it — see `taxonomy-queries.ts`'s own doc comment for why.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `searchTaxonomyReferences`.
 */
export function TaxonomyReferenceField({ gardenId, value, onChange }: TaxonomyReferenceFieldProps) {
  const { t } = useLocalization();
  const [query, setQuery] = useState('');
  const search = useTaxonomyReferenceSearch(gardenId, query);
  const matches = search.data?.items ?? [];

  return (
    <div className={styles['field']}>
      <TextField
        label={t('candidates.taxonomySearchLabel')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Select
        label={t('candidates.taxonomySelectLabel')}
        value={value ?? NONE_VALUE}
        onChange={(event) =>
          onChange(event.target.value === NONE_VALUE ? null : event.target.value)
        }
        options={[
          { value: NONE_VALUE, label: t('candidates.taxonomyNone') },
          ...matches.map((reference) => ({
            value: reference.id,
            label: taxonomyReferenceLabel(reference),
          })),
        ]}
      />
      {search.isError && <p className={styles['hint']}>{t('candidates.taxonomySearchFailed')}</p>}
    </div>
  );
}
