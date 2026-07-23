'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, TextField } from '@/shared/ui/public';

import styles from './open-plant-by-id-form.module.css';

/**
 * Navigates to a known plant's detail page.
 *
 * The contract has no `GET /gardens/{gardenId}/plants` list operation (only
 * single-plant `GetPlant`), so this feature cannot offer a real inventory
 * list — inventing a client-side aggregation without a backing endpoint
 * would misrepresent what the API actually returns. This form is the honest
 * alternative: it performs no lookup of its own and fabricates nothing, it
 * only navigates, and the destination page's own `GetPlant` call is what
 * proves — or disproves — that the id is real.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Plants` (no list operation).
 */
export function OpenPlantByIdForm({ gardenId }: { readonly gardenId: string }) {
  const { t } = useLocalization();
  const router = useRouter();
  const [plantId, setPlantId] = useState('');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = plantId.trim();
    if (trimmed === '') {
      return;
    }
    router.push(`/application/gardens/${gardenId}/plants/${trimmed}`);
  };

  return (
    <form className={styles['form']} onSubmit={onSubmit} noValidate>
      <TextField
        label={t('plants.openByIdLabel')}
        value={plantId}
        onChange={(event) => setPlantId(event.target.value)}
      />
      <Button type="submit" variant="secondary">
        {t('plants.openByIdSubmit')}
      </Button>
    </form>
  );
}
