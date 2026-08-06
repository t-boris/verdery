'use client';

import type Konva from 'konva';
import { useRef } from 'react';

import type { MapCamera } from './types';
import { panCamera } from './viewport';

interface PanSession {
  readonly pointer: { readonly x: number; readonly y: number };
  readonly camera: MapCamera;
}

export interface StagePanOptions {
  readonly enabled: boolean;
  readonly camera: MapCamera;
  readonly onCameraChange: (camera: MapCamera) => void;
}

/**
 * Pointer-driven canvas panning shared by the Konva drawing and MapLibre
 * backdrop.
 *
 * Native Konva stage dragging only translates the Konva canvas during the
 * gesture. The sibling photographic backdrop stays still and then jumps when
 * drag-end finally updates the camera. Updating the actual camera on every
 * pointer move keeps both renderers on the same transform throughout.
 */
export function useStagePan({ enabled, camera, onCameraChange }: StagePanOptions) {
  const session = useRef<PanSession | null>(null);
  const suppressClickUntil = useRef(0);

  const start = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!enabled || stage === null || stage === undefined || event.target !== stage || !pointer) {
      return;
    }
    session.current = { pointer, camera };
  };

  const move = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): boolean => {
    const active = session.current;
    const pointer = event.target.getStage()?.getPointerPosition();
    if (active === null || pointer === null || pointer === undefined) {
      return false;
    }

    const dx = pointer.x - active.pointer.x;
    const dy = pointer.y - active.pointer.y;
    if (Math.hypot(dx, dy) >= 3) {
      // Konva emits a click immediately after a pointer pan. Suppress only
      // that synthetic click, never the person's next deliberate click.
      suppressClickUntil.current = Date.now() + 500;
    }
    onCameraChange(panCamera(active.camera, dx, dy));
    return true;
  };

  const end = () => {
    session.current = null;
  };

  const consumeClick = (): boolean => {
    const suppressed = Date.now() <= suppressClickUntil.current;
    suppressClickUntil.current = 0;
    return suppressed;
  };

  return { start, move, end, consumeClick };
}
