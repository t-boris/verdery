'use client';

import { AttributionControl, Map as MaplibreMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';

import type { WireGeoreference } from '@/core/api/public';

import {
  openFreeMapProvider,
  zoomForMetresPerPixel,
  type BasemapProvider,
} from './basemap-provider';
import styles from './map-basemap.module.css';
import type { MapCamera } from './types';

export interface MapBasemapProps {
  readonly georeference: WireGeoreference | undefined;
  readonly camera: MapCamera;
  /** Which provider to render. Defaults to the street map this component started with. */
  readonly provider?: BasemapProvider;
}

/**
 * A MapLibre style for either kind of provider.
 *
 * A vector provider already has one and hands over its URL. A raster provider
 * has tiles, so the style is built here — this component is the only file
 * that imports `maplibre-gl`, and building the style anywhere else would
 * spread that dependency.
 */
function styleFor(provider: BasemapProvider): string | StyleSpecification {
  if (provider.source.kind === 'vectorStyle') {
    return provider.source.styleUrl;
  }

  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: [...provider.source.tiles],
        tileSize: provider.source.tileSize,
        maxzoom: provider.source.maxZoom,
        attribution: provider.attributionHtml,
      },
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
  };
}

/**
 * Optional geographic context rendered behind the Konva stage.
 *
 * Renders nothing when the garden has no georeference — Konva-only
 * rendering, centered on the objects' own bounding box, is the documented
 * default. Until P12-GEO-01 that was the only state anyone could reach, since
 * nothing could write a `Georeference`; `PUT /gardens/{gardenId}/georeference`
 * changed that, and this component is now what a person sees behind their own
 * garden.
 *
 * Which provider it renders is the caller's choice: street vectors for
 * context, or USGS aerial imagery to trace a lot from.
 *
 * Source: architecture/map-rendering-and-editing.md, sections "3.2 Geographic
 * Space", "13. Web Rendering" ("A synchronization adapter keeps viewport
 * transforms aligned without coupling domain state to either engine").
 */
export function MapBasemap({
  georeference,
  camera,
  provider = openFreeMapProvider,
}: MapBasemapProps) {
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

    const [longitude, latitude] = provider.localToGeographic(
      [camera.centerX, camera.centerY],
      georeference,
    );

    const map = new MaplibreMap({
      container: containerRef.current,
      style: styleFor(provider),
      center: [longitude, latitude],
      zoom: zoomForMetresPerPixel(1 / camera.scale, latitude),
      attributionControl: false,
      interactive: false,
    });
    map.addControl(
      new AttributionControl({
        customAttribution: [provider.attributionHtml],
      }),
    );
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Switching provider rebuilds the map: a style change is what a new
    // provider IS, and MapLibre's own `setStyle` would keep the old source
    // alive behind it.
  }, [georeference, provider]);

  // Keeps the basemap's viewport aligned with the local camera without
  // rebuilding the map instance — the "synchronization adapter" the
  // architecture doc calls for, kept local to this component rather than
  // coupling Konva's camera state to MapLibre's.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || georeference === undefined) {
      return;
    }

    const [longitude, latitude] = provider.localToGeographic(
      [camera.centerX, camera.centerY],
      georeference,
    );
    map.jumpTo({
      center: [longitude, latitude],
      zoom: zoomForMetresPerPixel(1 / camera.scale, latitude),
    });
  }, [camera, georeference, provider]);

  if (georeference === undefined) {
    return null;
  }

  return <div ref={containerRef} className={styles['basemap']} aria-hidden="true" />;
}
