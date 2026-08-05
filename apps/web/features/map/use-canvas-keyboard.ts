'use client';

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { MapEditorStore } from './editor-store';
import type { CanvasSize, MapCamera } from './types';
import type { MapEditorActions } from './use-map-editor-actions';
import { panCamera } from './viewport';

const NUDGE_METRES = 0.1;
const NUDGE_METRES_FAST = 1;

/** One arrow-key press of camera movement, in screen pixels. Shift multiplies it. */
const PAN_SCREEN_PIXELS = 40;
const PAN_SCREEN_PIXELS_FAST = 200;

/** Screen-space unit direction for each arrow key: y grows downward on screen. */
const ARROW_DIRECTIONS: Readonly<Record<string, { readonly x: number; readonly y: number }>> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

function isEditableElement(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export interface CanvasKeyboardDeps {
  readonly store: MapEditorStore;
  readonly actions: MapEditorActions;
  readonly camera: MapCamera;
  readonly size: CanvasSize;
  readonly isDrafting: boolean;
  /** Zoom by a factor about a pivot, already held to what the backdrop can follow. */
  readonly zoomBy: (pivot: { readonly x: number; readonly y: number }, factor: number) => void;
  readonly zoomInFactor: number;
  readonly zoomOutFactor: number;
}

/**
 * The canvas's keyboard contract, in one place: escape, finish, delete, zoom,
 * and arrows that either nudge the selected object or pan the camera.
 *
 * Lifted out of `map-canvas.tsx` when that file passed the repository's
 * 600-line limit. It is a natural seam — none of this touches Konva, and the
 * keyboard is the accessible route to a surface whose other gestures are all
 * pointer-only.
 */
export function createCanvasKeyDownHandler(deps: CanvasKeyboardDeps) {
  const { store, actions, camera, size, isDrafting, zoomBy, zoomInFactor, zoomOutFactor } = deps;

  return (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (isEditableElement(event.target)) {
      return;
    }

    if (event.key === 'Escape') {
      if (isDrafting && store.state.draftPoints.length > 0) {
        store.setDraftPoints([]);
      } else {
        store.setTool('select');
        store.select(null);
      }
      return;
    }

    if (isDrafting && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      void actions.finishDraft();
      return;
    }

    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      store.state.selectedObjectId !== null
    ) {
      event.preventDefault();
      void actions.deleteObject(store.state.selectedObjectId);
      return;
    }

    // Zoom is keyboard-reachable as well as wheel-reachable: the wheel and
    // the pinch gesture were the only ways to change scale, which left a
    // keyboard-only reader unable to see anything outside the initial fit.
    // `=` is the unshifted key that carries `+` on most layouts.
    if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      const pivot = { x: size.width / 2, y: size.height / 2 };
      zoomBy(pivot, event.key === '-' ? zoomOutFactor : zoomInFactor);
      return;
    }

    const arrow = ARROW_DIRECTIONS[event.key];
    if (arrow === undefined) {
      return;
    }
    event.preventDefault();

    // With an object selected the arrows nudge it; with nothing selected they
    // pan the camera, which is the only keyboard way to reach a part of the
    // garden that is currently off screen.
    if (store.state.selectedObjectId === null) {
      const step = event.shiftKey ? PAN_SCREEN_PIXELS_FAST : PAN_SCREEN_PIXELS;
      store.setCamera(panCamera(camera, -arrow.x * step, -arrow.y * step));
      return;
    }

    const nudge = event.shiftKey ? NUDGE_METRES_FAST : NUDGE_METRES;
    void actions.moveObject(store.state.selectedObjectId, arrow.x * nudge, -arrow.y * nudge);
  };
}
