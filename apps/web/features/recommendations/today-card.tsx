'use client';

import type { TodayRecommendation } from '@verdery/api-contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization, type Translate } from '@/shared/localization/public';
import { Button, FailureAlert, StatusPill } from '@/shared/ui/public';

import { describeUncertainty } from './explainers';
import { targetKindLabel, urgencyLabel } from './labels';
import { PostponeForm } from './postpone-form';
import {
  useCompleteRecommendation,
  useConvertRecommendationToTask,
  useDismissRecommendation,
  useMarkRecommendationIrrelevant,
} from './queries';
import styles from './today-card.module.css';
import { TodayDetails } from './today-details';

export interface TodayCardProps {
  readonly gardenId: string;
  readonly item: TodayRecommendation;
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

function windowText(item: TodayRecommendation, t: Translate): string | null {
  if (item.windowStart !== null && item.windowEnd !== null) {
    return t('today.windowRange', {
      start: formatTimestamp(item.windowStart),
      end: formatTimestamp(item.windowEnd),
    });
  }
  if (item.windowEnd !== null) {
    return t('today.windowUntil', { end: formatTimestamp(item.windowEnd) });
  }
  if (item.windowStart !== null) {
    return t('today.windowFrom', { start: formatTimestamp(item.windowStart) });
  }
  return null;
}

/**
 * One Today recommendation with FR-24's full field list — proposed action
 * (`actionTitle`), reason (the stored deterministic `explanation`), urgency,
 * target, validity window, priority score — plus the honest uncertainty
 * line (the stored `confidence` factor's contribution and basis, rendered
 * through `explainers.ts`, or its explicit absence) and every control the
 * contract offers: complete, postpone (with an optional horizon), dismiss,
 * mark-irrelevant, and convert-to-task.
 *
 * The four command buttons are offline-gated (`disabled={!isOnline}`)
 * exactly as `task-row.tsx` gates its state transitions: each is a simple
 * command, not free-text input a user could lose. The Postpone and details
 * toggles stay enabled offline — they open local panels. Mark-irrelevant
 * keeps the card visible (the command appends feedback without a state
 * transition), so its success is confirmed inline; every other successful
 * command removes the item from the refetched Today set. A successful
 * conversion navigates to the tasks page, where the created task now lives.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Recommendations`;
 * technical-specification.md, FR-3 and FR-24.
 */
export function TodayCard({ gardenId, item }: TodayCardProps) {
  const { t } = useLocalization();
  const router = useRouter();
  const isOnline = useIsOnline();
  const [postponeOpen, setPostponeOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const completeMutation = useCompleteRecommendation(gardenId, item.id);
  const dismissMutation = useDismissRecommendation(gardenId, item.id);
  const irrelevantMutation = useMarkRecommendationIrrelevant(gardenId, item.id);
  const convertMutation = useConvertRecommendationToTask(gardenId, item.id);

  const uncertainty = describeUncertainty(item);
  const uncertaintyBasis = uncertainty.basis.map((line) => t(line.key, line.args)).join('; ');
  const window = windowText(item, t);

  const onConvert = () => {
    convertMutation.mutate(item.revision, {
      onSuccess: () => router.push(`/application/gardens/${gardenId}/tasks`),
    });
  };

  return (
    <li className={styles['card']}>
      <div className={styles['header']}>
        <span className={styles['title']}>{item.actionTitle}</span>
        {item.safetyTier === 'elevated_risk' && (
          <StatusPill tone="negative" label={t('today.safetyElevatedRisk')} />
        )}
        <span className={styles['meta']}>{t(urgencyLabel(item.urgency))}</span>
        <span className={styles['meta']}>
          {item.targetDisplayName ?? t(targetKindLabel(item.targetKind))}
        </span>
        <span className={styles['meta']}>{item.careCategory}</span>
      </div>

      <p className={styles['reason']}>
        <span className={styles['reasonLabel']}>{t('today.reasonLabel')}</span> {item.explanation}
      </p>

      {item.safetyTier === 'elevated_risk' && (
        <p className={styles['caution']}>{t('today.safetyElevatedRiskNote')}</p>
      )}

      <p className={styles['uncertainty']}>
        {t(uncertainty.headline.key, uncertainty.headline.args)}
        {uncertaintyBasis === '' ? '' : ` — ${uncertaintyBasis}`}
      </p>

      <div className={styles['meta']}>
        <span>{t('today.priorityDisplay', { score: item.priorityScore })}</span>
        {window !== null && <span>{window}</span>}
      </div>

      <div className={styles['actions']}>
        <Button
          variant="primary"
          busy={completeMutation.isPending}
          disabled={!isOnline}
          onClick={() => completeMutation.mutate(item.revision)}
        >
          {t('today.complete')}
        </Button>
        <Button
          variant="secondary"
          busy={convertMutation.isPending}
          disabled={!isOnline}
          onClick={onConvert}
        >
          {t('today.convertToTask')}
        </Button>
        <Button variant="secondary" onClick={() => setPostponeOpen(!postponeOpen)}>
          {t('today.postpone')}
        </Button>
        <Button
          variant="secondary"
          busy={dismissMutation.isPending}
          disabled={!isOnline}
          onClick={() => dismissMutation.mutate(item.revision)}
        >
          {t('today.dismiss')}
        </Button>
        <Button
          variant="secondary"
          busy={irrelevantMutation.isPending}
          disabled={!isOnline}
          onClick={() => irrelevantMutation.mutate(item.revision)}
        >
          {t('today.markIrrelevant')}
        </Button>
        <Button variant="secondary" onClick={() => setDetailsOpen(!detailsOpen)}>
          {t(detailsOpen ? 'today.detailsHide' : 'today.detailsShow')}
        </Button>
      </div>

      {postponeOpen && (
        <PostponeForm gardenId={gardenId} item={item} onDone={() => setPostponeOpen(false)} />
      )}

      {detailsOpen && <TodayDetails item={item} />}

      {irrelevantMutation.isSuccess && (
        <p role="status" className={styles['feedbackNote']}>
          {t('today.markIrrelevantRecorded')}
        </p>
      )}

      {completeMutation.isError && <FailureAlert failure={completeMutation.error.failure} />}
      {dismissMutation.isError && <FailureAlert failure={dismissMutation.error.failure} />}
      {irrelevantMutation.isError && <FailureAlert failure={irrelevantMutation.error.failure} />}
      {convertMutation.isError && <FailureAlert failure={convertMutation.error.failure} />}
    </li>
  );
}
