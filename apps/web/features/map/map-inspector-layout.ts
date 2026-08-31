export type MapInspectorWidth = 'narrow' | 'standard' | 'wide';

export const MAP_INSPECTOR_WIDTH_CSS: Readonly<Record<MapInspectorWidth, string>> = {
  narrow: '18rem',
  standard: 'var(--pane-inspector)',
  wide: '25rem',
};

const WIDTH_ORDER: readonly MapInspectorWidth[] = ['narrow', 'standard', 'wide'];

export function narrowerInspectorWidth(width: MapInspectorWidth): MapInspectorWidth {
  return WIDTH_ORDER[Math.max(0, WIDTH_ORDER.indexOf(width) - 1)] ?? 'narrow';
}

export function widerInspectorWidth(width: MapInspectorWidth): MapInspectorWidth {
  return WIDTH_ORDER[Math.min(WIDTH_ORDER.length - 1, WIDTH_ORDER.indexOf(width) + 1)] ?? 'wide';
}

function storageKey(gardenId: string): string {
  return `verdery.map.inspector-width.${gardenId}`;
}

export function loadInspectorWidth(storage: Storage, gardenId: string): MapInspectorWidth {
  const stored = storage.getItem(storageKey(gardenId));
  return stored === 'narrow' || stored === 'wide' || stored === 'standard' ? stored : 'standard';
}

export function saveInspectorWidth(
  storage: Storage,
  gardenId: string,
  width: MapInspectorWidth,
): void {
  storage.setItem(storageKey(gardenId), width);
}
