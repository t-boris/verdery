import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { formatErrorMetres } from './calibration-labels';
import { CalibrationPanel } from './calibration-panel';
import { MapEditorStoreProvider } from './editor-store';
import type { MapObjectRecord } from './types';
import type { MapEditorActions } from './use-map-editor-actions';
import { useBackgroundImage } from './use-background-image';

vi.mock('./use-background-image', () => ({ useBackgroundImage: vi.fn() }));

const mockedImage = vi.mocked(useBackgroundImage);

function imageReady(): void {
  mockedImage.mockReturnValue({
    kind: 'ready',
    image: { naturalWidth: 1600, naturalHeight: 1200 } as HTMLImageElement,
  });
}

function backgroundRecord(
  calibration?: NonNullable<
    Extract<
      NonNullable<MapObjectRecord['categoryDetails']>,
      { category: 'importedBackground' }
    >['details']['calibration']
  >,
): MapObjectRecord {
  return {
    id: 'background-1',
    gardenId: 'garden-1',
    category: 'importedBackground',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-10, -10],
          [10, -10],
          [10, 10],
          [-10, 10],
          [-10, -10],
        ],
      ],
    },
    label: 'plan.jpg',
    categoryDetails: {
      category: 'importedBackground',
      details: {
        planMediaId: 'plan-media-1',
        isBackgroundVisible: true,
        calibrationState: calibration === undefined ? 'uncalibrated' : 'calibrated',
        ...(calibration === undefined ? {} : { calibration }),
      },
    },
    lifecycleState: 'active',
    revision: 1,
    createdAt: '2026-07-24T09:00:00Z',
    updatedAt: '2026-07-24T09:00:00Z',
  };
}

const CALIBRATION = {
  transformRevision: 2,
  pageAspectRatio: 0.75,
  knownDistance: { pointA: [0.1, 0.1] as const, pointB: [0.6, 0.1] as const, distanceMetres: 10 },
  referencePoints: [],
  transform: { metresPerPlanUnit: 20, rotationRadians: 0, translationMetres: { x: 0, y: 0 } },
  rmsErrorMetres: 0.12,
};

function renderPanel(selectedRecord: MapObjectRecord | null) {
  const actions = {
    selectedRecord,
    isSubmitting: false,
    applyCalibration: vi.fn().mockResolvedValue([]),
  };
  render(
    <LocalizationProvider locale="en">
      <MapEditorStoreProvider>
        <CalibrationPanel gardenId="garden-1" actions={actions as unknown as MapEditorActions} />
      </MapEditorStoreProvider>
    </LocalizationProvider>,
  );
  return actions;
}

describe('formatErrorMetres', () => {
  it('shows centimetres below a metre and metres above — never fake extra digits', () => {
    expect(formatErrorMetres(0.12)).toBe('12.0 cm');
    expect(formatErrorMetres(1.246)).toBe('1.25 m');
    // The unit boundary itself (P6-QA-01): exactly one metre is metres, a
    // hair under stays centimetres.
    expect(formatErrorMetres(1)).toBe('1.00 m');
    expect(formatErrorMetres(0.999)).toBe('99.9 cm');
  });
});

describe('CalibrationPanel', () => {
  it('renders nothing when the selection is not an imported background', () => {
    imageReady();
    renderPanel(null);
    expect(screen.queryByText('Calibration')).toBeNull();
  });

  it('shows the honest uncalibrated state and starts a session', () => {
    imageReady();
    renderPanel(backgroundRecord());

    expect(screen.getByText('Not calibrated')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }));

    // The session's first step: pick the known-distance segment.
    expect(screen.getByText('Click the two ends of a known distance on the plan.')).toBeDefined();
    // Nothing derivable yet, so apply must be disabled — no false precision.
    expect(screen.getByRole('button', { name: 'Apply calibration' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('displays calibration quality with an honest ± estimate, and offers recalibration', () => {
    imageReady();
    renderPanel(backgroundRecord(CALIBRATION));

    expect(screen.getByText('Calibrated · ±12.0 cm estimated error')).toBeDefined();
    expect(screen.getByText(/Plan width ≈ 20.0 m/)).toBeDefined();
    expect(screen.getByText(/Transform revision 2/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Recalibrate' })).toBeDefined();
  });

  it('states the absence of an error estimate instead of implying zero', () => {
    imageReady();
    renderPanel(backgroundRecord({ ...CALIBRATION, rmsErrorMetres: null }));

    expect(screen.getByText('Calibrated · accuracy not estimated')).toBeDefined();
  });

  it('cannot start calibrating a plan with no displayable image (every PDF today)', () => {
    mockedImage.mockReturnValue({ kind: 'unavailable' });
    renderPanel(backgroundRecord());

    expect(screen.getByText(/This plan has no displayable image yet/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Calibrate' })).toHaveProperty('disabled', true);
  });
});
