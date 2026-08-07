'use client';

import { useEffect, useState } from 'react';

import type { BackdropKind, MapEditorStore, MapViewPreferences } from './editor-store';
import type { LayerId } from './map-layers';

const STORAGE_PREFIX = 'verdery.map.view.v2';
const LEGACY_STORAGE_PREFIX = 'verdery.map.view.v1';
const LAYERS: readonly LayerId[] = [2, 3, 4, 5];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseLayers(value: unknown): readonly LayerId[] | null {
  if (!Array.isArray(value) || value.some((layer) => !LAYERS.includes(layer as LayerId))) {
    return null;
  }
  return [...new Set(value as LayerId[])];
}

function parseBackdrop(value: unknown): BackdropKind | null {
  return value === 'imagery' || value === 'streets' || value === 'none' ? value : null;
}

export function parseMapViewPreferences(raw: string): MapViewPreferences | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const camera = value['camera'] as Record<string, unknown> | undefined;
    const hiddenLayers = parseLayers(value['hiddenLayers']);
    const lockedLayers = parseLayers(value['lockedLayers']);
    const backdrop = parseBackdrop(value['backdrop']);
    const backgroundOpacity = value['backgroundOpacity'];
    if (
      camera === undefined ||
      !isFiniteNumber(camera['centerX']) ||
      !isFiniteNumber(camera['centerY']) ||
      !isFiniteNumber(camera['scale']) ||
      camera['scale'] <= 0 ||
      !isFiniteNumber(camera['rotationDegrees']) ||
      hiddenLayers === null ||
      lockedLayers === null ||
      backdrop === null ||
      !isFiniteNumber(backgroundOpacity) ||
      backgroundOpacity < 0.15 ||
      backgroundOpacity > 1
    ) {
      return null;
    }
    return {
      camera: {
        centerX: camera['centerX'],
        centerY: camera['centerY'],
        scale: camera['scale'],
        rotationDegrees: camera['rotationDegrees'],
      },
      hiddenLayers,
      lockedLayers,
      backdrop,
      backgroundOpacity,
    };
  } catch {
    return null;
  }
}

/** Keeps the version-1 view but removes its implicit lot/layout locks. */
export function migrateLegacyMapViewPreferences(raw: string): MapViewPreferences | null {
  const preferences = parseMapViewPreferences(raw);
  return preferences === null ? null : { ...preferences, lockedLayers: [] };
}

/** Restores and then continuously saves the per-garden map viewport and layer preferences. */
export function useMapViewPersistence(gardenId: string, store: MapEditorStore): boolean {
  const [ready, setReady] = useState(false);
  const { camera, hiddenLayers, lockedLayers, backgroundOpacity, backdrop } = store.state;

  useEffect(() => {
    const stored = globalThis.localStorage.getItem(`${STORAGE_PREFIX}.${gardenId}`);
    const currentPreferences = stored === null ? null : parseMapViewPreferences(stored);
    const legacyStored = globalThis.localStorage.getItem(`${LEGACY_STORAGE_PREFIX}.${gardenId}`);
    const legacyPreferences =
      currentPreferences === null && legacyStored !== null
        ? migrateLegacyMapViewPreferences(legacyStored)
        : null;
    // Version 1 silently locked the two principal editing layers by default.
    // Preserve every other per-garden preference during migration, but clear
    // those ambiguous legacy locks once. Version 2 persists all later lock
    // choices exactly as the gardener makes them.
    const preferences = currentPreferences ?? legacyPreferences;
    if (preferences !== null) {
      store.restoreViewPreferences(preferences);
    }
    setReady(true);
  }, [gardenId]);

  useEffect(() => {
    if (!ready) return;
    const timer = globalThis.setTimeout(() => {
      const preferences: MapViewPreferences = {
        camera,
        hiddenLayers,
        lockedLayers,
        backgroundOpacity,
        backdrop,
      };
      globalThis.localStorage.setItem(`${STORAGE_PREFIX}.${gardenId}`, JSON.stringify(preferences));
    }, 200);
    return () => globalThis.clearTimeout(timer);
  }, [backdrop, backgroundOpacity, camera, gardenId, hiddenLayers, lockedLayers, ready]);

  return ready;
}
