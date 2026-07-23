import type { GardenObjectCategory } from '@verdery/geometry-contracts';

import type { MessageKey } from '@/shared/localization/public';

/**
 * The logical layer model from `docs/architecture/map-rendering-and-editing.md`,
 * section "12. Layer Model": 7 ordered layers. This feature exposes user
 * visibility/lock toggles for layers 2 through 5 only — see `map-layer-panel.tsx`.
 *
 * - Layer 1 (geographic basemap) is not covered here: `map-basemap.tsx`
 *   already renders nothing when the garden has no `Georeference`, and no
 *   command this pass wires can create one (see that component's own doc
 *   comment) — there is no independent on/off state to add a toggle for yet.
 * - Layer 6 (generated proposals) has no `GardenObjectCategory` of its own —
 *   assisted capture and proposal review is Phase 10 scope (see `commands.ts`'s
 *   module doc comment) — so there is nothing a toggle could filter. Omitted
 *   from `LAYER_IDS` entirely rather than built as a toggle with nothing to hide.
 * - Layer 7 (selection, handles, measurements, and validation overlays) is
 *   editor chrome, not user content, and is never user-togglable.
 *
 * `utilityExclusion` and `waterFeature` are not named explicitly in the
 * architecture doc's layer 4 list ("zones, beds, paths, and fences"). Both are
 * bounded-area categories in the same sense as zone/bed, so this feature
 * assigns them to layer 4 by the same logic, though the doc does not spell
 * this out.
 */
export type LayerId = 2 | 3 | 4 | 5;

/** Every user-togglable layer, in display order. */
export const LAYER_IDS: readonly LayerId[] = [2, 3, 4, 5];

/**
 * Maps every garden object category onto the layer it visually belongs to.
 * A `switch` over `GardenObjectCategory`, not a lookup table, so adding a
 * fourteenth category without extending this mapping is a compile error
 * rather than an object that silently never appears in any layer's filter.
 */
export function layerForCategory(category: GardenObjectCategory): LayerId {
  switch (category) {
    case 'importedBackground':
      return 2;
    case 'lot':
    case 'structure':
      return 3;
    case 'zone':
    case 'bed':
    case 'path':
    case 'fence':
    case 'gate':
    case 'utilityExclusion':
    case 'waterFeature':
      return 4;
    case 'tree':
    case 'plant':
    case 'annotation':
      return 5;
  }
}

/** Display name for each togglable layer, shown in `map-layer-panel.tsx`. */
export const LAYER_LABEL_KEY: Readonly<Record<LayerId, MessageKey>> = {
  2: 'map.layers.importedBackgrounds',
  3: 'map.layers.lotAndStructures',
  4: 'map.layers.zonesBedsPathsFences',
  5: 'map.layers.plantsAndAnnotations',
};

export function isLayerHidden(layer: LayerId, hiddenLayers: readonly LayerId[]): boolean {
  return hiddenLayers.includes(layer);
}

export function isLayerLocked(layer: LayerId, lockedLayers: readonly LayerId[]): boolean {
  return lockedLayers.includes(layer);
}

/** True when `category`'s layer is currently hidden — the canvas and object list both filter on this. */
export function isCategoryHidden(
  category: GardenObjectCategory,
  hiddenLayers: readonly LayerId[],
): boolean {
  return isLayerHidden(layerForCategory(category), hiddenLayers);
}

/** True when `category`'s layer is currently locked — every mutating interaction gates on this. */
export function isCategoryLocked(
  category: GardenObjectCategory,
  lockedLayers: readonly LayerId[],
): boolean {
  return isLayerLocked(layerForCategory(category), lockedLayers);
}
