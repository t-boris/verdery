'use client';

import type { Garden } from '@verdery/api-contracts';
import Link from 'next/link';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StatusPill } from '@/shared/ui/public';

import { useGardens } from './queries';
import styles from './garden-list.module.css';
import { lifecycleLabel, roleLabel } from './labels';

/**
 * Every garden the signed-in profile has active membership on.
 *
 * Source: implementation-plan.md work package P2-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `listGardens`.
 */
export function GardenList() {
  const { t } = useLocalization();
  const query = useGardens();

  if (query.isPending) {
    return <p role="status">{t('gardens.loading')}</p>;
  }

  if (query.isError) {
    return (
      <div className={styles['errorState']}>
        <FailureAlert failure={query.error.failure} />
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t('gardens.retry')}
        </Button>
      </div>
    );
  }

  if (query.data.items.length === 0) {
    return <p className={styles['empty']}>{t('gardens.empty')}</p>;
  }

  return (
    <ul className={styles['list']}>
      {query.data.items.map((garden) => (
        <GardenListItem key={garden.id} garden={garden} />
      ))}
    </ul>
  );
}

function GardenListItem({ garden }: { readonly garden: Garden }) {
  const { t } = useLocalization();

  return (
    <li className={styles['item']}>
      <Link className={styles['link']} href={`/application/gardens/${garden.id}`}>
        {garden.name}
      </Link>
      <span className={styles['meta']}>
        <StatusPill
          tone={garden.lifecycleState === 'active' ? 'positive' : 'neutral'}
          label={t(lifecycleLabel(garden.lifecycleState))}
        />
        <span>{t(roleLabel(garden.callerRole))}</span>
      </span>
    </li>
  );
}
