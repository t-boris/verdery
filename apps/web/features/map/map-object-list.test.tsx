import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { MapEditorStoreProvider } from './editor-store';
import { MapObjectList } from './map-object-list';
import type { MapObjectRecord } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

const RECORD: MapObjectRecord = {
  id: 'object-1',
  gardenId: 'garden-1',
  category: 'tree',
  geometry: { type: 'Point', coordinates: [0, 0] },
  label: 'Oak',
  isHidden: true,
  isLocked: false,
  lifecycleState: 'active',
  revision: 3,
  createdAt: '2026-08-07T12:00:00.000Z',
  updatedAt: '2026-08-07T12:00:00.000Z',
};

function renderList(record: MapObjectRecord = RECORD) {
  const setObjectHidden = vi.fn();
  const setObjectLocked = vi.fn();
  const actions = {
    records: [record],
    findRecord: (objectId: string) => (objectId === record.id ? record : null),
    setObjectHidden,
    setObjectLocked,
    deleteObject: vi.fn(),
    joinLinework: vi.fn(),
    isSubmitting: false,
  } as unknown as MapEditorActions;

  render(
    <LocalizationProvider locale="en">
      <MapEditorStoreProvider>
        <MapObjectList actions={actions} selectedObjectId={null} onSelect={vi.fn()} />
      </MapEditorStoreProvider>
    </LocalizationProvider>,
  );

  return { setObjectHidden, setObjectLocked };
}

describe('MapObjectList object display controls', () => {
  it('keeps a hidden object in the index so it can be shown again', () => {
    const { setObjectHidden } = renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Show Oak on the map' }));

    expect(screen.getByText('Oak')).toBeTruthy();
    expect(setObjectHidden).toHaveBeenCalledWith(RECORD.id, false);
  });

  it('locks an individual object without locking its whole layer', () => {
    const visible = { ...RECORD, isHidden: false };
    const { setObjectLocked } = renderList(visible);

    fireEvent.click(screen.getByRole('button', { name: 'Lock Oak' }));

    expect(setObjectLocked).toHaveBeenCalledWith(RECORD.id, true);
  });
});
