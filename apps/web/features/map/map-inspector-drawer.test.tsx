import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { MapInspectorDrawer, type InspectorTabId } from './map-inspector-drawer';
import type { MapInspectorWidth } from './map-inspector-layout';

const TABS = [
  { id: 'properties', labelKey: 'map.inspector.tabProperties', content: <p>Property content</p> },
  { id: 'objects', labelKey: 'map.inspector.tabObjects', content: <p>Object content</p> },
  { id: 'backdrop', labelKey: 'map.inspector.tabBackdrop', content: <p>Backdrop content</p> },
  { id: 'warnings', labelKey: 'map.inspector.tabWarnings', content: <p>Warning content</p> },
] as const;

function DrawerHarness() {
  const [active, setActive] = useState<InspectorTabId>('properties');
  const [width, setWidth] = useState<MapInspectorWidth>('standard');
  return (
    <MapInspectorDrawer
      tabs={TABS}
      activeTab={active}
      onSelectTab={setActive}
      width={width}
      onWidthChange={setWidth}
    />
  );
}

describe('MapInspectorDrawer', () => {
  it('presents four explicit tabs without a collapse affordance', () => {
    render(
      <LocalizationProvider locale="en">
        <DrawerHarness />
      </LocalizationProvider>,
    );

    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Properties' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByRole('button', { name: /collapse|expand/i })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Backdrop & layers' }));
    expect(
      screen.getByRole('tab', { name: 'Backdrop & layers' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.getByText('Backdrop content')).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Backdrop & layers' }), {
      key: 'ArrowRight',
    });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Warnings' }));
    expect(screen.getByText('Warning content')).toBeTruthy();
  });

  it('offers keyboard-native narrow, reset, and widen controls', () => {
    render(
      <LocalizationProvider locale="en">
        <DrawerHarness />
      </LocalizationProvider>,
    );

    const widen = screen.getByRole('button', { name: 'Widen the panel' });
    widen.focus();
    fireEvent.keyDown(widen, { key: 'Enter' });
    fireEvent.click(widen);

    expect(document.activeElement).toBe(widen);
    expect(widen.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Reset panel width' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
});
