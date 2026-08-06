/** A vision port whose coordinates remain normalized image coordinates. */

import type { AerialImage } from './aerial-imagery-provider.js';

export type AerialProposalCategory =
  | 'lot'
  | 'structure'
  | 'path'
  | 'fence'
  | 'zone'
  | 'bed'
  | 'waterFeature'
  | 'utilityExclusion'
  | 'tree';

export type NormalizedImagePoint = readonly [number, number];

export interface ExtractedAerialObject {
  readonly category: AerialProposalCategory;
  readonly label: string;
  /** Points are in 0..1 of image width/height, with origin at top-left. */
  readonly points: readonly NormalizedImagePoint[];
  readonly confidence: number;
  readonly limitations: readonly string[];
  /** Required only for a proposed lot. Imagery alone is never authoritative. */
  readonly boundaryEvidence: 'notApplicable' | 'visualEvidence' | 'authoritativeParcel';
}

export type AerialGardenExtractionOutcome =
  | { readonly kind: 'extracted'; readonly objects: readonly ExtractedAerialObject[] }
  | { readonly kind: 'noVisibleGeometry' }
  | { readonly kind: 'schemaInvalid' }
  | { readonly kind: 'safetyBlocked' };

export interface AerialGardenExtractionModelIdentity {
  readonly processor: string;
  readonly model: string;
  readonly promptTemplateVersion: number;
}

export interface AerialGardenExtractionProviderAdapter {
  readonly identity: AerialGardenExtractionModelIdentity;
  extractGarden(image: AerialImage, signal: AbortSignal): Promise<AerialGardenExtractionOutcome>;
}
