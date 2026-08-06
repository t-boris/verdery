'use client';

import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert } from '@/shared/ui/public';

import { useArchiveGarden, useGarden, useRequestGardenDeletion } from './queries';
import styles from './garden-settings.module.css';

/**
 * Archiving and requesting deletion, at the BOTTOM of the garden's overview.
 *
 * These used to sit in the second band of the page, above the location, the
 * property plan and everyone who works on the garden — which is to say the
 * two irreversible actions were the second thing an owner saw every time
 * (reported 2026-08-06). Nothing about them belongs near the top: they are
 * rare, they are destructive, and a page reads as a sequence of decreasing
 * frequency.
 *
 * Split out of `garden-settings.tsx` rather than moved with it, because the
 * identity of the garden — its name, its state, the caller's role — genuinely
 * does belong first. Both read the same cached `useGarden` query, so the
 * split costs no extra request.
 */
export function GardenDangerZone({ gardenId }: { readonly gardenId: string }) {
  const { t } = useLocalization();
  const query = useGarden(gardenId);
  const archiveMutation = useArchiveGarden(gardenId);
  const deletionMutation = useRequestGardenDeletion(gardenId);

  const garden = query.data;
  if (garden === undefined || garden.callerRole !== 'owner') {
    return null;
  }

  const onArchive = () => {
    if (globalThis.confirm(t('gardens.archiveConfirm'))) {
      archiveMutation.mutate(garden.revision);
    }
  };

  const onRequestDeletion = () => {
    if (globalThis.confirm(t('gardens.requestDeletionConfirm'))) {
      deletionMutation.mutate(garden.revision);
    }
  };

  return (
    <Card title={t('gardens.manageTitle')}>
      <div className={styles['actions']}>
        {garden.lifecycleState === 'active' && (
          <Button variant="secondary" busy={archiveMutation.isPending} onClick={onArchive}>
            {t('gardens.archive')}
          </Button>
        )}
        <Button variant="destructive" busy={deletionMutation.isPending} onClick={onRequestDeletion}>
          {t('gardens.requestDeletion')}
        </Button>
      </div>
      {archiveMutation.isError && <FailureAlert failure={archiveMutation.error.failure} />}
      {deletionMutation.isError && <FailureAlert failure={deletionMutation.error.failure} />}
    </Card>
  );
}
