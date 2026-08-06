import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { GardenLocationPanel } from './garden-location-panel';
import { useGardenMap, useSetGardenGeoreference } from './queries';

const mutate = vi.fn();

vi.mock('./queries', () => ({
  useGardenMap: vi.fn(),
  useSetGardenGeoreference: vi.fn(),
  // The address field this panel composes has its own tests; here it only
  // needs to render without reaching the network.
  useAddressCandidates: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));

const mockedUseGardenMap = vi.mocked(useGardenMap);
const mockedUseSetGeoreference = vi.mocked(useSetGardenGeoreference);

const GEOREFERENCE = {
  localAnchor: [0, 0] as [number, number],
  geographicAnchor: [-93.63, 41.59] as [number, number],
  rotationDegrees: 15,
  scaleCorrection: 1,
  accuracyMetres: 8.2,
  provenance: 'importedMapImagery' as const,
  method: 'mapPin',
  revision: 3,
};

function mockMap(fields: Record<string, unknown>): void {
  mockedUseGardenMap.mockReturnValue({
    isPending: false,
    isLoadingError: false,
    isError: false,
    error: null,
    data: undefined,
    ...fields,
  } as unknown as ReturnType<typeof useGardenMap>);
}

function renderPanel() {
  return render(
    <LocalizationProvider locale="en">
      <GardenLocationPanel gardenId="019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b" />
    </LocalizationProvider>,
  );
}

describe('GardenLocationPanel', () => {
  beforeEach(() => {
    mutate.mockReset();
    mockedUseSetGeoreference.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      isSuccess: false,
      error: null,
    } as unknown as ReturnType<typeof useSetGardenGeoreference>);
    mockMap({ data: { coordinateSpaceId: 'space', objects: [], validationSummary: [] } });
  });

  it('says a garden has no location rather than showing empty fields as if it did', () => {
    renderPanel();

    expect(screen.getByText('This garden has no location yet.')).toBeDefined();
  });

  /*
   * One place per value, and it is the field. The saved record used to be
   * printed above as read-only text while the inputs below started empty, so
   * adjusting a location meant copying three numbers across the panel
   * (reported 2026-08-06).
   */
  it('fills the fields with the saved record instead of printing it above them', () => {
    mockMap({
      data: {
        coordinateSpaceId: 'space',
        georeference: GEOREFERENCE,
        objects: [],
        validationSummary: [],
      },
    });

    renderPanel();

    expect(screen.getByLabelText<HTMLInputElement>('Latitude').value).toBe('41.590000');
    expect(screen.getByLabelText<HTMLInputElement>('Longitude').value).toBe('-93.630000');
    expect(screen.queryByText('41.59, -93.63')).toBeNull();
  });

  // Accuracy is the one thing no field can carry — it comes from whoever
  // reported the position, not from the person typing it.
  it('says nothing about accuracy when none was ever reported', () => {
    const { accuracyMetres: _dropped, ...withoutAccuracy } = GEOREFERENCE;
    mockMap({
      data: {
        coordinateSpaceId: 'space',
        georeference: withoutAccuracy,
        objects: [],
        validationSummary: [],
      },
    });

    renderPanel();

    expect(screen.queryByText(/Not stated/)).toBeNull();
  });

  it('sends what was typed, as manual coordinates', () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '41.59' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '-93.63' } });
    fireEvent.change(screen.getByLabelText('North, in degrees'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));

    expect(mutate).toHaveBeenCalledWith({
      localAnchor: [0, 0],
      geographicAnchor: [-93.63, 41.59],
      rotationDegrees: 15,
      method: 'manualCoordinates',
    });
  });

  // Longitude and latitude are easy to swap, and a swapped pair is a real
  // place — just the wrong one. The range check is the only thing that
  // catches the half of those mistakes that leaves the Earth.
  it('refuses a latitude outside the Earth without sending anything', () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '-93.63' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '41.59' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(
      screen.getByText('Latitude must be between -90 and 90, and longitude between -180 and 180.'),
    ).toBeDefined();
  });

  it('refuses a rotation of 360, which is the same as 0 said wrongly', () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '41.59' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '-93.63' } });
    fireEvent.change(screen.getByLabelText('North, in degrees'), { target: { value: '360' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText('North must be at least 0 and less than 360 degrees.')).toBeDefined();
  });

  it('treats an empty rotation as north-up rather than as a missing answer', () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '41.59' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '-93.63' } });
    fireEvent.change(screen.getByLabelText('North, in degrees'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ rotationDegrees: 0 }));
  });
});
