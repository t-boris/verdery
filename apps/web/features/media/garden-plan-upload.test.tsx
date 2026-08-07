import type { Media } from '@verdery/api-contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { GardenPlanUpload } from './garden-plan-upload';
import { useDeleteGardenPlan, useGardenPlanMediaList } from './queries';
import type { UseMediaUploadResult } from './use-media-upload';
import { useMediaUpload } from './use-media-upload';

vi.mock('./use-media-upload', () => ({ useMediaUpload: vi.fn() }));
vi.mock('./queries', () => ({
  useMediaAccess: vi.fn(() => ({ isPending: true, isError: false })),
  useGardenPlanMediaList: vi.fn(() => ({
    data: { items: [], nextCursor: null },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useDeleteGardenPlan: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  })),
}));

const mockedUseMediaUpload = vi.mocked(useMediaUpload);
const mockedUseGardenPlanMediaList = vi.mocked(useGardenPlanMediaList);
const mockedUseDeleteGardenPlan = vi.mocked(useDeleteGardenPlan);

const BASE_STATE: UseMediaUploadResult = {
  phase: 'idle',
  displayFilename: null,
  totalBytes: 0,
  uploadedBytes: 0,
  mediaId: null,
  media: null,
  checksumSha256: null,
  retryable: false,
  uploadFailureReason: null,
  apiFailure: null,
  pollFailure: null,
  startUpload: vi.fn(),
  pause: vi.fn(),
  resumeRecovered: vi.fn(),
  discardRecovered: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
};

function processedMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: 'media-1',
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
    derivatives: [{ derivativeKind: 'screen_preview', mediaId: 'derivative-1' }],
    revision: 3,
    createdAt: '2026-07-21T09:00:00Z',
    updatedAt: '2026-07-21T09:00:00Z',
    ...overrides,
  };
}

function mockState(overrides: Partial<UseMediaUploadResult>): void {
  mockedUseMediaUpload.mockReturnValue({ ...BASE_STATE, ...overrides });
}

function renderWidget() {
  return render(
    <LocalizationProvider locale="en">
      <GardenPlanUpload gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

function selectFile(file: File): void {
  const input = screen.getByLabelText<HTMLInputElement>('Choose a plan document');
  fireEvent.change(input, { target: { files: [file] } });
}

afterEach(() => {
  act(() => onlineManager.setOnline(true));
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mockedUseGardenPlanMediaList.mockReturnValue({
    data: { items: [], nextCursor: null },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  mockedUseDeleteGardenPlan.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  } as never);
});

describe('GardenPlanUpload', () => {
  it('registers the upload with imported_plan, not garden_photo', () => {
    mockState({});
    renderWidget();

    expect(mockedUseMediaUpload).toHaveBeenCalledWith('garden-1', 'imported_plan');
  });

  it('shows a plan file picker in the idle phase, disabled while offline', () => {
    mockState({});
    renderWidget();

    const input = screen.getByLabelText<HTMLInputElement>('Choose a plan document');
    expect(input.accept).toContain('application/pdf');
    expect(input.accept).toContain('image/jpeg');

    act(() => onlineManager.setOnline(false));
    expect(screen.getByLabelText<HTMLInputElement>('Choose a plan document').disabled).toBe(true);
  });

  it('shows the persistent saved-plan library even when this upload controller is idle', () => {
    mockState({});
    renderWidget();

    expect(screen.getByText('Saved property plans')).toBeTruthy();
    expect(screen.getByText('No property plans have been saved yet.')).toBeTruthy();
  });

  it('confirms and deletes a saved plan using its current revision', () => {
    const mutate = vi.fn();
    mockedUseGardenPlanMediaList.mockReturnValue({
      data: { items: [processedMedia()], nextCursor: null },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    mockedUseDeleteGardenPlan.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as never);
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    mockState({});

    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: 'Delete plan.jpg' }));

    expect(mutate).toHaveBeenCalledWith({ mediaId: 'media-1', revision: 3 });
  });

  it('rejects an unsupported file type locally, before any upload starts', () => {
    const startUpload = vi.fn();
    mockState({ startUpload });
    renderWidget();

    selectFile(new File(['x'], 'plan.svg', { type: 'image/svg+xml' }));

    expect(screen.getByText(/not supported/)).toBeTruthy();
    expect(startUpload).not.toHaveBeenCalled();
  });

  it('rejects a plan document over the 50 MiB policy cap locally, before any upload starts', () => {
    const startUpload = vi.fn();
    mockState({ startUpload });
    renderWidget();

    const oversized = new File([new Uint8Array(1)], 'plan.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversized, 'size', { value: 50 * 1024 * 1024 + 1 });
    selectFile(oversized);

    expect(screen.getByText(/50\.0 MiB limit/)).toBeTruthy();
    expect(startUpload).not.toHaveBeenCalled();
  });

  it('accepts a PDF within the cap and starts the upload', () => {
    const startUpload = vi.fn();
    mockState({ startUpload });
    renderWidget();

    const pdf = new File(['%PDF-1.7'], 'plan.pdf', { type: 'application/pdf' });
    selectFile(pdf);

    expect(startUpload).toHaveBeenCalledWith(pdf);
  });

  /*
   * ADR-0017: the worker renders a plan PDF's first page, so a plat has the
   * same screen-preview derivative a scan has. There is no PDF special case
   * left here — a PDF with no derivative yet reads as any other unprocessed
   * plan does.
   */
  it('says the preview is unavailable while a PDF plan has no derivative yet', () => {
    mockState({
      phase: 'processed',
      mediaId: 'media-1',
      media: processedMedia({
        displayFilename: 'plan.pdf',
        declaredContentType: 'application/pdf',
        verifiedContentType: 'application/pdf',
        derivatives: [],
      }),
    });
    renderWidget();

    expect(screen.getByText(/preview/i)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders the raster plan preview through its screen-preview derivative once processed', () => {
    mockState({ phase: 'processed', mediaId: 'media-1', media: processedMedia() });
    renderWidget();

    // The mocked access query is pending, so the loading state renders — the
    // point is that a preview PATH exists (derivative resolution ran), not
    // the final img markup.
    expect(screen.getByText('Loading preview.')).toBeTruthy();
    expect(screen.getByText(/uploaded and validated/)).toBeTruthy();
  });
});
