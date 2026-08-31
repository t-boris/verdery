import { describe, expect, it } from 'vitest';

import {
  loadInspectorWidth,
  narrowerInspectorWidth,
  saveInspectorWidth,
  widerInspectorWidth,
} from './map-inspector-layout';

describe('map inspector width preferences', () => {
  it('moves only within the supported readable width presets', () => {
    expect(narrowerInspectorWidth('narrow')).toBe('narrow');
    expect(narrowerInspectorWidth('wide')).toBe('standard');
    expect(widerInspectorWidth('narrow')).toBe('standard');
    expect(widerInspectorWidth('wide')).toBe('wide');
  });

  it('persists width per garden and ignores an unsupported stored value', () => {
    window.localStorage.clear();
    saveInspectorWidth(window.localStorage, 'garden-a', 'wide');

    expect(loadInspectorWidth(window.localStorage, 'garden-a')).toBe('wide');
    expect(loadInspectorWidth(window.localStorage, 'garden-b')).toBe('standard');

    window.localStorage.setItem('verdery.map.inspector-width.garden-b', 'oversized');
    expect(loadInspectorWidth(window.localStorage, 'garden-b')).toBe('standard');
  });
});
