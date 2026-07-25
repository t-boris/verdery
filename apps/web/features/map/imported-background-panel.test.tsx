import type { Media } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { ImportedBackgroundPanel } from './imported-background-panel';
import { useGardenPlanMediaList } from './media-queries';
import type { MapObjectRecord } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

vi.mock('./media-queries', () => ({ useGardenPlanMediaList: vi.fn() }));

const mockedList = vi.mocked(useGardenPlanMediaList);

function planMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: 'plan-media-1',
    gardenId: 'garden-1',
    uploadedByProfileId: 'profile-1',
    mediaClass: 'imported_plan',
    displayFilename: 'plan.jpg',
    declaredContentType: 'image/jpeg',
    verifiedContentType: 'image/jpeg',
    declaredByteSize: 1000,
    verifiedByteSize: 1000,
    checksumSha256: null,
    uploadState: 'available',
    processingState: 'processed',
    sensitivityClassification: 'sensitive',
    derivatives: [],
    revision: 3,
    createdAt: '2026-07-21T09:00:00Z',
    updatedAt: '2026-07-21T09:00:00Z',
    ...overrides,
  };
}

const BACKGROUND: MapObjectRecord = {
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
      calibrationState: 'uncalibrated',
    },
  },
  lifecycleState: 'active',
  revision: 1,
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

function mockListResult(items: readonly Media[]): void {
  mockedList.mockReturnValue({
    data: { items: [...items] },
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useGardenPlanMediaList>);
}

function stubActions(
  records: readonly MapObjectRecord[],
): Pick<
  MapEditorActions,
  'records' | 'createImportedBackground' | 'setBackgroundVisibility' | 'deleteObject'
> {
  return {
    records,
    createImportedBackground: vi.fn().mockResolvedValue([]),
    setBackgroundVisibility: vi.fn().mockResolvedValue([]),
    deleteObject: vi.fn().mockResolvedValue([]),
  };
}

function renderPanel(actions: ReturnType<typeof stubActions>) {
  render(
    <LocalizationProvider locale="en">
      <ImportedBackgroundPanel
        gardenId="garden-1"
        actions={actions as unknown as MapEditorActions}
      />
    </LocalizationProvider>,
  );
}

describe('ImportedBackgroundPanel', () => {
  it('shows both empty states when nothing is uploaded and nothing is on the map', () => {
    mockListResult([]);
    renderPanel(stubActions([]));

    expect(screen.getByText('No plan backgrounds on the map yet.')).toBeDefined();
    expect(screen.getByText(/No plan documents are ready yet/)).toBeDefined();
  });

  it('lists only placeable plans (available + processed) and creates a background from one', () => {
    mockListResult([
      planMedia(),
      planMedia({ id: 'plan-media-2', displayFilename: 'unfinished.jpg', processingState: null }),
    ]);
    const actions = stubActions([]);
    renderPanel(actions);

    expect(screen.getByText('plan.jpg')).toBeDefined();
    expect(screen.queryByText('unfinished.jpg')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add to map' }));
    expect(actions.createImportedBackground).toHaveBeenCalledWith(
      'plan-media-1',
      'plan.jpg',
      undefined,
    );
  });

  it('offers a page selection for a PDF plan, with the honest no-preview note, and passes the page through', () => {
    mockListResult([
      planMedia({
        id: 'plan-media-3',
        displayFilename: 'plan.pdf',
        declaredContentType: 'application/pdf',
        verifiedContentType: 'application/pdf',
      }),
    ]);
    const actions = stubActions([]);
    renderPanel(actions);

    expect(screen.getByText(/PDF pages cannot be displayed yet/)).toBeDefined();
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to map' }));
    expect(actions.createImportedBackground).toHaveBeenCalledWith('plan-media-3', 'plan.pdf', 3);
  });

  it('shows each background with its not-calibrated badge and toggles its persisted visibility', () => {
    mockListResult([]);
    const actions = stubActions([BACKGROUND]);
    renderPanel(actions);

    expect(screen.getByText('Not calibrated')).toBeDefined();

    const toggle = screen.getByRole('button', { name: 'Hide background' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(actions.setBackgroundVisibility).toHaveBeenCalledWith('background-1', false);
  });

  it('offers Show for a hidden background', () => {
    mockListResult([]);
    const hidden: MapObjectRecord = {
      ...BACKGROUND,
      categoryDetails: {
        category: 'importedBackground',
        details: {
          planMediaId: 'plan-media-1',
          isBackgroundVisible: false,
          calibrationState: 'uncalibrated',
        },
      },
    };
    const actions = stubActions([hidden]);
    renderPanel(actions);

    fireEvent.click(screen.getByRole('button', { name: 'Show background' }));
    expect(actions.setBackgroundVisibility).toHaveBeenCalledWith('background-1', true);
  });

  it('removes a background only after confirmation', () => {
    mockListResult([]);
    const actions = stubActions([BACKGROUND]);
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    renderPanel(actions);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(actions.deleteObject).toHaveBeenCalledWith('background-1');
    confirmSpy.mockRestore();
  });
});
