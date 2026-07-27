'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator } from '@/shared/ui/public';

import { ContextFactRow } from './context-fact-row';
import { GARDEN_CONTEXT_KINDS, canEditGardenContent } from './labels';
import styles from './context-quality.module.css';
import { useCallerRole, useGardenContextFacts } from './queries';

export interface ContextQualityProps {
  readonly gardenId: string;
}

/**
 * The Context quality section (P9D-UX-01): one row per `GardenContextKind`
 * — six rows always, even for a kind never recorded — so a reader can see
 * at a glance which facts are missing entirely, not only which are present.
 *
 * PLACEMENT: composed on `app/application/gardens/[gardenId]/page.tsx`, the
 * existing garden settings/details surface, as a SIBLING of `GardenSettings`/
 * `Collaborators`/`GardenPhotoUpload`/etc — never nested inside one of
 * them — the same reasoning `collaborators.tsx`'s own header gives for why
 * `GardenAssignmentsSection`/`GardenEngagementsSection` are composed there
 * rather than folded into an existing section: this reads a genuinely
 * different domain (`garden_context_fact`, not `garden`/`collaboration.
 * membership`). It is NOT placed inside the Seasonal plan page: that page
 * already covers two sub-views on its own, and `[gardenId]/page.tsx` is
 * this codebase's own established "non-map garden settings" surface
 * (`GardenSettings`'s own header: "the commands that change it" for the
 * garden itself), which context facts are a closer fit for than a
 * forward-looking planning view.
 *
 * The outer structure — a labeled `<h2>` section, not the shared `Card`
 * primitive — mirrors `collaborators.tsx` exactly: both are one of several
 * sibling sections stacked on the same route and need their own heading to
 * distinguish themselves, unlike `Card`, which groups a subsection WITHIN
 * a single-focus page (`garden-settings.tsx`'s Rename/Manage boxes).
 *
 * Loading/error/stale handling mirrors `today-list.tsx` per this package's
 * own "do not invent a new one" instruction, gated on the facts read (the
 * page's actual content); the caller-role read degrades independently and
 * conservatively — `canEdit` stays `false`, hiding every edit affordance,
 * until it is known to be `true`, rather than blocking the whole section on
 * a second query.
 *
 * Source: tasks/todo.md, "P9D-UX-01 design decisions";
 * packages/api-contracts/src/garden-context.ts.
 */
export function ContextQuality({ gardenId }: ContextQualityProps) {
  const { t } = useLocalization();
  const factsQuery = useGardenContextFacts(gardenId);
  const roleQuery = useCallerRole(gardenId);

  const canEdit = roleQuery.data !== undefined && canEditGardenContent(roleQuery.data.callerRole);

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{t('contextQuality.title')}</h2>
      <p className={styles['description']}>{t('contextQuality.description')}</p>

      {factsQuery.isPending && <p role="status">{t('contextQuality.loading')}</p>}

      {factsQuery.isLoadingError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={factsQuery.error.failure} />
          <Button variant="secondary" onClick={() => void factsQuery.refetch()}>
            {t('contextQuality.retry')}
          </Button>
        </div>
      )}

      {!factsQuery.isLoadingError && (
        <StaleIndicator failure={factsQuery.isError ? factsQuery.error.failure : null} />
      )}
      {factsQuery.isRefetchError && !isConnectivityFailure(factsQuery.error.failure) && (
        <FailureAlert failure={factsQuery.error.failure} />
      )}

      {!factsQuery.isLoadingError && factsQuery.data !== undefined && (
        <ul className={styles['list']}>
          {GARDEN_CONTEXT_KINDS.map((kind) => (
            <ContextFactRow
              key={kind}
              gardenId={gardenId}
              contextKind={kind}
              fact={factsQuery.data.items.find((item) => item.contextKind === kind) ?? null}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
