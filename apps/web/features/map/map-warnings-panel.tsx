'use client';

import type { WireValidationIssue } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { StatusPill, type StatusTone } from '@/shared/ui/public';

import { categoryLabelKey } from './labels';
import styles from './map-warnings-panel.module.css';
import type { MapObjectRecord } from './types';
import { severityLabelKey, warningMessageFor } from './warning-labels';

export interface MapWarningsPanelProps {
  readonly warnings: readonly WireValidationIssue[];
  readonly findRecord: (objectId: string) => MapObjectRecord | null;
  /** Reuses `store.select` — clicking an affected object highlights it on the canvas and in the object list. */
  readonly onSelectObject: (objectId: string) => void;
}

const SEVERITY_TONE: Readonly<Record<WireValidationIssue['severity'], StatusTone>> = {
  error: 'negative',
  warning: 'neutral',
};

/**
 * Renders `GardenMapDocument.validationSummary` (`WireValidationIssue[]`) —
 * already decoded by this client on every map fetch (`queries.ts`) but, before
 * this work package, never rendered anywhere in the UI (confirmed by grep).
 *
 * Genuinely empty against the real API today, and that is a documented,
 * external, pre-existing gap, not something left unfinished here: the
 * backend's cross-object validation (unexpected overlaps, a plant inside a
 * blocked structure, a detached gate) needs geometry/topology queries this
 * work package does not implement —
 * `services/api/src/modules/gardens-mapping/application/get-garden-map.ts`
 * always returns `validationSummary: []`, with its own doc comment saying so.
 * That backend algorithm work is out of scope for this UX-presentation work
 * package; implementing it is a separate, near-term backend effort, not
 * gated on any research decision the way Phase 6/10 deferrals are.
 *
 * This panel is instead verified against constructed/mocked
 * `WireValidationIssue[]` data (`map-warnings-panel.test.tsx`) — the same
 * shape `apps/ios/Tests/CoreNetworkingTests/MapGatewayTests.swift`'s fixture
 * already builds one entry of. The moment the backend starts returning real
 * issues, this UI is fully live with zero further client changes.
 *
 * `code` is resolved through `warning-labels.ts`'s open-ended mapping (never
 * hard-fails on an unrecognized code); `severity` is shown with both a
 * distinct `StatusPill` tone and its own text label, never color alone —
 * architecture doc section "19. Accessibility".
 */
export function MapWarningsPanel({ warnings, findRecord, onSelectObject }: MapWarningsPanelProps) {
  const { t } = useLocalization();

  return (
    <div className={styles['panel']}>
      <h2 className={styles['title']}>{t('map.warnings.title')}</h2>
      {warnings.length === 0 ? (
        <p className={styles['empty']}>{t('map.warnings.empty')}</p>
      ) : (
        <ul className={styles['list']}>
          {warnings.map((issue, index) => (
            <WarningRow
              // Wire issues carry no id of their own; `code` is not unique
              // across entries (the same rule can fire more than once), so
              // the index is the only stable-enough key for this list.
              key={`${issue.code}-${index}`}
              issue={issue}
              findRecord={findRecord}
              onSelectObject={onSelectObject}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function WarningRow({
  issue,
  findRecord,
  onSelectObject,
}: {
  readonly issue: WireValidationIssue;
  readonly findRecord: (objectId: string) => MapObjectRecord | null;
  readonly onSelectObject: (objectId: string) => void;
}) {
  const { t } = useLocalization();
  const message = warningMessageFor(issue.code);
  const affectedRecords = (issue.affectedObjectIds ?? [])
    .map((objectId) => findRecord(objectId))
    .filter((record): record is MapObjectRecord => record !== null);

  return (
    <li className={styles['item']}>
      <div className={styles['row']}>
        <StatusPill
          tone={SEVERITY_TONE[issue.severity]}
          label={t(severityLabelKey(issue.severity))}
        />
        <span className={styles['message']}>{t(message.key, message.args)}</span>
      </div>
      {affectedRecords.length > 0 && (
        <div className={styles['affected']}>
          {affectedRecords.map((record) => (
            <button
              key={record.id}
              type="button"
              className={styles['affectedButton']}
              onClick={() => onSelectObject(record.id)}
            >
              {record.label ?? t(categoryLabelKey(record.category))}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
