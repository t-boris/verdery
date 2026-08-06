'use client';

import type { GardenObjectCategory } from '@verdery/geometry-contracts';

import type {
  ApiFailureError,
  WireAerialTraceProposal,
  WireAerialTraceResult,
} from '@/core/api/public';
import { useLocalization, type MessageKey } from '@/shared/localization/public';
import { Alert, Button, FailureAlert, Select, TextField } from '@/shared/ui/public';

import { categoryLabelKey } from './labels';
import styles from './aerial-trace-panel.module.css';

interface AerialTracePanelProps {
  readonly georeferenced: boolean;
  readonly busy: boolean;
  readonly error: ApiFailureError | null;
  readonly result: WireAerialTraceResult | null;
  readonly proposals: readonly WireAerialTraceProposal[];
  readonly selectedId: string | null;
  readonly checkedIds: ReadonlySet<string>;
  readonly accepting: boolean;
  readonly onTrace: () => void;
  readonly onSelect: (proposalId: string) => void;
  readonly onUpdate: (proposal: WireAerialTraceProposal) => void;
  readonly onReject: (proposalId: string) => void;
  readonly onToggleChecked: (proposalId: string) => void;
  readonly onAccept: (proposalIds: readonly string[]) => void;
}

const OUTCOME_MESSAGES: Record<Exclude<WireAerialTraceResult['kind'], 'ready'>, MessageKey> = {
  disabled: 'map.aerialTrace.disabled',
  notGeoreferenced: 'map.aerialTrace.needsLocation',
  outsideCoverage: 'map.aerialTrace.outsideCoverage',
  unusableImagery: 'map.aerialTrace.unusableImagery',
  quotaExceeded: 'map.aerialTrace.quotaExceeded',
  timedOut: 'map.aerialTrace.timedOut',
  providerFailure: 'map.aerialTrace.providerFailure',
  noVisibleGeometry: 'map.aerialTrace.noVisibleGeometry',
};

function categoriesFor(proposal: WireAerialTraceProposal): readonly GardenObjectCategory[] {
  const geometry = proposal.geometry;
  if (geometry.type === 'Point') return ['tree'];
  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
    return ['path', 'fence'];
  }
  const ordinaryPolygons: readonly GardenObjectCategory[] = [
    'structure',
    'zone',
    'bed',
    'waterFeature',
    'utilityExclusion',
  ];
  return proposal.boundaryEvidence === 'visualEvidence'
    ? ['lot', ...ordinaryPolygons]
    : ordinaryPolygons;
}

export function AerialTracePanel({
  georeferenced,
  busy,
  error,
  result,
  proposals,
  selectedId,
  checkedIds,
  accepting,
  onTrace,
  onSelect,
  onUpdate,
  onReject,
  onToggleChecked,
  onAccept,
}: AerialTracePanelProps) {
  const { t } = useLocalization();

  return (
    <section className={styles['panel']} aria-labelledby="aerial-trace-title">
      <h2 id="aerial-trace-title" className={styles['title']}>
        {t('map.aerialTrace.title')}
      </h2>
      <p className={styles['description']}>{t('map.aerialTrace.description')}</p>
      <Alert tone="info" title={t('map.aerialTrace.legalWarning')} />
      <Button variant="primary" busy={busy} disabled={!georeferenced} onClick={onTrace}>
        {busy ? t('map.aerialTrace.running') : t('map.aerialTrace.action')}
      </Button>
      {!georeferenced && <p className={styles['hint']}>{t('map.aerialTrace.needsLocation')}</p>}
      {error !== null && <FailureAlert failure={error.failure} />}
      {result !== null && result.kind !== 'ready' && (
        <Alert tone="danger" title={t(OUTCOME_MESSAGES[result.kind])} />
      )}
      {result?.kind === 'ready' && (
        <>
          <p className={styles['source']}>
            {result.imagery.attributionText} ·{' '}
            {result.imagery.capturedOn ?? t('map.aerialTrace.dateUnknown')}
            {' · '}
            <a href={result.imagery.licenseUrl} target="_blank" rel="noreferrer">
              {result.imagery.licenseName}
            </a>
          </p>
          <p className={styles['hint']}>{t('map.aerialTrace.editHint')}</p>
          <ul className={styles['list']}>
            {proposals.map((proposal) => (
              <li key={proposal.proposalId} className={styles['proposal']}>
                <label className={styles['choice']}>
                  <input
                    type="checkbox"
                    checked={checkedIds.has(proposal.proposalId)}
                    onChange={() => onToggleChecked(proposal.proposalId)}
                  />
                  <span>{t('map.aerialTrace.include')}</span>
                </label>
                <Button
                  variant="secondary"
                  aria-pressed={proposal.proposalId === selectedId}
                  onClick={() => onSelect(proposal.proposalId)}
                >
                  {t(categoryLabelKey(proposal.category))} · {Math.round(proposal.confidence * 100)}
                  %
                </Button>
                <TextField
                  label={t('map.aerialTrace.label')}
                  value={proposal.label}
                  onChange={(event) => onUpdate({ ...proposal, label: event.target.value })}
                />
                <Select
                  label={t('map.aerialTrace.category')}
                  value={proposal.category}
                  options={categoriesFor(proposal).map((category) => ({
                    value: category,
                    label: t(categoryLabelKey(category)),
                  }))}
                  onChange={(event) =>
                    onUpdate({
                      ...proposal,
                      category: event.target.value as WireAerialTraceProposal['category'],
                    })
                  }
                />
                {proposal.limitations.length > 0 && (
                  <ul className={styles['limitations']}>
                    {proposal.limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                )}
                <Button variant="secondary" onClick={() => onReject(proposal.proposalId)}>
                  {t('map.aerialTrace.reject')}
                </Button>
                <Button
                  variant="secondary"
                  busy={accepting}
                  onClick={() => onAccept([proposal.proposalId])}
                >
                  {t('map.aerialTrace.acceptOne')}
                </Button>
              </li>
            ))}
          </ul>
          <Button
            busy={accepting}
            disabled={checkedIds.size === 0}
            onClick={() => onAccept([...checkedIds])}
          >
            {t('map.aerialTrace.acceptSelected', { count: String(checkedIds.size) })}
          </Button>
        </>
      )}
    </section>
  );
}
