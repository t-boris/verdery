import { onlineManager } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { GardenPhotoUpload } from './garden-photo-upload';
import type { UseMediaUploadResult } from './use-media-upload';
import { useMediaUpload } from './use-media-upload';

vi.mock('./use-media-upload', () => ({ useMediaUpload: vi.fn() }));
vi.mock('./queries', () => ({
  useMediaAccess: vi.fn(() => ({ isPending: true, isError: false })),
}));

const mockedUseMediaUpload = vi.mocked(useMediaUpload);

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

const TRANSPORT_FAILURE = {
  ok: false as const,
  kind: 'transport' as const,
  code: 'client.transport_failure',
  fallbackMessage: 'The API could not be reached.',
  correlationId: 'corr-1',
  retryable: true,
  details: [],
  status: null,
};

function mockState(overrides: Partial<UseMediaUploadResult>): void {
  mockedUseMediaUpload.mockReturnValue({ ...BASE_STATE, ...overrides });
}

function renderWidget() {
  return render(
    <LocalizationProvider locale="en">
      <GardenPhotoUpload gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  act(() => onlineManager.setOnline(true));
  vi.clearAllMocks();
});

describe('GardenPhotoUpload', () => {
  it('shows a file picker in the idle phase, disabled while offline', () => {
    mockState({});
    renderWidget();

    const input = screen.getByLabelText('Choose a photo');
    expect(input).toBeTruthy();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByLabelText<HTMLInputElement>('Choose a photo').disabled).toBe(true);
  });

  it('offers to resume or discard a recovered upload, gating Resume on connectivity', () => {
    mockState({
      phase: 'recoverable',
      displayFilename: 'backyard.jpg',
      totalBytes: 1000,
      uploadedBytes: 250,
    });
    renderWidget();

    expect(screen.getByText(/backyard\.jpg/)).toBeTruthy();
    expect(screen.getByText(/25%/)).toBeTruthy();
    const resumeButton = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Resume interrupted upload',
    });
    expect(resumeButton.disabled).toBe(false);

    act(() => onlineManager.setOnline(false));
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Resume interrupted upload' }).disabled,
    ).toBe(true);
    // Discard is a purely local action — never gated on connectivity.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Discard' }).disabled).toBe(false);
  });

  it('shows real byte progress and a Pause action while uploading', () => {
    mockState({
      phase: 'uploading',
      displayFilename: 'backyard.jpg',
      totalBytes: 2 * 1024 * 1024,
      uploadedBytes: 1024 * 1024,
    });
    renderWidget();

    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('offers Resume when paused, gated on connectivity', () => {
    mockState({
      phase: 'paused',
      displayFilename: 'backyard.jpg',
      totalBytes: 1000,
      uploadedBytes: 400,
    });
    renderWidget();

    const resumeButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Resume upload' });
    expect(resumeButton.disabled).toBe(false);

    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Resume upload' }).disabled).toBe(
      true,
    );
  });

  it('surfaces a retryable upload failure with a connectivity-gated Retry action', () => {
    mockState({
      phase: 'uploadFailed',
      retryable: true,
      uploadFailureReason: 'networkError',
      totalBytes: 1000,
      uploadedBytes: 300,
    });
    renderWidget();

    expect(screen.getByText(/interrupted by a network problem/)).toBeTruthy();
    const retryButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Retry' });
    expect(retryButton.disabled).toBe(false);

    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Retry' }).disabled).toBe(true);
  });

  it('does not offer Retry for a non-retryable upload failure', () => {
    mockState({
      phase: 'uploadFailed',
      retryable: false,
      uploadFailureReason: 'unexpectedStatus',
    });
    renderWidget();

    expect(screen.getByText(/rejected the upload with an unexpected response/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('renders the API failure and a Retry action when registration fails', () => {
    mockState({ phase: 'apiFailed', apiFailure: TRANSPORT_FAILURE });
    renderWidget();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows the rejected outcome with no retry action (a fresh upload is required instead)', () => {
    mockState({ phase: 'rejected', mediaId: 'media-1' });
    renderWidget();

    expect(screen.getByText(/could not be verified/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    // The picker for a fresh upload is offered again.
    expect(screen.getByLabelText('Choose a photo')).toBeTruthy();
  });

  it('shows the still-processing state with a stale hint on a background poll failure', () => {
    mockState({
      phase: 'processing',
      mediaId: 'media-1',
      media: {
        id: 'media-1',
        gardenId: 'garden-1',
        uploadedByProfileId: 'profile-1',
        mediaClass: 'garden_photo',
        displayFilename: 'backyard.jpg',
        declaredContentType: 'image/jpeg',
        verifiedContentType: 'image/jpeg',
        declaredByteSize: 1000,
        verifiedByteSize: 1000,
        checksumSha256: null,
        uploadState: 'available',
        processingState: 'processing',
        sensitivityClassification: 'standard',
        revision: 2,
        createdAt: '2026-07-21T09:00:00Z',
        updatedAt: '2026-07-21T09:00:00Z',
      },
      pollFailure: TRANSPORT_FAILURE,
    });
    renderWidget();

    expect(screen.getByText(/Verifying and processing/)).toBeTruthy();
    expect(screen.getByText('You are offline')).toBeTruthy();
  });

  it('offers a Cancel action while an upload is in flight', () => {
    mockState({ phase: 'uploading', totalBytes: 1000, uploadedBytes: 100 });
    renderWidget();

    expect(screen.getByRole('button', { name: 'Cancel upload' })).toBeTruthy();
  });
});
