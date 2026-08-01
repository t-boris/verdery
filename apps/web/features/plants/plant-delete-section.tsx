'use client';

import type { Plant, PlantStatus } from '@verdery/api-contracts';
import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Alert, Button, FailureAlert } from '@/shared/ui/public';
import { TrashIcon } from '@/shared/ui/public';

import { useSetPlantStatus } from './queries';

export interface PlantDeleteSectionProps {
  readonly gardenId: string;
  readonly plant: Plant;
}

const DELETE_STATUS: PlantStatus = 'removed';

/**
 * Delete, in its own destructive-toned section — it used to be a plain
 * `variant="secondary"` button at the bottom of `PlantLifecycleControls`,
 * indistinguishable from the unrelated Save Stage/Save Status actions above
 * it. Still `SetPlantStatus('removed')`, never a hard delete — there is no
 * hard-delete command for a plant, the same status-transition-as-delete
 * pattern `features/gardens/garden-settings.tsx` uses for archive/deletion.
 *
 * `Alert tone="danger"` (`shared/ui/alert.tsx`) is the same negative-tinted
 * frame `garden-settings.tsx`'s own destructive `Card` establishes visually,
 * reused here rather than a bespoke style. Disabled while offline, the same
 * `disabled={!isOnline}` reasoning `PlantLifecycleControls` documents for its
 * own actions.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `setPlantStatus`.
 */
export function PlantDeleteSection({ gardenId, plant }: PlantDeleteSectionProps) {
  const { t } = useLocalization();
  const mutation = useSetPlantStatus(gardenId, plant.id);
  const isOnline = useIsOnline();

  const onDelete = () => {
    if (globalThis.confirm(t('plants.deleteConfirm'))) {
      mutation.mutate({ status: DELETE_STATUS, expectedRevision: plant.revision });
    }
  };

  return (
    <Alert tone="danger" title={t('plants.deleteSectionTitle')}>
      <Button
        variant="destructive"
        busy={mutation.isPending}
        disabled={!isOnline}
        onClick={onDelete}
      >
        <TrashIcon />
        {t('plants.delete')}
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </Alert>
  );
}
