'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert, StatusPill, TextField } from '@/shared/ui/public';

import { lifecycleLabel, roleLabel } from './labels';
import styles from './garden-settings.module.css';
import { useArchiveGarden, useGarden, useRenameGarden, useRequestGardenDeletion } from './queries';

const renameSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

type RenameValues = z.infer<typeof renameSchema>;

/**
 * A single garden: its current state, and — for the owner only — the
 * commands that change it. A non-owner sees the same page with those
 * commands absent; the server enforces the same restriction independently,
 * so hiding the controls here is a usability choice, not the security
 * boundary.
 *
 * Source: implementation-plan.md work package P2-WEB-01, P2-SEC-01.
 */
export function GardenSettings({ gardenId }: { readonly gardenId: string }) {
  const { t } = useLocalization();
  const router = useRouter();
  const query = useGarden(gardenId);
  const renameMutation = useRenameGarden(gardenId);
  const archiveMutation = useArchiveGarden(gardenId);
  const deletionMutation = useRequestGardenDeletion(gardenId);

  const { register, handleSubmit, formState } = useForm<RenameValues>({
    resolver: zodResolver(renameSchema),
    ...(query.data === undefined ? {} : { values: { name: query.data.name } }),
  });

  // Redirects back once deletion has been requested: this page has nothing
  // further a member can do here, and the list already reflects the new state.
  useEffect(() => {
    if (query.data?.lifecycleState === 'deletionRequested') {
      router.push('/application/gardens');
    }
  }, [query.data?.lifecycleState, router]);

  if (query.isPending) {
    return <p role="status">{t('gardens.loading')}</p>;
  }

  if (query.isError) {
    return <FailureAlert failure={query.error.failure} />;
  }

  const garden = query.data;
  const isOwner = garden.callerRole === 'owner';

  const onRename = handleSubmit((values) => {
    if (values['name'] === garden.name) {
      return;
    }
    renameMutation.mutate({ name: values['name'], expectedRevision: garden.revision });
  });

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
    <div className={styles['page']}>
      <div className={styles['summary']}>
        <h2 className={styles['name']}>{garden.name}</h2>
        <StatusPill
          tone={garden.lifecycleState === 'active' ? 'positive' : 'neutral'}
          label={t(lifecycleLabel(garden.lifecycleState))}
        />
        <span>{t(roleLabel(garden.callerRole))}</span>
      </div>

      {isOwner && (
        <Card title={t('gardens.renameTitle')}>
          <form
            className={styles['renameForm']}
            onSubmit={(event) => void onRename(event)}
            noValidate
          >
            <TextField
              label={t('gardens.createNameLabel')}
              maxLength={120}
              disabled={garden.lifecycleState !== 'active'}
              error={formState.errors.name === undefined ? undefined : t('gardens.nameRequired')}
              {...register('name')}
            />
            <Button type="submit" variant="primary" busy={renameMutation.isPending}>
              {t('gardens.rename')}
            </Button>
          </form>
          {renameMutation.isError && <FailureAlert failure={renameMutation.error.failure} />}
        </Card>
      )}

      {isOwner && garden.lifecycleState === 'active' && (
        <Card title={t('gardens.manageTitle')}>
          <div className={styles['actions']}>
            <Button variant="secondary" busy={archiveMutation.isPending} onClick={onArchive}>
              {t('gardens.archive')}
            </Button>
            <Button
              variant="secondary"
              busy={deletionMutation.isPending}
              onClick={onRequestDeletion}
            >
              {t('gardens.requestDeletion')}
            </Button>
          </div>
          {archiveMutation.isError && <FailureAlert failure={archiveMutation.error.failure} />}
          {deletionMutation.isError && <FailureAlert failure={deletionMutation.error.failure} />}
        </Card>
      )}

      {isOwner && garden.lifecycleState === 'archived' && (
        <Card title={t('gardens.manageTitle')}>
          <div className={styles['actions']}>
            <Button
              variant="secondary"
              busy={deletionMutation.isPending}
              onClick={onRequestDeletion}
            >
              {t('gardens.requestDeletion')}
            </Button>
          </div>
          {deletionMutation.isError && <FailureAlert failure={deletionMutation.error.failure} />}
        </Card>
      )}
    </div>
  );
}
