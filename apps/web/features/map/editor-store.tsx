'use client';

import type {
  Geometry,
  MapCommandPayload,
  ObjectSnapshot,
  Position,
} from '@verdery/geometry-contracts';
import type { PlatReading } from '@verdery/api-contracts';
import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';

import type { MessageArguments, MessageKey } from '@/shared/localization/public';

import type { CalibrationDraft } from './calibration-session';
import type { LayerId } from './map-layers';
import type { PlatAlignmentDraft, PlatAlignmentTransform } from './plat-alignment';
import type { MapCamera, ToolMode } from './types';
import { defaultCamera } from './viewport';

/**
 * Client-side editor session state: selection, active tool, viewport camera,
 * and the undo/redo stacks — everything `architecture/map-rendering-and-editing.md`
 * section "13. Web Rendering" calls "a dedicated client-side store for
 * selection and transient state", distinct from the server state TanStack
 * Query owns in `queries.ts`.
 *
 * Undo and redo are the same operation run against opposite stacks — see
 * `use-map-editor-actions.ts`'s `stepHistory` for why one history-entry shape
 * suffices for both directions.
 */
export interface HistoryEntry {
  readonly command: MapCommandPayload;
  /** Only read back by `deriveInverseCommand` for `changeProperties`; `null` otherwise — see `use-map-editor-actions.ts`. */
  readonly priorSnapshot: ObjectSnapshot | null;
  readonly revisionAfterCommand: number;
  readonly objectId: string;
}

export interface StatusMessage {
  readonly key: MessageKey;
  readonly args?: MessageArguments;
  readonly tone: 'status' | 'alert';
}

/**
 * The selected object's interaction sub-mode: `move` explicitly enables
 * whole-object dragging, `vertexEdit` renders draggable
 * per-vertex handles (`shapes/vertex-handles.tsx`), `transform` renders the
 * whole-shape resize/rotate handles (`shapes/transform-handles.tsx`). Only
 * `move` enables whole-object drag; `idle` keeps the shape attached while
 * the pointer pans the shared camera.
 */
export type InteractionMode = 'idle' | 'move' | 'vertexEdit' | 'transform';

export interface EditorState {
  readonly selectedObjectId: string | null;
  /** Explicit working selection for atomic multi-object movement and compatible linework joining. */
  readonly multiSelectedObjectIds: readonly string[];
  readonly interactionMode: InteractionMode;
  readonly tool: ToolMode;
  readonly camera: MapCamera;
  readonly cameraInitialized: boolean;
  /** In-progress polygon/line vertices while a `create:*` tool is drawing. Cleared on every tool change. */
  readonly draftPoints: readonly Position[];
  /** A completed gate draft awaiting the user's fence pick before `createObject` is built — see `use-map-editor-actions.ts`. */
  readonly pendingGateGeometry: Geometry | null;
  readonly undoStack: readonly HistoryEntry[];
  readonly redoStack: readonly HistoryEntry[];
  readonly status: StatusMessage | null;
  /**
   * Layer visibility/locking (`map-layers.ts`, `map-layer-panel.tsx`): a user
   * preference, not server-persisted domain state — architecture doc section
   * "12. Layer Model" ("Layer visibility and opacity are user preferences").
   * Defaults to all layers unlocked. A lock is an explicit user choice; it
   * must never make a newly opened garden look broken or disable creation.
   */
  readonly hiddenLayers: readonly LayerId[];
  readonly lockedLayers: readonly LayerId[];
  /** The in-progress calibration session (P6-PLAN-02), or `null`. Cleared by any selection or tool change — the session is bound to one selected background. */
  readonly calibrationDraft: CalibrationDraft | null;
  /** One plat review aligned as a rigid group before any object is persisted. */
  readonly platAlignmentDraft: PlatAlignmentDraft | null;
  /**
   * Plan-underlay opacity while tracing (0.15..1) — a client-local
   * preference like layer visibility, applied to every background's
   * imagery so traced linework stays legible over a dense plan.
   */
  readonly backgroundOpacity: number;
  /**
   * What is drawn behind the garden (P12-GEO-01): aerial imagery to trace a
   * lot from, street vectors for context, or nothing. A client-local
   * preference like layer visibility — no command, no round trip. Imagery is
   * the default because tracing is what someone opens a georeferenced,
   * still-empty garden to do.
   */
  readonly backdrop: BackdropKind;
}

export interface MapViewPreferences {
  readonly camera: MapCamera;
  readonly hiddenLayers: readonly LayerId[];
  readonly lockedLayers: readonly LayerId[];
  readonly backgroundOpacity: number;
  readonly backdrop: BackdropKind;
}

/** The three backdrops the editor offers. `none` is Konva alone, the pre-georeference default. */
export type BackdropKind = 'imagery' | 'streets' | 'none';

