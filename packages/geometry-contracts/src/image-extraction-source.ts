/** Durable lineage for geometry accepted from an aerial-image proposal. */
export interface AerialObjectSourceMetadata {
  readonly kind: 'aerialImageExtraction';
  readonly proposalId: string;
  readonly processor: string;
  readonly model: string;
  readonly promptTemplateVersion: number;
  readonly boundaryEvidence: 'notApplicable' | 'visualEvidence';
  readonly limitations: readonly string[];
  readonly imagery: {
    readonly providerKey: string;
    readonly providerName: string;
    readonly sourceId: string;
    readonly capturedOn: string | null;
    readonly attributionText: string;
    readonly attributionUrl: string;
    readonly licenseName: string;
    readonly licenseUrl: string;
  };
  readonly imageryBounds: {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
  };
  readonly imageryWidthPixels: number;
  readonly imageryHeightPixels: number;
  readonly imageryResolutionMetres: number;
  readonly imageryHorizontalAccuracyMetres: number | null;
  readonly georeferenceRevision: number;
}

export type ObjectSourceMetadata = AerialObjectSourceMetadata;
