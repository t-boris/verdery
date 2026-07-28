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
  lot: {
    fill: 'rgba(34, 197, 94, 0.12)',
    stroke: '#4ade80',
    glyph: 'LOT',
    pointRadiusMetres: 0,
  },
  structure: {
    fill: 'rgba(249, 115, 22, 0.28)',
    stroke: '#fb923c',
    glyph: 'BLD',
    pointRadiusMetres: 0,
  },
  fence: { fill: 'transparent', stroke: '#facc15', glyph: 'FNC', pointRadiusMetres: 0 },
  gate: { fill: '#f59e0b', stroke: '#fbbf24', glyph: 'GT', pointRadiusMetres: 0.3 },
  path: {
    fill: 'transparent',
    stroke: '#cbd5e1',
    glyph: 'PTH',
    dash: DASHED,
    pointRadiusMetres: 0,
  },
  zone: { fill: 'rgba(163, 230, 53, 0.18)', stroke: '#a3e635', glyph: 'ZN', pointRadiusMetres: 0 },
  bed: { fill: 'rgba(234, 88, 12, 0.24)', stroke: '#f97316', glyph: 'BED', pointRadiusMetres: 0 },
  waterFeature: {
    fill: 'rgba(14, 165, 233, 0.24)',
    stroke: '#38bdf8',
    glyph: 'WTR',
    pointRadiusMetres: 0,
  },
  utilityExclusion: {
    fill: 'rgba(244, 63, 94, 0.16)',
    stroke: '#fb7185',
    glyph: 'UTL',
    dash: DOTTED,
    pointRadiusMetres: 0,
  },
  tree: { fill: '#059669', stroke: '#34d399', glyph: 'T', pointRadiusMetres: 0.5 },
  plant: { fill: '#65a30d', stroke: '#bef264', glyph: 'P', pointRadiusMetres: 0.25 },
  annotation: { fill: '#9333ea', stroke: '#c084fc', glyph: 'i', pointRadiusMetres: 0.2 },
  importedBackground: {
    fill: 'rgba(148, 163, 184, 0.15)',
    stroke: '#94a3b8',
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
