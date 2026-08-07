import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider, createTranslator } from '@/shared/localization/public';

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
    isHidden: false,
    isLocked: false,
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
  const english = createTranslator('en');
  const russian = createTranslator('ru');

  it('shows centimetres below a metre and metres above — never fake extra digits', () => {
    expect(formatErrorMetres(0.12, english, 'en')).toBe('12.0 cm');
    expect(formatErrorMetres(1.246, english, 'en')).toBe('1.25 m');
    // The unit boundary itself (P6-QA-01): exactly one metre is metres, a
    // hair under stays centimetres.
    expect(formatErrorMetres(1, english, 'en')).toBe('1.00 m');
    expect(formatErrorMetres(0.999, english, 'en')).toBe('99.9 cm');
  });

  it('localizes the decimal separator and the unit, keeping the same digits', () => {
    // The figure a Russian reader sees used to be "1.5 cm" — a POSIX point
    // and an English abbreviation inside Russian prose (P8-UX-01).
    expect(formatErrorMetres(0.015, russian, 'ru')).toBe('1,5 см');
    expect(formatErrorMetres(1.246, russian, 'ru')).toBe('1,25 м');
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

  /**
   * The E2E harness cannot reach this panel — it mounts only when an
   * imported plan background is the selected object, and putting one there
   * needs a real Cloud Storage upload the harness has no bucket for. Its
   * keyboard contract is therefore asserted here, against the mounted
   * component: every control is a real `<button>` or a labelled field, so
   * everything in the calibration flow is reachable by Tab and operable by
   * Enter or Space. Nothing in it is a click-only `<div>`.
   *
   * Source: work package P8-UX-01.
   */
  it('exposes every control as a focusable button or a labelled field', () => {
    imageReady();
    renderPanel(backgroundRecord());

    fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }));

    const panel = screen.getByRole('heading', { name: 'Calibration' }).closest('div');
    expect(panel).not.toBeNull();

    // No click handler sits on a non-interactive element.
    const clickable = (panel as HTMLElement).querySelectorAll('[onclick]');
    expect(clickable.length).toBe(0);

    // Every button is a real button, so Tab reaches it and Enter/Space fire it.
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect((button.textContent ?? '').trim()).not.toBe('');
    }

    // Every field is named — an unlabelled number input in a measurement
    // flow is a value a screen-reader user cannot identify.
    for (const field of (panel as HTMLElement).querySelectorAll('input, select')) {
      const id = field.getAttribute('id') ?? '';
      const named =
        (id !== '' && (panel as HTMLElement).querySelector(`label[for="${id}"]`) !== null) ||
        field.getAttribute('aria-label') !== null ||
        field.getAttribute('aria-labelledby') !== null ||
        field.closest('label') !== null;
      expect(named, field.outerHTML.slice(0, 120)).toBe(true);
    }
  });

  it('cannot start calibrating a plan with no displayable image (every PDF today)', () => {
    mockedImage.mockReturnValue({ kind: 'unavailable' });
    renderPanel(backgroundRecord());

    expect(screen.getByText(/This plan has no displayable image yet/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Calibrate' })).toHaveProperty('disabled', true);
  });
});
