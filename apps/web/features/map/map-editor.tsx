'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import {
  Alert,
  FailureAlert,
  RecoveredDraftNotice,
  StaleIndicator,
  VisuallyHidden,
  usePublishStatusBarFields,
} from '@/shared/ui/public';

import { CalibrationPanel } from './calibration-panel';
import { categoryLabelKey, toolLabelKey } from './labels';
import { MapEditorStoreProvider, useMapEditorStore } from './editor-store';
import { ImportedBackgroundPanel } from './imported-background-panel';
import { MapDraftControls } from './map-draft-controls';
import styles from './map-editor.module.css';
import { MapLayerPanel } from './map-layer-panel';
import { MapObjectList } from './map-object-list';
import { MapPropertyPanel } from './map-property-panel';
import { MapScaleBadge } from './map-scale-badge';
import { MapToolbar } from './map-toolbar';
import { MapWarningsPanel } from './map-warnings-panel';
import { useGardenMap } from './queries';
import { useMapDraftPersistence } from './use-map-draft-persistence';
import { useMapEditorActions } from './use-map-editor-actions';

// Konva and MapLibre both need a real `document`/canvas/WebGL context to
// mount (confirmed directly: instantiating a Konva `Stage` outside a browser
// throws immediately — `typeof document === 'undefined'` in Node). This
// component's own `mapQuery.isPending` guard happens to keep the *first*
// server-rendered pass from ever reaching `<MapCanvas>`/`<MapBasemap>`
// (`next build` succeeds identically with or without `ssr: false`, verified
// directly for this work package, since `/application/*` routes are already
// fully dynamic — never statically prerendered — so the build's static pass
// never touches them either way). `ssr: false` stays regardless, as
// deliberate defense-in-depth rather than relying on that incidental
// ordering: any future change to the loading gate (an `initialData`/prefetch
// path that resolves synchronously, for one) would otherwise silently
// reintroduce a server-side crash.
const MapCanvas = dynamic(() => import('./map-canvas').then((mod) => mod.MapCanvas), {
  ssr: false,
});
const MapBasemap = dynamic(() => import('./map-basemap').then((mod) => mod.MapBasemap), {
  ssr: false,
});

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function MapEditorContent({ gardenId }: { readonly gardenId: string }) {
  const { t } = useLocalization();
  const mapQuery = useGardenMap(gardenId);
  const store = useMapEditorStore();
  const actions = useMapEditorActions(gardenId);
  const mapDraft = useMapDraftPersistence(gardenId, store);

  // The shell's footer is mounted above this route and cannot take props, so
  // the readouts are published into it — see `usePublishStatusBarFields`.
  // Deliberately NO "CRS" field, which the direction lists: this product's
  // `Georeference` is a local anchor plus a geographic anchor, a rotation and
  // a scale correction (`packages/api-contracts/openapi.yaml`) — it names no
  // coordinate reference system, so any CRS string here would be invented.
  usePublishStatusBarFields([
    { label: t('map.statusBar.tool'), value: t(toolLabelKey(store.state.tool)) },
    {
      label: t('map.statusBar.selection'),
      value:
        actions.selectedRecord === null
          ? t('map.statusBar.selectionNone')
          : (actions.selectedRecord.label ?? t(categoryLabelKey(actions.selectedRecord.category))),
    },
    {
      label: t('map.statusBar.zoom'),
      value: `${String(Math.round(store.state.camera.scale * 100))}%`,
    },
  ]);

  // Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z are global — unlike arrow-key nudging and
  // Delete, which are scoped to the canvas/object list so they never fight a
  // text field's own editing keys — because undo/redo has no natural single
  // owning region. A field currently being typed in is still exempted, so
  // the browser's native text-undo keeps working there.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        isEditableTarget(event.target) ||
        !(event.metaKey || event.ctrlKey) ||
        event.key !== 'z'
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        void actions.redo();
      } else {
        void actions.undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actions]);

  if (mapQuery.isPending) {
    return <p role="status">{t('map.loading')}</p>;
  }

  // `isLoadingError`: a failed first load, with no cached document to fall
  // back to — the full failure state is all there is to show. A failed
  // background refetch (`isRefetchError`) instead falls through below, the
  // last-loaded document still rendered, with `StaleIndicator` layered over
  // it, per architecture doc section "9. Online-First Behavior".
  if (mapQuery.isLoadingError) {
    return <FailureAlert failure={mapQuery.error.failure} />;
  }

  return (
    <div className={styles['editor']}>
      <StaleIndicator failure={mapQuery.isError ? mapQuery.error.failure : null} />
      {mapQuery.isError && !isConnectivityFailure(mapQuery.error.failure) && (
        <FailureAlert failure={mapQuery.error.failure} />
      )}
      {mapDraft.recovered && <RecoveredDraftNotice onDiscard={mapDraft.discardRecoveredDraft} />}
      <div className={styles['body']}>
        <div className={styles['rail']}>
          <MapToolbar actions={actions} />
        </div>
        <div className={styles['index']}>
          <MapObjectList
            actions={actions}
            selectedObjectId={store.state.selectedObjectId}
            onSelect={store.select}
          />
        </div>
        <div className={styles['canvasWrapper']}>
          <MapBasemap georeference={mapQuery.data.georeference} camera={store.state.camera} />
          <MapCanvas actions={actions} />
          <MapScaleBadge georeference={mapQuery.data.georeference} />
          <MapDraftControls actions={actions} />
        </div>
        <aside className={styles['inspector']} aria-label={t('map.inspector.ariaLabel')}>
          <MapPropertyPanel actions={actions} selectedRecord={actions.selectedRecord} />
          <div className={styles['utilities']} aria-label={t('map.utilities.ariaLabel')}>
            <MapLayerPanel actions={actions} />
            <ImportedBackgroundPanel gardenId={gardenId} actions={actions} />
            <CalibrationPanel gardenId={gardenId} actions={actions} />
            <MapWarningsPanel
              warnings={mapQuery.data.validationSummary}
              findRecord={actions.findRecord}
              onSelectObject={store.select}
            />
          </div>
        </aside>
      </div>
      {store.state.status !== null && store.state.status.tone === 'alert' ? (
        <Alert tone="danger" title={t(store.state.status.key, store.state.status.args)} />
      ) : (
        <VisuallyHidden liveRegion="polite">
          {store.state.status === null ? '' : t(store.state.status.key, store.state.status.args)}
        </VisuallyHidden>
      )}
    </div>
  );
}

export function MapEditor({ gardenId }: { readonly gardenId: string }) {
  return (
    <MapEditorStoreProvider>
      <MapEditorContent gardenId={gardenId} />
    </MapEditorStoreProvider>
  );
}
