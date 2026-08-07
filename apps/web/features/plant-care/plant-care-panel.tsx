'use client';

import type {
  PlantCareRecommendation,
  PlantCareTask,
  PlantWaterBalance,
} from '@verdery/api-contracts';

import { useLocalization } from '@/shared/localization/public';
import type { Translate } from '@/shared/localization/public';
import { FailureAlert, StatusPill } from '@/shared/ui/public';

import styles from './plant-care-panel.module.css';
import { usePlantCare } from './queries';

export interface PlantCarePanelProps {
  readonly gardenId: string;
  readonly plantId: string;
}

function formatMm(value: number): string {
  // One decimal, and no trailing `.0`: rainfall arrives at tenths, and a
  // whole number reads better than `12.0 mm`.
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * The water balance, stated the way the rule states it.
 *
 * Three distinct outcomes, never collapsed: not measured, measured and
 * sufficient, measured and short. The first is the one worth care —
 * rendering "no data" as `0 mm` would turn an unknown into a claim that the
 * window was dry, which is the opposite of what the engine decided.
 */
function WaterBalance({ water, t }: { readonly water: PlantWaterBalance; readonly t: Translate }) {
  if (!water.known) {
    return (
      <div className={styles['water']}>
        <p className={styles['waterUnknown']}>{t('plantCare.water.unknown')}</p>
      </div>
    );
  }

  const accumulated = water.accumulatedMm ?? 0;
  const short = (water.shortfallMm ?? 0) > 0;
  // The bar is the accumulated total against what the window normally
  // supplies, clamped so a very wet week does not overflow its track.
  const filledPercent = Math.min(100, Math.round((accumulated / water.referenceMm) * 100));

  return (
    <div className={styles['water']}>
      <div className={styles['waterHeadline']}>
        <span className={styles['waterTotal']}>{formatMm(accumulated)} mm</span>
        <span className={styles['waterCaption']}>
          {t('plantCare.water.overDays', { days: String(water.windowDays) })}
        </span>
      </div>

      <div
        className={styles['waterTrack']}
        role="img"
        aria-label={t('plantCare.water.barLabel', {
          accumulated: formatMm(accumulated),
          reference: formatMm(water.referenceMm),
        })}
      >
        <div className={styles['waterFill']} style={{ inlineSize: `${filledPercent}%` }} />
        <div
          className={styles['waterThreshold']}
          style={{
            insetInlineStart: `${Math.min(100, (water.thresholdMm / water.referenceMm) * 100)}%`,
          }}
        />
      </div>

      <p className={short ? styles['waterShort'] : styles['waterOk']}>
        {short
          ? t('plantCare.water.short', { shortfall: formatMm(water.shortfallMm ?? 0) })
          : t('plantCare.water.sufficient', { reference: formatMm(water.referenceMm) })}
      </p>
      <p className={styles['waterNote']}>
        {t('plantCare.water.coverage', {
          covered: String(water.daysCovered),
          days: String(water.windowDays),
        })}
      </p>
    </div>
  );
}

function RecommendationRow({
  item,
  t,
}: {
  readonly item: PlantCareRecommendation;
  readonly t: Translate;
}) {
  return (
    <li className={styles['item']}>
      <div className={styles['itemHeader']}>
        <span className={styles['itemTitle']}>{item.careCategory}</span>
        <StatusPill
          tone={item.safetyTier === 'elevated_risk' ? 'negative' : 'neutral'}
          label={item.urgency}
        />
      </div>
      {item.explanation !== null && <p className={styles['itemBody']}>{item.explanation}</p>}
      <p className={styles['itemMeta']}>
        {t('plantCare.ruleIdentity', {
          key: item.ruleKey,
          version: String(item.ruleVersion),
        })}
      </p>
    </li>
  );
}

function TaskRow({ item, t }: { readonly item: PlantCareTask; readonly t: Translate }) {
  return (
    <li className={styles['item']}>
      <div className={styles['itemHeader']}>
        <span className={styles['itemTitle']}>{item.title}</span>
        <StatusPill tone="neutral" label={item.status} />
      </div>
      {item.dueDate !== null && (
        <p className={styles['itemMeta']}>{t('plantCare.due', { date: item.dueDate })}</p>
      )}
    </li>
  );
}

/**
 * What this plant needs, what is already open on it, and the rain it has
 * had — the per-plant counterpart of the garden-wide Today list.
 *
 * Everything here is quoted from the engine. The panel renders decisions;
 * it does not make them, and it adds no advice of its own on top — in
 * particular it never turns a rainfall shortfall into a watering amount,
 * because the rule that produced the shortfall deliberately refuses to.
 */
export function PlantCarePanel({ gardenId, plantId }: PlantCarePanelProps) {
  const { t } = useLocalization();
  const query = usePlantCare(gardenId, plantId);

  if (query.isPending) {
    return <p className={styles['status']}>{t('plantCare.loading')}</p>;
  }

  if (query.isError) {
    return <FailureAlert failure={query.error.failure} />;
  }

  const { recommendations, tasks, water } = query.data;
  const nothingOpen = recommendations.length === 0 && tasks.length === 0;

  return (
    <div className={styles['panel']}>
      <WaterBalance water={water} t={t} />

      {nothingOpen ? (
        <p className={styles['empty']}>{t('plantCare.nothingOpen')}</p>
      ) : (
        <>
          {recommendations.length > 0 && (
            <section className={styles['section']}>
              <h3 className={styles['sectionTitle']}>{t('plantCare.recommendationsTitle')}</h3>
              <ul className={styles['list']}>
                {recommendations.map((item) => (
                  <RecommendationRow key={item.id} item={item} t={t} />
                ))}
              </ul>
            </section>
          )}

          {tasks.length > 0 && (
            <section className={styles['section']}>
              <h3 className={styles['sectionTitle']}>{t('plantCare.tasksTitle')}</h3>
              <ul className={styles['list']}>
                {tasks.map((item) => (
                  <TaskRow key={item.id} item={item} t={t} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