type Action =
  | { readonly type: 'select'; readonly objectId: string | null }
  | { readonly type: 'toggleMultiSelect'; readonly objectId: string }
  | { readonly type: 'clearMultiSelect' }
  | { readonly type: 'setInteractionMode'; readonly mode: InteractionMode }
  | { readonly type: 'setTool'; readonly tool: ToolMode }
  | { readonly type: 'setCamera'; readonly camera: MapCamera }
  | { readonly type: 'initCamera'; readonly camera: MapCamera }
  | { readonly type: 'setDraftPoints'; readonly points: readonly Position[] }
  | { readonly type: 'setPendingGateGeometry'; readonly geometry: Geometry | null }
  | { readonly type: 'pushForward'; readonly entry: HistoryEntry }
  | { readonly type: 'undoApplied'; readonly redoEntry: HistoryEntry }
  | { readonly type: 'redoApplied'; readonly undoEntry: HistoryEntry }
  | { readonly type: 'setStatus'; readonly status: StatusMessage | null }
  | { readonly type: 'toggleLayerVisibility'; readonly layer: LayerId }
  | { readonly type: 'toggleLayerLock'; readonly layer: LayerId }
  | { readonly type: 'setCalibrationDraft'; readonly draft: CalibrationDraft | null }
  | { readonly type: 'startPlatAlignment'; readonly reading: PlatReading }
  | { readonly type: 'setPlatAlignmentTransform'; readonly transform: PlatAlignmentTransform }
  | { readonly type: 'clearPlatAlignment' }
  | { readonly type: 'setBackgroundOpacity'; readonly opacity: number }
  | { readonly type: 'setBackdrop'; readonly backdrop: BackdropKind }
  | { readonly type: 'restoreViewPreferences'; readonly preferences: MapViewPreferences };

export const initialEditorState: EditorState = {
  selectedObjectId: null,
  multiSelectedObjectIds: [],
  interactionMode: 'idle',
  tool: 'select',
  camera: defaultCamera(),
  cameraInitialized: false,
  draftPoints: [],
  pendingGateGeometry: null,
  undoStack: [],
  redoStack: [],
  status: null,
  hiddenLayers: [],
  lockedLayers: [],
  calibrationDraft: null,
  platAlignmentDraft: null,
  backgroundOpacity: 0.85,
  backdrop: 'imagery',
};

/** Exported for `editor-store.test.ts` — the reducer is pure and needs no provider to test. */
export function editorReducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    // Changing the selection always leaves any vertex-edit/transform mode
    // and abandons an in-progress calibration session — all are drawn for
    // exactly one selected object.
    case 'select':
      return {
        ...state,
        selectedObjectId: action.objectId,
        interactionMode: 'idle',
        calibrationDraft: null,
      };
    case 'toggleMultiSelect':
      return {
        ...state,
        multiSelectedObjectIds: state.multiSelectedObjectIds.includes(action.objectId)
          ? state.multiSelectedObjectIds.filter((id) => id !== action.objectId)
          : [...state.multiSelectedObjectIds, action.objectId],
      };
    case 'clearMultiSelect':
      return { ...state, multiSelectedObjectIds: [] };
    case 'setInteractionMode':
      return { ...state, interactionMode: action.mode };
    // A tool change always abandons whatever draft, pending gate pick, or
    // interaction mode was in progress — there is no "resume" concept across
    // a tool switch.
    case 'setTool':
      return {
        ...state,
        tool: action.tool,
        draftPoints: [],
        pendingGateGeometry: null,
        interactionMode: 'idle',
        calibrationDraft: null,
      };
    case 'setCamera':
      return { ...state, camera: action.camera };
    case 'initCamera':
      return state.cameraInitialized
        ? state
        : { ...state, camera: action.camera, cameraInitialized: true };
    case 'setDraftPoints':
      return { ...state, draftPoints: action.points };
    case 'setPendingGateGeometry':
      return { ...state, pendingGateGeometry: action.geometry };
    // A new forward command invalidates whatever could previously be redone.
    case 'pushForward':
      return { ...state, undoStack: [...state.undoStack, action.entry], redoStack: [] };
    case 'undoApplied':
      return {
        ...state,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, action.redoEntry],
      };
    case 'redoApplied':
      return {
        ...state,
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, action.undoEntry],
      };
    case 'setStatus':
      return { ...state, status: action.status };
    case 'toggleLayerVisibility':
      return {
        ...state,
        hiddenLayers: state.hiddenLayers.includes(action.layer)
          ? state.hiddenLayers.filter((layer) => layer !== action.layer)
          : [...state.hiddenLayers, action.layer],
      };
    case 'toggleLayerLock':
      return {
        ...state,
        lockedLayers: state.lockedLayers.includes(action.layer)
          ? state.lockedLayers.filter((layer) => layer !== action.layer)
          : [...state.lockedLayers, action.layer],
      };
    case 'setCalibrationDraft':
      return { ...state, calibrationDraft: action.draft };
    case 'startPlatAlignment':
      return {
        ...state,
        platAlignmentDraft: {
          reading: action.reading,
          transform: { translation: [0, 0], rotationDegrees: 0, scale: 1 },
        },
      };
    case 'setPlatAlignmentTransform':
      return state.platAlignmentDraft === null
        ? state
        : {
            ...state,
            platAlignmentDraft: { ...state.platAlignmentDraft, transform: action.transform },
          };
    case 'clearPlatAlignment':
      return { ...state, platAlignmentDraft: null };
    case 'setBackgroundOpacity':
      // Clamped so the imagery can be dimmed for tracing but never made
      // fully invisible through this control — hiding is the visibility
      // toggle's job.
      return { ...state, backgroundOpacity: Math.min(1, Math.max(0.15, action.opacity)) };
    case 'setBackdrop':
      return { ...state, backdrop: action.backdrop };
    case 'restoreViewPreferences':
      return {
        ...state,
        camera: action.preferences.camera,
        cameraInitialized: true,
        hiddenLayers: action.preferences.hiddenLayers,
        lockedLayers: action.preferences.lockedLayers,
        backgroundOpacity: action.preferences.backgroundOpacity,
        backdrop: action.preferences.backdrop,
      };
  }
}

