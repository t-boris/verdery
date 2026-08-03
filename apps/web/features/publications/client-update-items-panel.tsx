'use client';

import type {
  AddClientUpdateItemRequest,
  ClientUpdate,
  ClientUpdateItem,
  ClientUpdateItemKind,
  Observation,
  PublicationMediaRole,
} from '@verdery/api-contracts';
import { useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { formatInstant, useLocalization, type Locale } from '@/shared/localization/public';
import { Button, FailureAlert, Select, TextField } from '@/shared/ui/public';

import styles from './client-update-items-panel.module.css';
import {
  stageableMediaOptions,
  useGardenMediaForStaging,
  useGardenObservationsForStaging,
} from './staging-queries';
import {
  CLIENT_UPDATE_ITEM_KINDS,
  PUBLICATION_MEDIA_ROLES,
  clientUpdateItemKindLabel,
  publicationMediaRoleLabel,
} from './labels';
import {
  useAddClientUpdateItem,
  useEngagementWorkLogs,
  useRemoveClientUpdateItem,
} from './queries';

function nowForDatetimeLocalInput(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  return now.toISOString().slice(0, 16);
}

export interface ClientUpdateItemsPanelProps {
  readonly engagementId: string;
  readonly update: ClientUpdate;
}

/**
 * Staged work-log/media/observation items on a draft update, plus the
 * add/remove controls — both only rendered while `state === 'internal_draft'`
 * (`ClientUpdateErrorCode.InvalidTransition` is what the server answers for
 * either mutation once the update has moved past that state, the same
 * "hide the controls once they can't succeed" posture
 * `candidate-detail.tsx` takes for a converted candidate).
 *
 * `media`/`observation` take a raw pasted id (`mediaRecordId`/
 * `sourceObservationId`) — this app has no media/observation picker
 * component yet, the same honest "no directory, paste the id" posture
 * `create-garden-assignment-form.tsx` documents for a garden id. `work_log`
 * DOES have a real picker (`useEngagementWorkLogs`), since that read
 * already exists for exactly this purpose.
 *
 * Source: packages/api-contracts/openapi.yaml, operations `addClientUpdateItem`,
 * `removeClientUpdateItem`, `listEngagementWorkLogs`.
 */
export function ClientUpdateItemsPanel({ engagementId, update }: ClientUpdateItemsPanelProps) {
  const { t } = useLocalization();
  const isDraft = update.state === 'internal_draft';

  return (
    <div className={styles['panel']}>
      {update.items.length === 0 ? (
        <p className={styles['empty']}>{t('publications.itemsEmpty')}</p>
      ) : (
        <ul className={styles['list']}>
          {update.items.map((item) => (
            <StagedItemRow
              key={item.id}
              engagementId={engagementId}
              clientUpdateId={update.id}
              item={item}
              removable={isDraft}
            />
          ))}
        </ul>
      )}

      {isDraft && (
        <AddItemForm
          engagementId={engagementId}
          clientUpdateId={update.id}
          gardenId={update.gardenId}
        />
      )}
    </div>
  );
}

function itemSummary(item: ClientUpdateItem): string {
  switch (item.kind) {
    case 'work_log':
    case 'observation':
      return item.description ?? '';
    case 'media':
      return item.caption ?? item.mediaRole ?? '';
  }
}

function StagedItemRow({
  engagementId,
  clientUpdateId,
  item,
  removable,
}: {
  readonly engagementId: string;
  readonly clientUpdateId: string;
  readonly item: ClientUpdateItem;
  readonly removable: boolean;
}) {
  const { t } = useLocalization();
  const isOnline = useIsOnline();
  const mutation = useRemoveClientUpdateItem(engagementId, clientUpdateId);

  const onRemove = () => {
    if (globalThis.confirm(t('publications.removeItemConfirm'))) {
      mutation.mutate(item.id);
    }
  };

  return (
    <li className={styles['row']}>
      <span className={styles['kind']}>{t(clientUpdateItemKindLabel(item.kind))}</span>
      <span className={styles['summary']}>{itemSummary(item)}</span>
      {removable && (
        <Button
          variant="secondary"
          busy={mutation.isPending}
          disabled={!isOnline}
          onClick={onRemove}
        >
          {t('publications.removeItem')}
        </Button>
      )}
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </li>
  );
}

/**
 * How one observation reads in the picker: when it was observed, then whatever
 * the observer wrote. Enough to recognise the right one without the publisher
 * holding an id in their head — and the note is theirs, not the client's, so
 * it never reaches a publication by being shown here.
 */
function observationOptionLabel(observation: Observation, locale: Locale): string {
  const observed = formatInstant(observation.observedAt, locale);
  const summary = observation.noteText ?? observation.conditionSummary ?? '';
  return summary === '' ? observed : `${observed} — ${summary}`;
}

function AddItemForm({
  engagementId,
  clientUpdateId,
  gardenId,
}: {
  readonly engagementId: string;
  readonly clientUpdateId: string;
  /** The update's own garden — what the media and observation pickers are scoped to. */
  readonly gardenId: string;
}) {
  const { t, locale } = useLocalization();
  const isOnline = useIsOnline();
  const mutation = useAddClientUpdateItem(engagementId, clientUpdateId);
  const workLogsQuery = useEngagementWorkLogs(engagementId);
  const observationsQuery = useGardenObservationsForStaging(gardenId);
  const mediaQuery = useGardenMediaForStaging(gardenId);
  const mediaOptions = stageableMediaOptions(mediaQuery.data);

  const [kind, setKind] = useState<ClientUpdateItemKind>('work_log');
  const [sourceWorkLogId, setSourceWorkLogId] = useState('');
  const [description, setDescription] = useState('');
  const [mediaRecordId, setMediaRecordId] = useState('');
  const [mediaRole, setMediaRole] = useState<PublicationMediaRole>('general');
  const [caption, setCaption] = useState('');
  const [sourceObservationId, setSourceObservationId] = useState('');
  const [occurredAt, setOccurredAt] = useState(nowForDatetimeLocalInput);

  const resetFields = () => {
    setSourceWorkLogId('');
    setDescription('');
    setMediaRecordId('');
    setCaption('');
    setSourceObservationId('');
    setOccurredAt(nowForDatetimeLocalInput());
  };

  const buildInput = (): AddClientUpdateItemRequest | null => {
    if (occurredAt.trim() === '') {
      return null;
    }
    const occurredAtIso = new Date(occurredAt).toISOString();

    if (kind === 'work_log') {
      if (sourceWorkLogId === '' || description.trim() === '') {
        return null;
      }
      return { kind, occurredAt: occurredAtIso, sourceWorkLogId, description: description.trim() };
    }
    if (kind === 'observation') {
      if (sourceObservationId.trim() === '' || description.trim() === '') {
        return null;
      }
      return {
        kind,
        occurredAt: occurredAtIso,
        sourceObservationId: sourceObservationId.trim(),
        description: description.trim(),
      };
    }
    if (mediaRecordId.trim() === '') {
      return null;
    }
    return {
      kind,
      occurredAt: occurredAtIso,
      mediaRecordId: mediaRecordId.trim(),
      mediaRole,
      ...(caption.trim() === '' ? {} : { caption: caption.trim() }),
    };
  };

  const input = buildInput();

  const onSubmit = () => {
    if (input === null) {
      return;
    }
    mutation.mutate(input, { onSuccess: resetFields });
  };

  return (
    <div className={styles['addForm']}>
      <h3 className={styles['addFormTitle']}>{t('publications.addItemTitle')}</h3>

      <Select
        label={t('publications.addItemKindLabel')}
        value={kind}
        onChange={(event) => setKind(event.target.value as ClientUpdateItemKind)}
        options={CLIENT_UPDATE_ITEM_KINDS.map((value) => ({
          value,
          label: t(clientUpdateItemKindLabel(value)),
        }))}
      />

      {kind === 'work_log' && (
        <>
          {workLogsQuery.data !== undefined && workLogsQuery.data.items.length === 0 ? (
            <p className={styles['hint']}>{t('publications.addItemNoEligibleWorkLogs')}</p>
          ) : (
            <Select
              label={t('publications.addItemWorkLogLabel')}
              value={sourceWorkLogId}
              onChange={(event) => setSourceWorkLogId(event.target.value)}
              options={[
                { value: '', label: t('publications.addItemWorkLogPlaceholder') },
                ...(workLogsQuery.data?.items.map((workLog) => ({
                  value: workLog.id,
                  label: workLog.description,
                })) ?? []),
              ]}
            />
          )}
          <TextField
            label={t('publications.addItemDescriptionLabel')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </>
      )}

      {kind === 'observation' && (
        <>
          {observationsQuery.data !== undefined && observationsQuery.data.items.length === 0 ? (
            <p className={styles['hint']}>{t('publications.addItemNoEligibleObservations')}</p>
          ) : (
            <Select
              label={t('publications.addItemObservationLabel')}
              value={sourceObservationId}
              onChange={(event) => setSourceObservationId(event.target.value)}
              options={[
                { value: '', label: t('publications.addItemObservationPlaceholder') },
                ...(observationsQuery.data?.items.map((observation) => ({
                  value: observation.id,
                  label: observationOptionLabel(observation, locale),
                })) ?? []),
              ]}
            />
          )}
          {/*
            The narrative is authored, never a copy of the observation's own
            note: the item's `description` is what the client reads, and the
            observation is provenance the client never sees.
          */}
          <TextField
            label={t('publications.addItemDescriptionLabel')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </>
      )}

      {kind === 'media' && (
        <>
          {mediaOptions.length === 0 ? (
            // Says which empty this is: a garden with no photographs, and one
            // whose photographs have not finished processing, are different
            // situations, and only the second resolves by waiting.
            <p className={styles['hint']}>{t('publications.addItemNoEligibleMedia')}</p>
          ) : (
            <Select
              label={t('publications.addItemMediaLabel')}
              value={mediaRecordId}
              onChange={(event) => setMediaRecordId(event.target.value)}
              options={[
                { value: '', label: t('publications.addItemMediaPlaceholder') },
                ...mediaOptions.map((option) => ({
                  value: option.mediaId,
                  label: option.label,
                })),
              ]}
            />
          )}
          <p className={styles['hint']}>{t('publications.addItemMediaDerivativeHint')}</p>
          <Select
            label={t('publications.addItemMediaRoleLabel')}
            value={mediaRole}
            onChange={(event) => setMediaRole(event.target.value as PublicationMediaRole)}
            options={PUBLICATION_MEDIA_ROLES.map((value) => ({
              value,
              label: t(publicationMediaRoleLabel(value)),
            }))}
          />
          <TextField
            label={t('publications.addItemCaptionLabel')}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
        </>
      )}

      <TextField
        label={t('publications.addItemOccurredAtLabel')}
        type="datetime-local"
        value={occurredAt}
        onChange={(event) => setOccurredAt(event.target.value)}
      />

      <Button
        variant="primary"
        busy={mutation.isPending}
        disabled={!isOnline || input === null}
        onClick={onSubmit}
      >
        {t('publications.addItemSubmit')}
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </div>
  );
}
