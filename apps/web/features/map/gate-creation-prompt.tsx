'use client';

import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, Select } from '@/shared/ui/public';

import { useMapEditorStore } from './editor-store';
import styles from './map-toolbar.module.css';
import type { MapEditorActions } from './use-map-editor-actions';

export interface GateCreationPromptProps {
  readonly actions: MapEditorActions;
}

/**
 * Shown once a gate draft is finished and is awaiting a fence pick — see
 * `use-map-editor-actions.ts`'s gate-creation flow and
 * `store.state.pendingGateGeometry`. A gate is always positioned along
 * exactly one fence (`GateDetails.fenceObjectId` is required), so this is
 * the one creatable category whose `createObject` command cannot be built
 * from the draft geometry alone — this prompt gets a real, user-picked
 * fence id before `completeGateCreation` builds it.
 *
 * Renders nothing when there is no pending gate draft — `map-toolbar.tsx`
 * mounts it unconditionally, letting this component own its own visibility.
 */
export function GateCreationPrompt({ actions }: GateCreationPromptProps) {
  const { t } = useLocalization();
  const store = useMapEditorStore();
  const fences = actions.records.filter((record) => record.category === 'fence');
  const [fenceObjectId, setFenceObjectId] = useState(fences[0]?.id ?? '');

  if (store.state.pendingGateGeometry === null) {
    return null;
  }

  return (
    <div className={styles['group']} role="group" aria-label={t('map.gate.promptTitle')}>
      <Select
        label={t('map.gate.fenceLabel')}
        value={fenceObjectId}
        options={fences.map((fence) => ({ value: fence.id, label: fence.label ?? fence.id }))}
        onChange={(event) => setFenceObjectId(event.target.value)}
      />
      <Button
        type="button"
        variant="primary"
        disabled={fenceObjectId === ''}
        busy={actions.isSubmitting}
        onClick={() => void actions.completeGateCreation(fenceObjectId)}
      >
        {t('map.gate.confirm')}
      </Button>
      <Button type="button" variant="secondary" onClick={actions.cancelGateCreation}>
        {t('map.gate.cancel')}
      </Button>
    </div>
  );
}
