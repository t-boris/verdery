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

function renderList(
  record: MapObjectRecord = RECORD,
  options: { readonly locale?: 'en' | 'ru'; readonly additionalRecords?: MapObjectRecord[] } = {},
) {
  const setObjectHidden = vi.fn();
  const setObjectLocked = vi.fn();
  const deleteObject = vi.fn();
  const onSelect = vi.fn();
  const records = [record, ...(options.additionalRecords ?? [])];
  const actions = {
    records,
    findRecord: (objectId: string) => records.find((item) => item.id === objectId) ?? null,
    setObjectHidden,
    setObjectLocked,
    deleteObject,
    joinLinework: vi.fn(),
    isSubmitting: false,
  } as unknown as MapEditorActions;

  render(
    <LocalizationProvider locale={options.locale ?? 'en'}>
      <MapEditorStoreProvider>
        <MapObjectList actions={actions} selectedObjectId={null} onSelect={onSelect} />
      </MapEditorStoreProvider>
    </LocalizationProvider>,
  );

  return { setObjectHidden, setObjectLocked, deleteObject, onSelect };
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

  it('shows a long Russian name in full with a readable localized type and text actions', () => {
    const longName = 'Старая яблоня у северной границы рядом с высокой живой изгородью';
    renderList({ ...RECORD, label: longName, isHidden: false }, { locale: 'ru' });

    expect(screen.getByText(longName).textContent).toBe(longName);
    expect(screen.getByText('Дерево')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: `Скрыть ${longName} на карте` }).textContent,
    ).toContain('Скрыть');
    expect(screen.getByRole('button', { name: `Заблокировать ${longName}` }).textContent).toContain(
      'Заблокировать',
    );
  });

  it('moves keyboard focus and selection between full identity buttons', () => {
    const second = { ...RECORD, id: 'object-2', label: 'Maple', isHidden: false };
    const { onSelect } = renderList(
      { ...RECORD, isHidden: false },
      { additionalRecords: [second] },
    );
    const oak = screen.getByRole('button', { name: 'Select Oak, Tree' });
    const maple = screen.getByRole('button', { name: 'Select Maple, Tree' });

    oak.focus();
    fireEvent.keyDown(oak, { key: 'ArrowDown' });

    expect(document.activeElement).toBe(maple);
    expect(onSelect).toHaveBeenCalledWith(second.id);
  });

  it('keeps deletion available as a named row action', () => {
    const { deleteObject } = renderList({ ...RECORD, isHidden: false });

    fireEvent.click(screen.getByRole('button', { name: 'Delete Oak' }));

    expect(deleteObject).toHaveBeenCalledWith(RECORD.id);
  });
});
