import type { ObservationPhotoAttachmentRequest } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { ObservationPhotosPanel } from './observation-photos-panel';

const startUploadMock = vi.fn();
const cancelMock = vi.fn();

let uploadState: {
  phase: string;
  mediaId: string | null;
  displayFilename: string | null;
  totalBytes: number;
  uploadedBytes: number;
  retryable: boolean;
  apiFailure: unknown;
};

let duplicates: { displayFilename: string }[] = [];
let similar: { displayFilename: string }[] = [];

vi.mock('@/features/media/public', () => ({
  useExactDuplicateMedia: () => ({ duplicates, isPending: false }),
  useSimilarMedia: () => ({ similar, isPending: false }),
  useMediaUpload: () => ({
    ...uploadState,
    startUpload: startUploadMock,
    pause: vi.fn(),
    resumeRecovered: vi.fn(),
    discardRecovered: vi.fn(),
    retry: vi.fn(),
    cancel: cancelMock,
  }),
}));

vi.mock('@/core/connectivity/public', () => ({ useIsOnline: () => true }));

function renderPanel(
  value: readonly ObservationPhotoAttachmentRequest[] = [],
  onChange = vi.fn<(next: readonly ObservationPhotoAttachmentRequest[]) => void>(),
) {
  render(
    <LocalizationProvider locale="en">
      <ObservationPhotosPanel gardenId="garden-1" value={value} onChange={onChange} />
    </LocalizationProvider>,
  );
  return onChange;
}

beforeEach(() => {
  vi.clearAllMocks();
  duplicates = [];
  similar = [];
  uploadState = {
    phase: 'idle',
    mediaId: null,
    displayFilename: null,
    totalBytes: 0,
    uploadedBytes: 0,
    retryable: false,
    apiFailure: null,
  };
});

describe('ObservationPhotosPanel', () => {
  it('offers no way to attach a photograph that has not finished validating', () => {
    uploadState = { ...uploadState, phase: 'processing', mediaId: 'media-1' };

    renderPanel();

    // The server refuses media that is not yet `available`, so offering the
    // action here would only produce a failure the reader cannot act on.
    expect(screen.queryByRole('button', { name: 'Attach to this observation' })).toBeNull();
    expect(screen.getByText(/Checking the photograph/)).toBeTruthy();
  });

  it('attaches the validated photograph with the purpose the reader chose', () => {
    uploadState = { ...uploadState, phase: 'processed', mediaId: 'media-1' };
    const onChange = renderPanel();

    fireEvent.change(screen.getByLabelText('What this shot is'), {
      target: { value: 'symptom_close_up' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Attach to this observation' }));

    expect(onChange).toHaveBeenCalledWith([{ mediaId: 'media-1', purpose: 'symptom_close_up' }]);
    // Returns the widget to its picker state so the next photograph of this
    // same observation starts from a clean upload.
    expect(cancelMock).toHaveBeenCalled();
  });

  it('defaults to the whole plant rather than guessing a more specific shot', () => {
    uploadState = { ...uploadState, phase: 'processed', mediaId: 'media-1' };
    const onChange = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Attach to this observation' }));

    expect(onChange).toHaveBeenCalledWith([{ mediaId: 'media-1', purpose: 'whole_plant' }]);
  });

  it('removes an attachment without touching the others', () => {
    const onChange = renderPanel([
      { mediaId: 'media-1', purpose: 'whole_plant' },
      { mediaId: 'media-2', purpose: 'flower' },
    ]);

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this photograph' })[0]!);

    expect(onChange).toHaveBeenCalledWith([{ mediaId: 'media-2', purpose: 'flower' }]);
  });

  it('refuses a file over the declared ceiling before any upload starts', () => {
    renderPanel();

    const file = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 51 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Choose a photograph'), { target: { files: [file] } });

    expect(startUploadMock).not.toHaveBeenCalled();
    expect(screen.getByText('That file is larger than 50 MB.')).toBeTruthy();
  });
  it('warns that this exact photograph is already in the garden, without blocking it', () => {
    uploadState = { ...uploadState, phase: 'processed', mediaId: 'media-1' };
    duplicates = [{ displayFilename: 'bed.jpg' }];
    renderPanel();

    expect(screen.getByText(/already uploaded this exact photograph/)).toBeTruthy();
    // A warning, never a block: the same photograph can legitimately belong to
    // two observations, and only the photographer knows.
    expect(screen.getByRole('button', { name: 'Attach to this observation' })).toBeTruthy();
  });
  it('says a photo only LOOKS like one already here, and stays quiet when the bytes matched', () => {
    uploadState = { ...uploadState, phase: 'processed', mediaId: 'media-1' };
    similar = [{ displayFilename: 'tomato-july.jpg' }];

    const { unmount } = render(
      <ObservationPhotosPanel gardenId="garden-1" value={[]} onChange={vi.fn()} />,
    );

    expect(screen.getByText(/looks like a photograph already in this garden/)).toBeTruthy();
    unmount();

    // An exact match is reported with certainty above; hedging about the
    // very same file would understate what is known.
    duplicates = [{ displayFilename: 'tomato-july.jpg' }];
    render(<ObservationPhotosPanel gardenId="garden-1" value={[]} onChange={vi.fn()} />);

    expect(screen.queryByText(/looks like a photograph already in this garden/)).toBeNull();
    expect(screen.getByText(/already uploaded this exact photograph/)).toBeTruthy();
  });
});
