import type { MediaListResult } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { stageableMediaOptions } from './staging-queries';

function media(
  id: string,
  displayFilename: string,
  derivatives: { derivativeKind: 'preview' | 'thumbnail'; mediaId: string }[],
): MediaListResult['items'][number] {
  return {
    id,
    gardenId: 'garden-1',
    uploadedByProfileId: 'profile-1',
    mediaClass: 'garden_photo',
    displayFilename,
    declaredContentType: 'image/jpeg',
    verifiedContentType: 'image/jpeg',
    declaredByteSize: 1024,
    verifiedByteSize: 1024,
    checksumSha256: null,
    uploadState: 'available',
    processingState: 'processed',
    sensitivityClassification: 'ordinary',
    derivatives,
    revision: 1,
    createdAt: '2026-05-02T08:00:00Z',
    updatedAt: '2026-05-02T08:00:00Z',
    // Only the fields `stageableMediaOptions` reads are real here; the cast
    // goes through `unknown` once, in this helper, rather than spelling out a
    // full `Media` in every case.
  } as unknown as MediaListResult['items'][number];
}

describe('stageableMediaOptions', () => {
  it('offers a derivative, never the original it came from', () => {
    const options = stageableMediaOptions({
      items: [
        media('original-1', 'bed.jpg', [{ derivativeKind: 'preview', mediaId: 'derived-1' }]),
      ],
    });

    // `isMediaClientSafe` refuses an original: its file can carry embedded
    // EXIF and GPS, and a client is never entitled to those. Offering the
    // original's id would produce a refusal for a rule the publisher cannot
    // see.
    expect(options).toEqual([{ mediaId: 'derived-1', label: 'bed.jpg — preview' }]);
  });

  it('offers every derivative a photograph has', () => {
    const options = stageableMediaOptions({
      items: [
        media('original-1', 'bed.jpg', [
          { derivativeKind: 'preview', mediaId: 'derived-1' },
          { derivativeKind: 'thumbnail', mediaId: 'derived-2' },
        ]),
      ],
    });

    expect(options.map((option) => option.mediaId)).toEqual(['derived-1', 'derived-2']);
  });

  it('contributes nothing for a photograph still being processed', () => {
    // Not an error and not hidden knowledge — the caller's empty state says a
    // photograph becomes available once its processed copy exists.
    expect(stageableMediaOptions({ items: [media('original-1', 'bed.jpg', [])] })).toEqual([]);
  });

  it('has no options before the list has loaded', () => {
    expect(stageableMediaOptions(undefined)).toEqual([]);
  });
});
