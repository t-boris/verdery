import type { GardenObjectCategory } from '@verdery/geometry-contracts';

import type { MessageKey } from '@/shared/localization/public';

import { creatableCategoryOfTool, type ToolMode } from './types';

/**
 * Message key for a category's display name — every category, not only the
 * five the toolbar can create. A `switch` rather than a template-literal cast
 * so adding a fourteenth category without a matching `map.category.*` key is
 * a compile error, not a silent fallback string at runtime.
 */
export function categoryLabelKey(category: GardenObjectCategory): MessageKey {
  switch (category) {
    case 'lot':
      return 'map.category.lot';
    case 'structure':
      return 'map.category.structure';
    case 'fence':
      return 'map.category.fence';
    case 'gate':
      return 'map.category.gate';
    case 'path':
      return 'map.category.path';
    case 'zone':
      return 'map.category.zone';
    case 'bed':
      return 'map.category.bed';
    case 'waterFeature':
      return 'map.category.waterFeature';
    case 'utilityExclusion':
      return 'map.category.utilityExclusion';
    case 'tree':
      return 'map.category.tree';
    case 'plant':
      return 'map.category.plant';
    case 'annotation':
      return 'map.category.annotation';
    case 'importedBackground':
      return 'map.category.importedBackground';
  }
}

/**
 * Message key naming the active tool, for the status bar's readout.
 *
 * Reuses `categoryLabelKey` for every creation tool rather than a second
 * `map.toolbar.create*` lookup: the footer states WHAT is being drawn ("Bed"),
 * not the imperative the rail's tooltip uses ("Draw a bed").
 */
export function toolLabelKey(tool: ToolMode): MessageKey {
  const category = creatableCategoryOfTool(tool);
  return category === null ? 'map.toolbar.select' : categoryLabelKey(category);
}
