import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { GeometryDimensionEditor } from './geometry-dimension-editor';
import { dimensionsOfGeometry } from './geometry-dimensions';
import type { MapObjectRecord } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

const STRUCTURE: MapObjectRecord = {
  id: 'structure-1',
  gardenId: 'garden-1',
  category: 'structure',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
        [0, 0],
      ],
    ],
  },
  lifecycleState: 'active',
  isHidden: false,
  isLocked: false,
  revision: 1,
  createdAt: '2026-07-27T00:00:00Z',
  updatedAt: '2026-07-27T00:00:00Z',
};

function actionsWith(replaceGeometry: ReturnType<typeof vi.fn>): MapEditorActions {
  return {
    isSubmitting: false,
    replaceGeometry,
  } as unknown as MapEditorActions;
}

describe('GeometryDimensionEditor', () => {
  it('shows editable dimensions and derived measurements for a polygon', () => {
    render(
      <LocalizationProvider locale="en">
        <GeometryDimensionEditor actions={actionsWith(vi.fn())} record={STRUCTURE} />
      </LocalizationProvider>,
    );

    expect(screen.getByLabelText<HTMLInputElement>('Overall width (m)').value).toBe('4');
    expect(screen.getByLabelText<HTMLInputElement>('Overall depth (m)').value).toBe('3');
    expect(screen.getByText('12.00 m²')).toBeDefined();
    expect(screen.getByText('14.00 m')).toBeDefined();
  });

  it('applies the entered size through the canonical replace-geometry action', async () => {
    const replaceGeometry = vi.fn().mockResolvedValue([]);
    render(
      <LocalizationProvider locale="en">
        <GeometryDimensionEditor actions={actionsWith(replaceGeometry)} record={STRUCTURE} />
      </LocalizationProvider>,
    );

    fireEvent.change(screen.getByLabelText('Overall width (m)'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Overall depth (m)'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply size' }));

    await waitFor(() => expect(replaceGeometry).toHaveBeenCalledOnce());
    const geometry = replaceGeometry.mock.calls[0]?.[1] as MapObjectRecord['geometry'];
    expect(dimensionsOfGeometry(geometry)).toMatchObject({
      widthMetres: 8,
      depthMetres: 6,
      areaSquareMetres: 48,
    });
  });

  it('rejects empty or zero dimensions before sending a command', () => {
    const replaceGeometry = vi.fn();
    render(
      <LocalizationProvider locale="en">
        <GeometryDimensionEditor actions={actionsWith(replaceGeometry)} record={STRUCTURE} />
      </LocalizationProvider>,
    );

    fireEvent.change(screen.getByLabelText('Overall width (m)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply size' }));

    expect(screen.getByRole('alert').textContent).toBe('Enter dimensions greater than zero.');
    expect(replaceGeometry).not.toHaveBeenCalled();
  });
});
