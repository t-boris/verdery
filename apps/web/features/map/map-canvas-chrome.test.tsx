import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { MapCanvasChrome } from './map-canvas-chrome';

describe('MapCanvasChrome', () => {
  it('offers a distinct reset to the saved address', () => {
    const onResetToAddress = vi.fn();
    render(
      <LocalizationProvider locale="en">
        <MapCanvasChrome
          hint={null}
          camera={{ centerX: 0, centerY: 0, scale: 24 }}
          size={{ width: 800, height: 600 }}
          selectedRecord={null}
          interactionMode="idle"
          onSetInteractionMode={vi.fn()}
          onDeleteSelected={vi.fn()}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onZoomFit={vi.fn()}
          onResetToAddress={onResetToAddress}
        />
      </LocalizationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Center on the saved address' }));
    expect(onResetToAddress).toHaveBeenCalledOnce();
  });
});