export interface MapEditorStore {
  readonly state: EditorState;
  readonly select: (objectId: string | null) => void;
  readonly toggleMultiSelect: (objectId: string) => void;
  readonly clearMultiSelect: () => void;
  readonly setInteractionMode: (mode: InteractionMode) => void;
  readonly setTool: (tool: ToolMode) => void;
  readonly setCamera: (camera: MapCamera) => void;
  readonly initCamera: (camera: MapCamera) => void;
  readonly setDraftPoints: (points: readonly Position[]) => void;
  readonly setPendingGateGeometry: (geometry: Geometry | null) => void;
  readonly pushForward: (entry: HistoryEntry) => void;
  readonly applyUndoStep: (redoEntry: HistoryEntry) => void;
  readonly applyRedoStep: (undoEntry: HistoryEntry) => void;
  readonly setStatus: (status: StatusMessage | null) => void;
  readonly toggleLayerVisibility: (layer: LayerId) => void;
  readonly toggleLayerLock: (layer: LayerId) => void;
  readonly setCalibrationDraft: (draft: CalibrationDraft | null) => void;
  readonly startPlatAlignment: (reading: PlatReading) => void;
  readonly setPlatAlignmentTransform: (transform: PlatAlignmentTransform) => void;
  readonly clearPlatAlignment: () => void;
  readonly setBackgroundOpacity: (opacity: number) => void;
  readonly setBackdrop: (backdrop: BackdropKind) => void;
  readonly restoreViewPreferences: (preferences: MapViewPreferences) => void;
}

const MapEditorContext = createContext<MapEditorStore | null>(null);

export function MapEditorStoreProvider({ children }: { readonly children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);

  const store = useMemo<MapEditorStore>(
    () => ({
      state,
      select: (objectId) => dispatch({ type: 'select', objectId }),
      toggleMultiSelect: (objectId) => dispatch({ type: 'toggleMultiSelect', objectId }),
      clearMultiSelect: () => dispatch({ type: 'clearMultiSelect' }),
      setInteractionMode: (mode) => dispatch({ type: 'setInteractionMode', mode }),
      setTool: (tool) => dispatch({ type: 'setTool', tool }),
      setCamera: (camera) => dispatch({ type: 'setCamera', camera }),
      initCamera: (camera) => dispatch({ type: 'initCamera', camera }),
      setDraftPoints: (points) => dispatch({ type: 'setDraftPoints', points }),
      setPendingGateGeometry: (geometry) => dispatch({ type: 'setPendingGateGeometry', geometry }),
      pushForward: (entry) => dispatch({ type: 'pushForward', entry }),
      applyUndoStep: (redoEntry) => dispatch({ type: 'undoApplied', redoEntry }),
      applyRedoStep: (undoEntry) => dispatch({ type: 'redoApplied', undoEntry }),
      setStatus: (status) => dispatch({ type: 'setStatus', status }),
      toggleLayerVisibility: (layer) => dispatch({ type: 'toggleLayerVisibility', layer }),
      toggleLayerLock: (layer) => dispatch({ type: 'toggleLayerLock', layer }),
      setCalibrationDraft: (draft) => dispatch({ type: 'setCalibrationDraft', draft }),
      startPlatAlignment: (reading) => dispatch({ type: 'startPlatAlignment', reading }),
      setPlatAlignmentTransform: (transform) =>
        dispatch({ type: 'setPlatAlignmentTransform', transform }),
      clearPlatAlignment: () => dispatch({ type: 'clearPlatAlignment' }),
      setBackgroundOpacity: (opacity) => dispatch({ type: 'setBackgroundOpacity', opacity }),
      setBackdrop: (backdrop) => dispatch({ type: 'setBackdrop', backdrop }),
      restoreViewPreferences: (preferences) =>
        dispatch({ type: 'restoreViewPreferences', preferences }),
    }),
    [state],
  );

  return <MapEditorContext value={store}>{children}</MapEditorContext>;
}

export function useMapEditorStore(): MapEditorStore {
  const store = useContext(MapEditorContext);
  if (store === null) {
    throw new Error('useMapEditorStore must be used within a MapEditorStoreProvider.');
  }
  return store;
}
