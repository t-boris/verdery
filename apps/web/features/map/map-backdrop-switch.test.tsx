import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { MapBackdropSwitch } from './map-backdrop-switch';
import { useMapEditorStore, type BackdropKind, type MapEditorStore } from './editor-store';
import type { MapCamera } from './types';

const setBackdrop = vi.fn<(backdrop: BackdropKind) => void>();
const setCamera = vi.fn<(camera: MapCamera) => void>();

vi.mock('./editor-store', () => ({ useMapEditorStore: vi.fn() }));

describe('MapBackdropSwitch', () => {
  it('zooms out to a renderable scale when the street map is selected', () => {
    setBackdrop.mockReset();
    setCamera.mockReset();
    vi.mocked(useMapEditorStore).mockReturnValue({
      state: { backdrop: 'imagery', camera: { centerX: 7, centerY: 8, scale: 24 } },
      setBackdrop,
      setCamera,
    } as unknown as MapEditorStore);

    render(
      <LocalizationProvider locale="en">
        <MapBackdropSwitch
          georeference={{
            localAnchor: [0, 0],
            geographicAnchor: [-93.6, 41.59],
            rotationDegrees: 0,
            scaleCorrection: 1,
            provenance: 'manualDrawing',
            method: 'addressSearch',
            revision: 1,
          }}
          backdrop={{
            kind: 'imagery',
            provider: null,
            visible: true,
            showsPhotograph: true,
            maxCameraScale: 30,
            magnification: 1,
            beyondProviderDetail: false,
          }}
        />
      </LocalizationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Street map' }));

    expect(setBackdrop).toHaveBeenCalledWith('streets');
    expect(setCamera).toHaveBeenCalledTimes(1);
    const nextCamera = setCamera.mock.calls[0]?.[0];
    expect(nextCamera).toMatchObject({ centerX: 7, centerY: 8 });
    expect(nextCamera?.scale).toBeLessThan(24);
  });
});
