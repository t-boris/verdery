import type { Media, MediaAccess, MediaUploadSession } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createMediaGateway } from './media-gateway';

const ORIGIN = 'https://api.example.test';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const IDEMPOTENCY_KEY = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function gatewayRecording(response: Response) {
  const recorded: RecordedRequest[] = [];
  const fetchImplementation: FetchLike = (url, init) => {
    recorded.push({ url, init });
    return Promise.resolve(response);
  };

  const client = createApiClient({ origin: ORIGIN, fetchImplementation });
  return { gateway: createMediaGateway(client), recorded };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headersOf(recorded: RecordedRequest): Record<string, string> {
  return recorded.init.headers as Record<string, string>;
}

const MEDIA: Media = {
  id: MEDIA_ID,
  gardenId: GARDEN_ID,
  uploadedByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
  mediaClass: 'garden_photo',
  displayFilename: 'backyard.jpg',
  declaredContentType: 'image/jpeg',
  verifiedContentType: null,
  declaredByteSize: 1_048_576,
  verifiedByteSize: null,
  checksumSha256: null,
  uploadState: 'authorized',
  processingState: null,
  sensitivityClassification: 'standard',
  revision: 1,
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
};

const UPLOAD_SESSION: MediaUploadSession = {
  media: MEDIA,
  uploadUrl: 'https://storage.googleapis.com/upload/storage/v1/b/bucket/o?uploadId=abc',
  uploadUrlExpiresAt: '2026-07-21T10:00:00Z',
};

describe('createMediaGateway', () => {
  it('posts the registration body and idempotency key on register', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(UPLOAD_SESSION, 201));

    const result = await gateway.register(
      GARDEN_ID,
      {
        mediaClass: 'garden_photo',
        displayFilename: 'backyard.jpg',
        declaredContentType: 'image/jpeg',
        declaredByteSize: 1_048_576,
      },
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/media`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({
      mediaClass: 'garden_photo',
      displayFilename: 'backyard.jpg',
      declaredContentType: 'image/jpeg',
      declaredByteSize: 1_048_576,
    });
    expect(result).toEqual(expect.objectContaining({ ok: true, data: UPLOAD_SESSION }));
  });

  it('gets a media record status by id, with no special headers', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(MEDIA, 200));

    const result = await gateway.getStatus(GARDEN_ID, MEDIA_ID);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/media/${MEDIA_ID}`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: MEDIA }));
  });

  it('sends the quoted revision and idempotency key on complete', async () => {
    const resolved: Media = { ...MEDIA, uploadState: 'available', revision: 2 };
    const { gateway, recorded } = gatewayRecording(jsonResponse(resolved, 200));

    const result = await gateway.complete(GARDEN_ID, MEDIA_ID, 1, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/media/${MEDIA_ID}/complete`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(headersOf(recorded[0]!)['if-match']).toBe('"1"');
    expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
    expect(result).toEqual(expect.objectContaining({ ok: true, data: resolved }));
  });

  it('gets short-lived access to a media object', async () => {
    const access: MediaAccess = {
      url: 'https://storage.googleapis.com/verdery-dev-user-media/signed?x=1',
      expiresAt: '2026-07-21T09:15:00Z',
    };
    const { gateway, recorded } = gatewayRecording(jsonResponse(access, 200));

    const result = await gateway.getAccess(GARDEN_ID, MEDIA_ID);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/media/${MEDIA_ID}/access`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: access }));
  });

  it('lists garden media with class, cursor, and limit query parameters', async () => {
    const listResult = { items: [MEDIA] };
    const { gateway, recorded } = gatewayRecording(jsonResponse(listResult, 200));

    const result = await gateway.list(GARDEN_ID, {
      mediaClass: 'imported_plan',
      cursor: 'abc',
      limit: 10,
    });

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/media?mediaClass=imported_plan&cursor=abc&limit=10`,
    );
    expect(recorded[0]?.init.method).toBe('GET');
    expect(result).toEqual(expect.objectContaining({ ok: true, data: listResult }));
  });

  it('lists garden media with no query string when no options are given', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse({ items: [] }, 200));

    await gateway.list(GARDEN_ID);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/media`);
  });
});
