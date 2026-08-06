import { describe, expect, it, vi } from 'vitest';

import { UsgsNaipAerialImageryAdapter } from './usgs-naip-aerial-imagery-adapter.js';

const request = {
  bounds: { west: -87.651, south: 41.879, east: -87.649, north: 41.881 },
  widthPixels: 1024,
  heightPixels: 1024,
};

describe('UsgsNaipAerialImageryAdapter', () => {
  it('fetches a bounded export and retains source and licence identity', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            href: 'https://imagery.nationalmap.gov/export/result.jpg',
            width: 1024,
            height: 1024,
            extent: { xmin: -87.651, ymin: 41.879, xmax: -87.649, ymax: 41.881 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': '3' },
        }),
      );

    const outcome = await new UsgsNaipAerialImageryAdapter(fetch).fetchImage(
      request,
      new AbortController().signal,
    );

    expect(outcome.kind).toBe('available');
    if (outcome.kind === 'available') {
      expect(outcome.image.identity.providerKey).toBe('usgs-naip-plus');
      expect(outcome.image.identity.licenseName).toBe('United States public domain');
      expect(outcome.image.identity.capturedOn).toBeNull();
      expect(outcome.image.groundResolutionMetres).toBeGreaterThan(0);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not call the provider outside supported US bounds', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const outcome = await new UsgsNaipAerialImageryAdapter(fetch).fetchImage(
      { ...request, bounds: { west: 2.2, south: 48.8, east: 2.4, north: 49 } },
      new AbortController().signal,
    );
    expect(outcome).toEqual({ kind: 'outsideCoverage' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a provider-controlled image redirect to another host', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          href: 'https://example.invalid/private.jpg',
          width: 1024,
          height: 1024,
          extent: { xmin: -87.651, ymin: 41.879, xmax: -87.649, ymax: 41.881 },
        }),
        { status: 200 },
      ),
    );
    await expect(
      new UsgsNaipAerialImageryAdapter(fetch).fetchImage(request, new AbortController().signal),
    ).resolves.toEqual({ kind: 'unusable', reason: 'unexpectedImageHost' });
  });
});
