'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

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

import { backdropStateFor } from './backdrop-state';
import { AerialTracingPanel } from './aerial-tracing-panel';
import { useTraceAerial } from './aerial-tracing-queries';
import { MapInspectorDrawer, type InspectorTabId } from './map-inspector-drawer';
import { CalibrationPanel } from './calibration-panel';
import { categoryLabelKey, toolLabelKey } from './labels';
import { MapEditorStoreProvider, useMapEditorStore } from './editor-store';
import { GardenLocationPanel } from './garden-location-panel';
import { ImportedBackgroundPanel } from './imported-background-panel';
import { MapDraftControls } from './map-draft-controls';
import styles from './map-editor.module.css';
import { MapLayerPanel } from './map-layer-panel';
import { MapObjectList } from './map-object-list';
import { MapPropertyPanel } from './map-property-panel';
import { MapBackdropSwitch } from './map-backdrop-switch';
import { MapEmptyPrompt } from './map-empty-prompt';
import { MapScaleBadge } from './map-scale-badge';
import { MapToolbar } from './map-toolbar';
import { MapWarningsPanel } from './map-warnings-panel';
import { useGardenMap } from './queries';
import { useMapDraftPersistence } from './use-map-draft-persistence';
import { useMapViewPersistence } from './use-map-view-persistence';
import { DEFAULT_SCALE } from './viewport';
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
  const mapViewReady = useMapViewPersistence(gardenId, store);
  const aerialTracing = useTraceAerial(gardenId);

  /*
   * Which drawer tab is showing. Selecting an object moves it to Properties —
   * that is the question the person just asked — but a deliberate switch to
   * another tab is never overridden until the next selection.
   */
  const [inspectorTab, setInspectorTab] = useState<InspectorTabId>('properties');
  const selectedObjectId = store.state.selectedObjectId;
  useEffect(() => {
    if (selectedObjectId !== null) {
      setInspectorTab('properties');
    }
  }, [selectedObjectId]);

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
      // Relative to the default view, NOT `scale * 100`: `camera.scale` is a
      // pixels-per-metre factor (24 by default), so multiplying it by 100
      // printed "2400%" for an untouched camera — a number that was a
      // percentage of nothing.
      value: `${String(Math.round((store.state.camera.scale / DEFAULT_SCALE) * 100))}%`,
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

  if (mapQuery.isPending || !mapViewReady) {
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

  // Everything the editor shows about the backdrop — whether it is drawn at
  // all, whether it is a photograph, how far the camera may zoom before it
  // stops following the drawing, and how enlarged the imagery already is —
  // decided once, from the choice, the anchor and the camera.
  const backdrop = backdropStateFor(
    store.state.backdrop,
    mapQuery.data.georeference,
    store.state.camera.scale,
  );

  return (
    <div className={styles['editor']}>
      <StaleIndicator failure={mapQuery.isError ? mapQuery.error.failure : null} />
      {mapQuery.isError && !isConnectivityFailure(mapQuery.error.failure) && (
        <FailureAlert failure={mapQuery.error.failure} />
      )}
      {mapDraft.recovered && <RecoveredDraftNotice onDiscard={mapDraft.discardRecoveredDraft} />}
      <div className={styles['body']}>
        <div className={styles['canvasWrapper']}>
          <MapCanvas
            actions={actions}
            backdrop={backdrop}
            northUpRotationDegrees={
              mapQuery.data.georeference === undefined
                ? null
                : -mapQuery.data.georeference.rotationDegrees
            }
            backdropView={
              backdrop.visible && backdrop.provider !== null ? (
                <MapBasemap
                  georeference={mapQuery.data.georeference}
                  camera={store.state.camera}
                  provider={backdrop.provider}
                />
              ) : null
            }
          />

          {/* Chrome, floating over the drawing rather than boxing it in.
              Each cluster sits where a map application puts it: tools under
              the drawing hand, the backdrop choice opposite, the draft's own
              finish/cancel beside the shape being drawn. */}
          <div className={styles['toolCluster']}>
            <MapToolbar actions={actions} />
          </div>
          <div className={styles['backdropCluster']}>
            <MapBackdropSwitch
              available={mapQuery.data.georeference !== undefined}
              backdrop={backdrop}
              tracingAerial={aerialTracing.isPending}
              onTraceAerial={() => aerialTracing.mutate()}
            />
          </div>
          <div className={styles['draftCluster']}>
            <MapDraftControls actions={actions} />
          </div>

          <MapScaleBadge georeference={mapQuery.data.georeference} backdrop={backdrop} />
          {/* First-run guidance, gone as soon as the garden holds anything.
              Suppressed while a tool is already drawing: the prompt's own
              action is what started that, and it must not sit over the shape
              being traced. */}
          {mapQuery.data.objects.length === 0 && store.state.tool === 'select' && (
            <MapEmptyPrompt
              gardenId={gardenId}
              georeferenced={mapQuery.data.georeference !== undefined}
              tracingAerial={aerialTracing.isPending}
              onTraceAerial={() => aerialTracing.mutate()}
            />
          )}
          {aerialTracing.isError && (
            <div className={styles['aerialFailure']}>
              <FailureAlert failure={aerialTracing.error.failure} />
            </div>
          )}
          {aerialTracing.data !== undefined && (
            <AerialTracingPanel
              tracing={aerialTracing.data}
              actions={actions}
              onDismiss={() => aerialTracing.reset()}
            />
          )}
        </div>

        <MapInspectorDrawer
          activeTab={inspectorTab}
          onSelectTab={setInspectorTab}
          tabs={[
            {
              id: 'properties',
              labelKey: 'map.inspector.tabProperties',
              content: (
                <MapPropertyPanel
                  gardenId={gardenId}
                  actions={actions}
                  selectedRecord={actions.selectedRecord}
                />
              ),
            },
            {
              id: 'objects',
              labelKey: 'map.inspector.tabObjects',
              content: (
                <MapObjectList
                  actions={actions}
                  selectedObjectId={store.state.selectedObjectId}
                  onSelect={store.select}
                />
              ),
            },
            {
              id: 'backdrop',
              labelKey: 'map.inspector.tabBackdrop',
              content: (
                <>
                  {/*
                   * Where the garden IS belongs here, not only on the Overview
                   * page. Everything on this tab — the aerial backdrop, the
                   * street map, true north, a calibrated plan — is meaningless
                   * without it, and an owner looking for "set the location"
                   * looks at the map, not at settings (reported 2026-08-06).
                   * The same panel, one component, rendered in both places.
                   */}
                  <GardenLocationPanel gardenId={gardenId} />
                  <MapLayerPanel actions={actions} />
                  <ImportedBackgroundPanel gardenId={gardenId} actions={actions} />
                  <CalibrationPanel gardenId={gardenId} actions={actions} />
                </>
              ),
            },
            {
              id: 'warnings',
              labelKey: 'map.inspector.tabWarnings',
              badge: mapQuery.data.validationSummary.length,
              content: (
                <MapWarningsPanel
                  warnings={mapQuery.data.validationSummary}
                  findRecord={actions.findRecord}
                  onSelectObject={store.select}
                />
              ),
            },
          ]}
        />
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
