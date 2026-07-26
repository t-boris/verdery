'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert, StaleIndicator } from '@/shared/ui/public';

import { MemberRow } from './member-row';
import styles from './member-table.module.css';
import { useGardenMembers } from './queries';

export interface MemberTableProps {
  readonly gardenId: string;
  /** Whether the SIGNED-IN caller is an owner — visible to every role, editable only by one. */
  readonly callerIsOwner: boolean;
}

/**
 * Every garden's active members: name-or-fallback and role, visible to
 * every role (`listGardenMembers` — garden-capability-matrix.md row H2,
 * decision S1: "a household member who cannot see who else can see their
 * garden has less visibility into their own garden than a stranger would").
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listGardenMembers`.
 */
export function MemberTable({ gardenId, callerIsOwner }: MemberTableProps) {
  const { t } = useLocalization();
  const query = useGardenMembers(gardenId);

  return (
    <Card title={t('collaborators.membersTitle')}>
      {query.isPending && <p role="status">{t('collaborators.loading')}</p>}

      {/* `isLoadingError`: a failed first load, with no cached data to fall
          back to — the full failure state is all there is to show. A failed
          background refetch (`isRefetchError`) falls through to the
          rendering below instead, per architecture doc section "9.
          Online-First Behavior". */}
      {query.isLoadingError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('collaborators.retry')}
          </Button>
        </div>
      )}

      {!query.isLoadingError && (
        <StaleIndicator failure={query.isError ? query.error.failure : null} />
      )}
      {query.isRefetchError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}

      {!query.isLoadingError && query.data !== undefined && (
        <>
          <p className={styles['notice']}>{t('collaborators.noDisplayName')}</p>
          <ul className={styles['list']}>
            {query.data.items.map((member) => (
              <MemberRow
                key={member.id}
                gardenId={gardenId}
                member={member}
                callerIsOwner={callerIsOwner}
              />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
