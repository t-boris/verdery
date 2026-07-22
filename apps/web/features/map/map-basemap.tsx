'use client';

import { AttributionControl, Map as MaplibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';

import type { WireGeoreference } from '@/core/api/public';

import { openFreeMapProvider, zoomForMetresPerPixel } from './basemap-provider';
import styles from './map-basemap.module.css';
import type { MapCamera } from './types';

export interface MapBasemapProps {
  readonly georeference: WireGeoreference | undefined;
  readonly camera: MapCamera;
}

/**
 * Optional geographic context rendered behind the Konva stage.
 *
 * Renders nothing when the garden has no georeference — Konva-only
 * rendering, centered on the objects' own bounding box, is the documented
 * default. No command this pass wires can create a `Georeference` (it is a
 * distinct write path from `upsertCalibration`, which calibrates an imported
 * *image*, not the garden's geographic anchor — see this work package's
 * final report), so this component is implemented and unit-tested against
 * `basemap-provider.ts`'s transform but is not reachable in a live demo
 * without a garden that already has a georeference from another source.
 *
 * Source: architecture/map-rendering-and-editing.md, sections "3.2 Geographic
 * Space", "13. Web Rendering" ("A synchronization adapter keeps viewport
 * transforms aligned without coupling domain state to either engine").
 */
export function MapBasemap({ georeference, camera }: MapBasemapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);

  // Creates (and tears down) the MapLibre instance whenever the georeference
  // itself changes — a new calibration revision warrants a fresh map, since
  // the anchor it re-centers on has moved. Ordinary camera panning/zooming is
  // handled by the sync effect below without recreating the map.
  useEffect(() => {
    if (georeference === undefined || containerRef.current === null) {
      return;
    }

    const [longitude, latitude] = openFreeMapProvider.localToGeographic(
      [camera.centerX, camera.centerY],
      georeference,
    );

    const map = new MaplibreMap({
      container: containerRef.current,
      style: openFreeMapProvider.styleUrl,
      center: [longitude, latitude],
      zoom: zoomForMetresPerPixel(1 / camera.scale, latitude),
      attributionControl: false,
      interactive: false,
    });
    map.addControl(
      new AttributionControl({
        customAttribution: [openFreeMapProvider.attributionHtml],
      }),
    );
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [georeference]);

  // Keeps the basemap's viewport aligned with the local camera without
  // rebuilding the map instance — the "synchronization adapter" the
  // architecture doc calls for, kept local to this component rather than
  // coupling Konva's camera state to MapLibre's.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || georeference === undefined) {
      return;
    }

    const [longitude, latitude] = openFreeMapProvider.localToGeographic(
      [camera.centerX, camera.centerY],
      georeference,
    );
    map.jumpTo({
      center: [longitude, latitude],
      zoom: zoomForMetresPerPixel(1 / camera.scale, latitude),
    });
  }, [camera, georeference]);

  if (georeference === undefined) {
    return null;
  }

  return <div ref={containerRef} className={styles['basemap']} aria-hidden="true" />;
}
