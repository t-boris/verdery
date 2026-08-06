import type { FastifyBaseLogger } from 'fastify';

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  AerialGardenExtractionModelIdentity,
  AerialGardenExtractionProviderAdapter,
  AerialImageryIdentity,
  AerialImageryProviderAdapter,
  GeographicBounds,
  ProviderQuotaLimits,
  ProviderQuotaRepository,
} from '../../integrations/public.js';
import { withDeadline } from '../../integrations/public.js';
import {
  aerialTransformUsable,
  buildAerialProposalGeometry,
  type AerialProposalGeometry,
} from '../domain/aerial-image-transform.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GeoreferenceReader } from './georeference-repository.js';

const IMAGE_SIZE_PIXELS = 1024;
const HALF_EXTENT_METRES = 75;

export interface AerialTraceProposal extends AerialProposalGeometry {
  readonly proposalId: string;
  readonly boundaryEvidence: 'notApplicable' | 'visualEvidence';
  readonly provenance: {
    readonly kind: 'imageExtraction';
    readonly processor: string;
    readonly model: string;
    readonly promptTemplateVersion: number;
    readonly imagery: AerialImageryIdentity;
    readonly imageryBounds: GeographicBounds;
    readonly imageryWidthPixels: number;
    readonly imageryHeightPixels: number;
    readonly imageryResolutionMetres: number;
    readonly imageryHorizontalAccuracyMetres: number | null;
    readonly georeferenceRevision: number;
  };
}

export type AerialTraceResult =
  | {
      readonly kind: 'ready';
      readonly proposals: readonly AerialTraceProposal[];
      readonly imagery: AerialImageryIdentity;
      readonly warning: string;
    }
  | {
      readonly kind:
        | 'disabled'
        | 'notGeoreferenced'
        | 'outsideCoverage'
        | 'unusableImagery'
        | 'quotaExceeded'
        | 'timedOut'
        | 'providerFailure'
        | 'noVisibleGeometry';
    };

export interface AerialTraceConfiguration {
  readonly enabled: boolean;
  readonly imageryTimeoutMs: number;
  readonly visionTimeoutMs: number;
  readonly quotaLimits: ProviderQuotaLimits;
  readonly proposalId: () => string;
}

/** Read-only proposal generation. Canonical writes remain a separate reviewed command. */
export class TraceGardenFromAerial {
  constructor(
    private readonly configuration: AerialTraceConfiguration,
    private readonly imagery: AerialImageryProviderAdapter,
    private readonly vision: AerialGardenExtractionProviderAdapter | null,
    private readonly georeferences: GeoreferenceReader,
    private readonly authorization: GardenAuthorization,
    private readonly quotas: ProviderQuotaRepository,
    private readonly clock: Clock,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid): Promise<AerialTraceResult> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');
    if (!this.configuration.enabled || this.vision === null) {
      return { kind: 'disabled' };
    }
    const georeference = await this.georeferences.findCurrentForGarden(gardenId);
    if (
      georeference === null ||
      georeference.method !== 'addressSearch' ||
      georeference.formattedAddress === null ||
      georeference.formattedAddress === undefined
    ) {
      return { kind: 'notGeoreferenced' };
    }
    const bounds = boundsAround(georeference.geographicAnchor[0], georeference.geographicAnchor[1]);
    let imageryOutcome;
    try {
      imageryOutcome = await withDeadline(this.configuration.imageryTimeoutMs, (signal) =>
        this.imagery.fetchImage(
          { bounds, widthPixels: IMAGE_SIZE_PIXELS, heightPixels: IMAGE_SIZE_PIXELS },
          signal,
        ),
      );
    } catch (error) {
      this.logger.warn(
        { event: 'map.aerial_imagery_provider_failed', error },
        'Aerial image acquisition failed.',
      );
      return { kind: 'providerFailure' };
    }
    if (imageryOutcome.kind === 'timedOut') {
      return { kind: 'timedOut' };
    }
    if (imageryOutcome.value.kind === 'outsideCoverage') {
      return { kind: 'outsideCoverage' };
    }
    if (imageryOutcome.value.kind === 'unusable') {
      return { kind: 'unusableImagery' };
    }
    const image = imageryOutcome.value.image;
    if (!aerialTransformUsable(image, georeference)) {
      return { kind: 'unusableImagery' };
    }

    const quota = await this.quotas.consumeCall(
      this.vision.identity.processor,
      this.configuration.quotaLimits,
      this.clock.now(),
    );
    if (!quota.consumed) {
      return { kind: 'quotaExceeded' };
    }

    let extraction;
    try {
      extraction = await withDeadline(this.configuration.visionTimeoutMs, (signal) =>
        this.vision!.extractGarden(image, signal),
      );
    } catch (error) {
      this.logger.warn(
        { event: 'map.aerial_trace_provider_failed', error },
        'Aerial tracing failed.',
      );
      return { kind: 'providerFailure' };
    }
    if (extraction.kind === 'timedOut') {
      return { kind: 'timedOut' };
    }
    if (extraction.value.kind !== 'extracted') {
      return extraction.value.kind === 'noVisibleGeometry'
        ? { kind: 'noVisibleGeometry' }
        : { kind: 'providerFailure' };
    }

    const proposals = extraction.value.objects.flatMap((object) => {
      const geometry = buildAerialProposalGeometry(object, image.bounds, georeference);
      return geometry === null
        ? []
        : [
            toProposal(
              this.configuration.proposalId(),
              geometry,
              this.vision!.identity,
              image,
              georeference.revision,
              object.boundaryEvidence,
            ),
          ];
    });
    if (proposals.length === 0) {
      return { kind: 'noVisibleGeometry' };
    }
    return {
      kind: 'ready',
      proposals,
      imagery: image.identity,
      warning:
        'Aerial tracing is approximate and cannot establish a legal property boundary. Review every proposal before accepting it.',
    };
  }
}

function boundsAround(longitude: number, latitude: number): GeographicBounds {
  const latitudeDelta = HALF_EXTENT_METRES / 110_574;
  const longitudeDelta = HALF_EXTENT_METRES / (111_320 * Math.cos((latitude * Math.PI) / 180));
  return {
    west: longitude - longitudeDelta,
    south: latitude - latitudeDelta,
    east: longitude + longitudeDelta,
    north: latitude + latitudeDelta,
  };
}

function toProposal(
  proposalId: string,
  proposal: AerialProposalGeometry,
  model: AerialGardenExtractionModelIdentity,
  image: Extract<
    Awaited<ReturnType<AerialImageryProviderAdapter['fetchImage']>>,
    { kind: 'available' }
  >['image'],
  georeferenceRevision: number,
  boundaryEvidence: 'notApplicable' | 'visualEvidence' | 'authoritativeParcel',
): AerialTraceProposal {
  return {
    proposalId,
    boundaryEvidence: boundaryEvidence === 'visualEvidence' ? 'visualEvidence' : 'notApplicable',
    ...proposal,
    provenance: {
      kind: 'imageExtraction',
      processor: model.processor,
      model: model.model,
      promptTemplateVersion: model.promptTemplateVersion,
      imagery: image.identity,
      imageryBounds: image.bounds,
      imageryWidthPixels: image.widthPixels,
      imageryHeightPixels: image.heightPixels,
      imageryResolutionMetres: image.groundResolutionMetres,
      imageryHorizontalAccuracyMetres: image.horizontalAccuracyMetres,
      georeferenceRevision,
    },
  };
}
