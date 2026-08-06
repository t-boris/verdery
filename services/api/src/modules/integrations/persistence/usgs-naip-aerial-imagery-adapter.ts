import { createHash } from 'node:crypto';
import { z } from 'zod';

import type {
  AerialImageryOutcome,
  AerialImageryProviderAdapter,
  AerialImageryRequest,
} from '../application/aerial-imagery-provider.js';

const ENDPOINT =
  'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage';
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

const exportResponseSchema = z.object({
  href: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  extent: z.object({
    xmin: z.number(),
    ymin: z.number(),
    xmax: z.number(),
    ymax: z.number(),
  }),
});

export type AerialHttpFetch = typeof globalThis.fetch;

/** US-only, public-domain NAIP imagery through the National Map export service. */
export class UsgsNaipAerialImageryAdapter implements AerialImageryProviderAdapter {
  constructor(private readonly fetch: AerialHttpFetch) {}

  async fetchImage(
    request: AerialImageryRequest,
    signal: AbortSignal,
  ): Promise<AerialImageryOutcome> {
    if (!isUsRequest(request)) {
      return { kind: 'outsideCoverage' };
    }

    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({
      f: 'json',
      bbox: `${request.bounds.west},${request.bounds.south},${request.bounds.east},${request.bounds.north}`,
      bboxSR: '4326',
      imageSR: '4326',
      size: `${request.widthPixels},${request.heightPixels}`,
      format: 'jpgpng',
      interpolation: 'RSP_BilinearInterpolation',
    }).toString();

    const metadataResponse = await this.fetch(url, {
      signal,
      headers: { accept: 'application/json' },
    });
    if (!metadataResponse.ok) {
      return { kind: 'unusable', reason: `metadataHttp${metadataResponse.status}` };
    }
    const parsed = exportResponseSchema.safeParse(await metadataResponse.json());
    if (!parsed.success) {
      return { kind: 'unusable', reason: 'invalidMetadata' };
    }

    const imageUrl = new URL(parsed.data.href);
    if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'imagery.nationalmap.gov') {
      return { kind: 'unusable', reason: 'unexpectedImageHost' };
    }
    const imageResponse = await this.fetch(imageUrl, { signal, headers: { accept: 'image/*' } });
    if (!imageResponse.ok) {
      return { kind: 'unusable', reason: `imageHttp${imageResponse.status}` };
    }
    const contentLength = Number(imageResponse.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      return { kind: 'unusable', reason: 'imageTooLarge' };
    }
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESPONSE_BYTES) {
      return { kind: 'unusable', reason: 'invalidImageSize' };
    }

    const extent = parsed.data.extent;
    const centreLatitude = (extent.ymin + extent.ymax) / 2;
    const widthMetres =
      (extent.xmax - extent.xmin) * 111_320 * Math.cos((centreLatitude * Math.PI) / 180);
    const heightMetres = (extent.ymax - extent.ymin) * 110_574;
    const resolution = Math.max(widthMetres / parsed.data.width, heightMetres / parsed.data.height);

    return {
      kind: 'available',
      image: {
        bytes,
        mimeType:
          imageResponse.headers.get('content-type') === 'image/png' ? 'image/png' : 'image/jpeg',
        widthPixels: parsed.data.width,
        heightPixels: parsed.data.height,
        bounds: { west: extent.xmin, south: extent.ymin, east: extent.xmax, north: extent.ymax },
        groundResolutionMetres: resolution,
        // exportImage does not report a per-export accuracy or acquisition date.
        horizontalAccuracyMetres: null,
        identity: {
          providerKey: 'usgs-naip-plus',
          providerName: 'USGS National Map NAIP Plus',
          sourceId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
          capturedOn: null,
          attributionText: 'Aerial imagery: USGS National Map NAIP Plus',
          attributionUrl: 'https://www.usgs.gov/programs/national-geospatial-program/national-map',
          licenseName: 'United States public domain',
          licenseUrl:
            'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
        },
      },
    };
  }
}

function isUsRequest(request: AerialImageryRequest): boolean {
  const { west, south, east, north } = request.bounds;
  return (
    Number.isFinite(west) &&
    Number.isFinite(south) &&
    Number.isFinite(east) &&
    Number.isFinite(north) &&
    west < east &&
    south < north &&
    west >= -180 &&
    east <= -60 &&
    south >= 15 &&
    north <= 72 &&
    request.widthPixels >= 256 &&
    request.widthPixels <= 2048 &&
    request.heightPixels >= 256 &&
    request.heightPixels <= 2048
  );
}
