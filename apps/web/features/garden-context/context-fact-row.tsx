'use client';

import type { GardenContextFact, GardenContextKind } from '@verdery/api-contracts';
import { useId, useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button } from '@/shared/ui/public';

import { ContextFactEditForm } from './context-fact-edit-form';
import { contextKindLabel, contextSourceLabel, contextValueLabel } from './labels';
import styles from './context-fact-row.module.css';

export interface ContextFactRowProps {
  readonly gardenId: string;
  readonly contextKind: GardenContextKind;
  /** `null` when this garden has never recorded a fact for this kind — shown as "Not yet declared", never omitted from the list. */
  readonly fact: GardenContextFact | null;
  /** Whether the signed-in caller holds `editGardenContent` — see `context-quality.tsx`'s own header for how this is resolved. */
  readonly canEdit: boolean;
}

/**
 * One `GardenContextKind` row: the declared value, its source, and —
 * only when `source === 'horticulturally_reviewed_default'` —
 * `reviewedBy`/`reviewedOn`, so a reader can tell at a glance whether a
 * fact is a member's own declaration or an operator default (FR-22). The
 * declaring member is shown as `recordedByProfileId` through
 * `contextQuality.recordedByDisplay`, the SAME raw-id display convention
 * `task-row.tsx`'s `tasks.assignedToDisplay` already uses — this codebase
 * has no member display-name field anywhere (`member-row.tsx`'s own header:
 * "There is no display name in `GardenMember` at all"), so resolving one
 * here would invent data the API does not carry, rather than reusing an
 * existing convention.
 *
 * The edit disclosure mirrors `today-card.tsx`'s expand/collapse pattern.
 * It renders only when `canEdit` is true — the caller-role gate this
 * package's design decision asks for, matching `garden-settings.tsx`'s own
 * `isOwner &&` pattern for hiding a mutation the server would reject anyway.
 */
export function ContextFactRow({ gardenId, contextKind, fact, canEdit }: ContextFactRowProps) {
  const { t } = useLocalization();
  const editPanelId = useId();
  const [editOpen, setEditOpen] = useState(false);

  const valueLabelKey = fact === null ? null : contextValueLabel(contextKind, fact.value);

  return (
    <li className={styles['row']}>
      <div className={styles['header']}>
        <h3 className={styles['kind']}>{t(contextKindLabel(contextKind))}</h3>
        {canEdit && (
          <Button
            variant="secondary"
            aria-expanded={editOpen}
            aria-controls={editPanelId}
            onClick={() => setEditOpen(!editOpen)}
          >
            {t(fact === null ? 'contextQuality.declare' : 'contextQuality.edit')}
          </Button>
        )}
      </div>

      {fact === null ? (
        <p className={styles['notDeclared']}>{t('contextQuality.notDeclared')}</p>
      ) : (
        <div className={styles['details']}>
          <p className={styles['value']}>
            {valueLabelKey === null ? fact.value : t(valueLabelKey)}
          </p>
          <p className={styles['meta']}>{t(contextSourceLabel(fact.source))}</p>
          {/* The wire `GardenContextFact` type carries `reviewedBy`/`reviewedOn`
              as independently optional fields, not narrowed by `source` at
              the type level (checked against
              `packages/api-contracts/src/generated/schema.ts`) — the
              `!== undefined` checks here are the type-safe way to require
              both, matching the domain layer's own invariant
              (`GardenContextFactProvenance`) without asserting past what
              the wire type actually guarantees. */}
          {fact.source === 'horticulturally_reviewed_default' &&
            fact.reviewedBy !== undefined &&
            fact.reviewedOn !== undefined && (
              <p className={styles['meta']}>
                {t('contextQuality.reviewedByDisplay', {
                  reviewedBy: fact.reviewedBy,
                  reviewedOn: fact.reviewedOn,
                })}
              </p>
            )}
          <p className={styles['meta']}>
            {t('contextQuality.recordedByDisplay', { profileId: fact.recordedByProfileId })}
          </p>
        </div>
      )}

      <div id={editPanelId}>
        {editOpen && (
          <ContextFactEditForm
            gardenId={gardenId}
            contextKind={contextKind}
            currentValue={fact?.value ?? null}
            onDone={() => setEditOpen(false)}
          />
        )}
      </div>
    </li>
  );
}
