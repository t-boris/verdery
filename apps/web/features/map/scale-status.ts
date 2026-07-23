import type { WireGeoreference } from '@/core/api/public';
import type { MessageArguments, MessageKey } from '@/shared/localization/public';

/**
 * `accuracyMetres`/`scaleCorrection` on `WireGeoreference` were, before this
 * work package, used only for coordinate-transform math
 * (`basemap-provider.ts`) — never surfaced to the user as text. This module
 * turns the presence (or absence) of a garden's georeference into a short,
 * localized status line for `map-scale-badge.tsx`.
 *
 * A garden with no georeference at all is a normal, expected state — a
 * garden can be mapped in local metres only, with no real-world anchor —
 * not an error, so the no-scale case is worded informationally, never as a
 * warning.
 */
export interface ScaleStatus {
  readonly key: MessageKey;
  readonly args?: MessageArguments;
}

export function scaleStatusFor(georeference: WireGeoreference | undefined): ScaleStatus {
  if (georeference === undefined) {
    return { key: 'map.scale.noScale' };
  }
  if (georeference.accuracyMetres === undefined) {
    return { key: 'map.scale.georeferenced' };
  }
  return {
    key: 'map.scale.georeferencedAccuracy',
    args: { accuracyMetres: georeference.accuracyMetres },
  };
}
