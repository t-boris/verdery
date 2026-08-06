/**
 * Provider-neutral acquisition of one bounded orthorectified aerial image.
 * The result carries enough identity and licensing information to remain
 * attributable when it is shown during proposal review.
 */

export interface GeographicBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface AerialImageryRequest {
  readonly bounds: GeographicBounds;
  readonly widthPixels: number;
  readonly heightPixels: number;
}

export interface AerialImageryIdentity {
  readonly providerKey: string;
  readonly providerName: string;
  readonly sourceId: string;
  readonly capturedOn: string | null;
  readonly attributionText: string;
  readonly attributionUrl: string;
  readonly licenseName: string;
  readonly licenseUrl: string;
}

export interface AerialImage {
  readonly bytes: Uint8Array;
  readonly mimeType: 'image/jpeg' | 'image/png';
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly bounds: GeographicBounds;
  readonly groundResolutionMetres: number;
  readonly horizontalAccuracyMetres: number | null;
  readonly identity: AerialImageryIdentity;
}

export type AerialImageryOutcome =
  | { readonly kind: 'available'; readonly image: AerialImage }
  | { readonly kind: 'outsideCoverage' }
  | { readonly kind: 'unusable'; readonly reason: string };

export interface AerialImageryProviderAdapter {
  fetchImage(request: AerialImageryRequest, signal: AbortSignal): Promise<AerialImageryOutcome>;
}
