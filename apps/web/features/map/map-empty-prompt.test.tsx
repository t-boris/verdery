import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { MapEmptyPrompt } from './map-empty-prompt';
import { useMapEditorStore } from './editor-store';

const setTool = vi.fn();

// Only the store is replaced; `createToolMode` and the rest of the module stay
// real, so the tool string this asserts on is the one the editor uses.
vi.mock('./editor-store', () => ({ useMapEditorStore: vi.fn() }));

vi.mocked(useMapEditorStore).mockReturnValue({ setTool } as unknown as ReturnType<
  typeof useMapEditorStore
>);

function renderPrompt(georeferenced: boolean) {
  render(
    <LocalizationProvider locale="en">
      <MapEmptyPrompt
        gardenId="019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b"
        georeferenced={georeferenced}
      />
    </LocalizationProvider>,
  );
}

describe('MapEmptyPrompt', () => {
  it('starts the lot tool on a garden that has a location', () => {
    setTool.mockReset();
    renderPrompt(true);

    fireEvent.click(screen.getByRole('button', { name: 'Trace the lot' }));

    expect(setTool).toHaveBeenCalledWith('create:lot');
  });

  it('names the lot as the first thing, because everything else sits inside it', () => {
    renderPrompt(true);

    expect(screen.getByText('Start with the lot')).toBeDefined();
  });

  // Offering "trace your lot" with nothing to trace it over would be advice
  // that cannot be followed.
  it('sends an unplaced garden to its location settings instead', () => {
    renderPrompt(false);

    const link = screen.getByRole('link', { name: 'Set the location' });

    expect(link.getAttribute('href')).toBe(
      '/application/gardens/019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
    );
    expect(screen.queryByRole('button', { name: 'Trace the lot' })).toBeNull();
  });
});
