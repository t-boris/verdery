import type { Media } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { MapEditorStoreProvider } from './editor-store';
import { ImportedBackgroundPanel } from './imported-background-panel';
import { useDeleteGardenPlan, useGardenPlanMediaList } from './media-queries';
import { useReadPlat } from './plat-queries';
import type { MapObjectRecord } from './types';
import type { MapEditorActions } from './use-map-editor-actions';

vi.mock('./media-queries', () => ({
  useGardenPlanMediaList: vi.fn(),
  useDeleteGardenPlan: vi.fn(),
}));

vi.mock('./plat-queries', () => ({ useReadPlat: vi.fn() }));

const mockedList = vi.mocked(useGardenPlanMediaList);
const mockedDelete = vi.mocked(useDeleteGardenPlan);
const mockedReadPlat = vi.mocked(useReadPlat);

/** The plat reading, idle unless a test says otherwise. */
function stubReadPlat(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
    ...overrides,
  } as never;
}

/** The delete mutation, idle unless a test says otherwise. */
function stubDeleteMutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, isError: false, error: null, ...overrides } as never;
}

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
  isHidden: false,
  isLocked: false,
  revision: 1,
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

function mockListResult(items: readonly Media[]): void {
  mockedDelete.mockReturnValue(stubDeleteMutation());
  mockedReadPlat.mockReturnValue(stubReadPlat());
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
      {/* The panel reads the editor store for the tracing-opacity preference (P6-PLAN-02). */}
      <MapEditorStoreProvider>
        <ImportedBackgroundPanel
          gardenId="garden-1"
          actions={actions as unknown as MapEditorActions}
        />
      </MapEditorStoreProvider>
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

  /*
   * ADR-0017: the worker renders page ONE. Page one therefore needs no
   * warning, and any other page still has no image behind it — so the notice
   * appears exactly when it is true, rather than on every PDF.
   */
  it('warns only once a page other than the first is chosen, and passes the page through', () => {
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

    expect(screen.queryByText(/Only the first page/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Page'), { target: { value: '3' } });
    expect(screen.getByText(/Only the first page/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Add to map' }));
    expect(actions.createImportedBackground).toHaveBeenCalledWith('plan-media-3', 'plan.pdf', 3);
  });

  /*
   * The capability existed on the server from P6-RET-01 and had no way in
   * from the web at all: an owner who uploaded the same plat twice on
   * 2026-08-06 had no way to remove either copy.
   */
  it('deletes an uploaded plan after confirmation, and not before', () => {
    mockListResult([planMedia({ id: 'plan-media-9', revision: 4 })]);
    const mutation = stubDeleteMutation();
    mockedDelete.mockReturnValue(mutation);
    renderPanel(stubActions([]));

    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    expect(
      (mutation as unknown as { mutate: ReturnType<typeof vi.fn> }).mutate,
    ).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    expect(
      (mutation as unknown as { mutate: ReturnType<typeof vi.fn> }).mutate,
    ).toHaveBeenCalledWith({
      mediaId: 'plan-media-9',
      revision: 4,
    });
    confirm.mockRestore();
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
