'use client';

import { useEffect, useState } from 'react';

import { useMediaAccess, useMediaStatus } from './media-queries';

export type BackgroundImageState =
  | { readonly kind: 'loading' }
  /** The plan has no display derivative — every PDF plan today (P6-WORKER-02's documented deferral), or a plan whose processing has not produced one. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly image: HTMLImageElement };

/**
 * Resolves an imported background's display image (P6-PLAN-01):
 * `GetMediaStatus` on the plan media id -> its `derivatives` array ->
 * the screen-preview derivative's own id -> `GetMediaAccess` signed URL ->
 * a decoded `HTMLImageElement` Konva can draw.
 *
 * The screen preview (1,600 px) is the display derivative, not the 4,096 px
 * high-resolution review image: at the map editor's zoom range a background
 * underlay never needs more, and the high-resolution image exists for
 * close-inspection tracing (P6-PLAN-02's calibration flow). The tile
 * pyramid also already exists server-side but is NOT consumed here — see
 * docs/development/deferred-capabilities.md ("Plan tile consumption").
 */
export function useBackgroundImage(gardenId: string, planMediaId: string): BackgroundImageState {
  const statusQuery = useMediaStatus(gardenId, planMediaId);
  const media = statusQuery.data;
  const derivatives = media?.derivatives ?? [];
  const displayDerivative =
    derivatives.find((entry) => entry.derivativeKind === 'screen_preview') ??
    derivatives.find((entry) => entry.derivativeKind === 'thumbnail');
  const accessQuery = useMediaAccess(
    gardenId,
    displayDerivative?.mediaId ?? '',
    displayDerivative !== undefined,
  );

  const url = accessQuery.data?.url;
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (url === undefined) {
      setImage(null);
      return;
    }
    const element = new Image();
    let cancelled = false;
    element.onload = () => {
      if (!cancelled) {
        setImage(element);
      }
    };
    element.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (media !== undefined && displayDerivative === undefined) {
    // Resolved, but nothing displayable exists. Still `loading` only while
    // processing may yet produce a derivative; otherwise honestly
    // `unavailable` — every PDF plan (no derivatives yet by design), and
    // any plan whose processing failed.
    return media.processingState === 'processing' ? { kind: 'loading' } : { kind: 'unavailable' };
  }
  if (image !== null) {
    return { kind: 'ready', image };
  }
  if (statusQuery.isError || accessQuery.isError) {
    return { kind: 'unavailable' };
  }
  return { kind: 'loading' };
}
