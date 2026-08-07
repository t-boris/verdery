/**
 * Reviewable object tracing from a north-up aerial image centred on a saved
 * garden address. The provider reports image-normalized points only; the
 * gardens-mapping use case owns their conversion into garden-local metres.
 */

import type { Position } from '@verdery/geometry-contracts';

/** Ground width and height represented by every tracing image. */
export const AERIAL_TRACE_SPAN_METRES = 160;

export type AerialTraceCategory =
  'structure' | 'path' | 'fence' | 'zone' | 'waterFeature' | 'utilityExclusion' | 'tree';

export type AerialTraceEvidence = 'visible' | 'inferred';

export interface ExtractedAerialShape {
  readonly category: AerialTraceCategory;
  readonly label: string;
  /** Normalized image coordinates, origin at the top-left. */
  readonly imagePoints: readonly Position[];
  readonly confidence: number;
  readonly evidence: AerialTraceEvidence;
}

export interface ExtractedAerialSite {
  readonly objects: readonly ExtractedAerialShape[];
}

export type AerialTracingAdapterOutcome =
  | { readonly kind: 'extracted'; readonly site: ExtractedAerialSite }
  | { readonly kind: 'imageryUnavailable' }
  | { readonly kind: 'schemaInvalid'; readonly rawText: string | null }
  | { readonly kind: 'safetyBlocked' };

export interface AerialTracingRequest {
  /** `[longitude, latitude]`, at the centre of the requested image. */
  readonly geographicCenter: Position;
  readonly displayAddress: string | null;
  /** Saved survey-lot ring in normalized image coordinates, without a repeated closure point. */
  readonly lotBoundaryImagePoints: readonly Position[];
}

export interface AerialTracingProviderAdapter {
  traceSite(
    request: AerialTracingRequest,
    signal: AbortSignal,
  ): Promise<AerialTracingAdapterOutcome>;
}
