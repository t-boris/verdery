'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, TextField } from '@/shared/ui/public';

import styles from './open-plant-by-id-form.module.css';

/**
 * Navigates to a known plant's detail page.
 *
 * `plant-list.tsx` now backs a real inventory browse against `SearchPlants`
 * (P4-SEARCH-01), so this form is no longer this page's only way to reach a
 * plant — it stays as a direct shortcut for a plant id already known from
 * elsewhere (e.g. a link shared outside the app), where browsing the whole
 * list first would be unnecessary. It performs no lookup of its own; the
 * destination page's own `GetPlant` call is what proves — or disproves —
 * that the id is real.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Plants`.
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
