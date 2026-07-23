/**
 * Per-category canvas presentation: fill/stroke colour, a short glyph, and a
 * line dash pattern.
 *
 * The glyph and dash pattern exist so category is never carried by colour
 * alone — two categories with similar hues (say `zone` and `bed`, both
 * greens) still read as different shapes because their glyphs differ, not
 * only because a viewer can distinguish the exact shade.
 *
 * Source: architecture/map-rendering-and-editing.md, section "19. Accessibility"
 * ("Non-color confidence and state indicators").
 */

import type { GardenObjectCategory } from '@verdery/geometry-contracts';

export interface CategoryStyle {
  readonly fill: string;
  readonly stroke: string;
  /** Short, category-distinct label rendered on or beside the shape. */
  readonly glyph: string;
  /** Konva `dash` array; `undefined` means a solid line. */
  readonly dash?: readonly number[];
  /** Point-category circle radius in local metres. */
  readonly pointRadiusMetres: number;
}

const DASHED: readonly number[] = [8, 6];
const DOTTED: readonly number[] = [2, 4];

const STYLES: Readonly<Record<GardenObjectCategory, CategoryStyle>> = {
  lot: { fill: 'rgba(20, 83, 45, 0.05)', stroke: '#14532d', glyph: 'LOT', pointRadiusMetres: 0 },
  structure: {
    fill: 'rgba(120, 53, 15, 0.25)',
    stroke: '#78350f',
    glyph: 'BLD',
    pointRadiusMetres: 0,
  },
  fence: { fill: 'transparent', stroke: '#57534e', glyph: 'FNC', pointRadiusMetres: 0 },
  gate: { fill: '#b45309', stroke: '#78350f', glyph: 'GT', pointRadiusMetres: 0.3 },
  path: {
    fill: 'transparent',
    stroke: '#a8a29e',
    glyph: 'PTH',
    dash: DASHED,
    pointRadiusMetres: 0,
  },
  zone: { fill: 'rgba(101, 163, 13, 0.2)', stroke: '#4d7c0f', glyph: 'ZN', pointRadiusMetres: 0 },
  bed: { fill: 'rgba(180, 83, 9, 0.22)', stroke: '#9a3412', glyph: 'BED', pointRadiusMetres: 0 },
  waterFeature: {
    fill: 'rgba(14, 116, 144, 0.28)',
    stroke: '#0e7490',
    glyph: 'WTR',
    pointRadiusMetres: 0,
  },
  utilityExclusion: {
    fill: 'rgba(190, 18, 60, 0.12)',
    stroke: '#be123c',
    glyph: 'UTL',
    dash: DOTTED,
    pointRadiusMetres: 0,
  },
  tree: { fill: '#15803d', stroke: '#14532d', glyph: 'T', pointRadiusMetres: 0.5 },
  plant: { fill: '#65a30d', stroke: '#3f6212', glyph: 'P', pointRadiusMetres: 0.25 },
  annotation: { fill: '#7c3aed', stroke: '#5b21b6', glyph: 'i', pointRadiusMetres: 0.2 },
  importedBackground: {
    fill: 'rgba(100, 116, 139, 0.15)',
    stroke: '#64748b',
    glyph: 'BG',
    dash: DOTTED,
    pointRadiusMetres: 0,
  },
};

export function styleForCategory(category: GardenObjectCategory): CategoryStyle {
  return STYLES[category];
}

export const SELECTION_STROKE = '#2563eb';
export const DRAFT_STROKE = '#2563eb';
/** Distinct from `SELECTION_STROKE`/`DRAFT_STROKE`'s blue so an active snap (`snapping.ts`) reads as its own signal, not a selection or draft-line color. */
export const SNAP_INDICATOR_STROKE = '#f97316';
