'use client';

import type { PublisherGrant } from '@verdery/api-contracts';
import { useState } from 'react';

import { isConnectivityFailure } from '@/core/api/public';
import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import {
  Button,
  Card,
  CommandSurface,
  FailureAlert,
  StaleIndicator,
  StatusPill,
  TextField,
} from '@/shared/ui/public';

import styles from './publisher-access-panel.module.css';
import { publisherGrantStateLabel, publisherGrantStateTone } from './labels';
import { useGrantPublisherAccess, usePublisherGrants, useRevokePublisherAccess } from './queries';

/**
 * Administers WHO may draft and publish client updates on this engagement —
 * a capability separate from administering the engagement itself
 * (`manageEngagement`/`manageGarden`), per ADR-0012 and
 * `ClientUpdateErrorCode.PublisherAccessRequired`'s own doc comment. Shown
 * to an engagement administrator; `grantPublisherAccess`/
 * `revokePublisherAccess` are themselves `manageEngagement`/`manageGarden`-
 * gated server-side, so a non-admin caller simply gets a real 403 here,
 * the same "the server remains authoritative" posture every other admin
 * panel in this app takes.
 *
 * `profileId` is entered by hand — the same honest raw-id posture
 * `add-organization-member-form.tsx` documents: this app has no directory
 * of accounts outside the caller's own memberships.
 *
 * Source: packages/api-contracts/openapi.yaml, operations `listPublisherGrants`,
 * `grantPublisherAccess`, `revokePublisherAccess`.
 */
export function PublisherAccessPanel({ engagementId }: { readonly engagementId: string }) {
  const { t } = useLocalization();
  const query = usePublisherGrants(engagementId);
  const grantMutation = useGrantPublisherAccess(engagementId);
  const [profileId, setProfileId] = useState('');

  const onGrant = () => {
    const trimmed = profileId.trim();
    if (trimmed === '') {
      return;
    }
    grantMutation.mutate({ profileId: trimmed }, { onSuccess: () => setProfileId('') });
  };

  return (
    <Card title={t('publications.accessTitle')}>
      <p className={styles['description']}>{t('publications.accessDescription')}</p>

      {query.isPending && <p role="status">{t('publications.accessLoading')}</p>}

      {query.isLoadingError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('publications.accessRetry')}
          </Button>
        </div>
      )}

      {!query.isLoadingError && (
        <StaleIndicator failure={query.isError ? query.error.failure : null} />
      )}
      {query.isRefetchError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}

      {!query.isLoadingError &&
        query.data !== undefined &&
        (query.data.items.length === 0 ? (
          <p className={styles['empty']}>{t('publications.accessEmpty')}</p>
        ) : (
          <ul className={styles['list']}>
            {query.data.items.map((grant) => (
              <PublisherGrantRow key={grant.id} engagementId={engagementId} grant={grant} />
            ))}
          </ul>
        ))}

      <CommandSurface className={styles['form']} onCommit={onGrant}>
        <h3 className={styles['formTitle']}>{t('publications.accessGrantTitle')}</h3>
        <TextField
          label={t('publications.accessGrantProfileIdLabel')}
          value={profileId}
          onChange={(event) => setProfileId(event.target.value)}
        />
        <p className={styles['hint']}>{t('publications.accessGrantProfileIdHint')}</p>
        <Button
          type="submit"
          variant="primary"
          busy={grantMutation.isPending}
          disabled={profileId.trim() === ''}
        >
          {t('publications.accessGrantSubmit')}
        </Button>
        {grantMutation.isError && <FailureAlert failure={grantMutation.error.failure} />}
      </CommandSurface>
    </Card>
  );
}

function PublisherGrantRow({
  engagementId,
  grant,
}: {
  readonly engagementId: string;
  readonly grant: PublisherGrant;
}) {
  const { t } = useLocalization();
  const isOnline = useIsOnline();
  const mutation = useRevokePublisherAccess(engagementId);

  const onRevoke = () => {
    if (globalThis.confirm(t('publications.accessRevokeConfirm'))) {
      mutation.mutate(grant.profileId);
    }
  };

  return (
    <li className={styles['row']}>
      <span>{grant.profileId}</span>
      <StatusPill
        tone={publisherGrantStateTone(grant.state)}
        label={t(publisherGrantStateLabel(grant.state))}
      />
      {grant.state === 'active' && (
        <Button
          variant="destructive"
          busy={mutation.isPending}
          disabled={!isOnline}
          onClick={onRevoke}
        >
          {t('publications.accessRevoke')}
        </Button>
      )}
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </li>
  );
}
