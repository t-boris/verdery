'use client';

import type { CareRule, CareRuleBlocker } from '@verdery/api-contracts';
import Link from 'next/link';

import { useLocalization } from '@/shared/localization/public';
import type { MessageKey, Translate } from '@/shared/localization/public';
import { Button, FailureAlert, StatusPill } from '@/shared/ui/public';

import styles from './care-rules-panel.module.css';
import { useGardenCareRules } from './queries';

export interface CareRulesPanelProps {
  readonly gardenId: string;
}

/**
 * A blocker maps to exactly one message key. Written as a total record
 * rather than a switch with a default, so adding a blocker to the contract
 * without adding its explanation is a compile error rather than a rule that
 * silently displays nothing.
 */
const BLOCKER_MESSAGE: Readonly<Record<CareRuleBlocker, MessageKey>> = {
  noWeatherProvider: 'careRules.blocker.noWeatherProvider',
  gardenNotGeoreferenced: 'careRules.blocker.gardenNotGeoreferenced',
  noWeatherObservation: 'careRules.blocker.noWeatherObservation',
  noWeatherForecast: 'careRules.blocker.noWeatherForecast',
  noRainfallHistory: 'careRules.blocker.noRainfallHistory',
  noIdentifiedPlants: 'careRules.blocker.noIdentifiedPlants',
  seasonalTimingNotAccepted: 'careRules.blocker.seasonalTimingNotAccepted',
  noPlacedPlants: 'careRules.blocker.noPlacedPlants',
  awaitingHorticulturalReview: 'careRules.blocker.awaitingHorticulturalReview',
};

/**
 * An outstanding review is disclosure, not an obstruction: the rule still
 * runs. Only the other blockers decide whether this check can produce
 * anything, so only they change the pill.
 */
function isObstructing(blocker: CareRuleBlocker): boolean {
  return blocker !== 'awaitingHorticulturalReview';
}

function CareRuleRow({
  rule,
  gardenId,
  t,
}: {
  readonly rule: CareRule;
  readonly gardenId: string;
  readonly t: Translate;
}) {
  const obstructions = rule.blockers.filter(isObstructing);
  const blocked = obstructions.length > 0;

  return (
    <li className={styles['rule']}>
      <div className={styles['ruleHeader']}>
        <h3 className={styles['ruleTitle']}>{rule.actionTitle}</h3>
        <span className={styles['ruleMeta']}>
          {rule.safetyTier === 'elevated_risk' && (
            <StatusPill tone="neutral" label={t('careRules.tierElevated')} />
          )}
          <StatusPill
            tone={blocked ? 'negative' : 'positive'}
            label={blocked ? t('careRules.blockedLabel') : t('careRules.activeLabel')}
          />
        </span>
      </div>
      <p className={styles['ruleDescription']}>{rule.description}</p>
      {rule.blockers.length > 0 && (
        <ul className={styles['blockers']}>
          {rule.blockers.map((blocker) => (
            <li className={styles['blocker']} key={blocker}>
              {t(BLOCKER_MESSAGE[blocker])}{' '}
              {/* The one blocker a reader resolves themselves gets the way
                  to resolve it; the others are stated and left alone. */}
              {blocker === 'gardenNotGeoreferenced' && (
                <Link href={`/application/gardens/${gardenId}`}>{t('careRules.setLocation')}</Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * What the automation actually does, and what currently stops it.
 *
 * WHY THIS SURFACE EXISTS. Five of the seven rules can go silent for
 * reasons that are invisible from outside — no active weather provider, no
 * coordinates, no identified plants, no reviewed seasonal timing, nothing
 * fetched yet. Every one produces the same observable, an empty Today list,
 * while having a completely different answer, and two of them are things a
 * person fixes in one click. Without this, the only available reading of
 * silence is "it is broken", which is wrong in every case.
 *
 * It sits below the recommendations rather than above them: it is the
 * answer to a question the list raises, not the thing a person came for.
 *
 * The outstanding horticultural review is shown on every rule but does not
 * mark it blocked, because it does not stop the rule running — it is
 * disclosure that the thresholds are placeholders, which a surface
 * explaining the automation should not quietly omit.
 */
export function CareRulesPanel({ gardenId }: CareRulesPanelProps) {
  const { t } = useLocalization();
  const query = useGardenCareRules(gardenId);

  return (
    <section className={styles['section']} aria-labelledby="care-rules-title">
      <h2 className={styles['title']} id="care-rules-title">
        {t('careRules.title')}
      </h2>
      <p className={styles['description']}>{t('careRules.description')}</p>

      {query.isPending && <p role="status">{t('careRules.loading')}</p>}

      {query.isLoadingError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('careRules.retry')}
          </Button>
        </div>
      )}

      {query.data !== undefined && (
        <ul className={styles['list']}>
          {query.data.rules.map((rule) => (
            <CareRuleRow key={rule.ruleKey} rule={rule} gardenId={gardenId} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}
