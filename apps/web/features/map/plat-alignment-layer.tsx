'use client';

import { useMapEditorStore } from './editor-store';
import { PlatAlignmentOverlay } from './shapes/plat-alignment-overlay';
import type { CanvasSize, MapCamera } from './types';

export function PlatAlignmentLayer({
  camera,
  size,
}: {
  readonly camera: MapCamera;
  readonly size: CanvasSize;
}) {
  const store = useMapEditorStore();
  const draft = store.state.platAlignmentDraft;
  if (draft === null) return null;
  return (
    <PlatAlignmentOverlay
      draft={draft}
      camera={camera}
      size={size}
      onTranslate={(dx, dy) =>
        store.setPlatAlignmentTransform({
          ...draft.transform,
          translation: [draft.transform.translation[0] + dx, draft.transform.translation[1] + dy],
        })
      }
    />
  );
}
