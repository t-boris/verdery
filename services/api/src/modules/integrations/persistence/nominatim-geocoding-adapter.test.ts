/**
 * The Nominatim adapter: the payload it reads, the failures it converts, and
 * the usage policy it is obliged to keep.
 *
 * The pacing tests matter more than they look. The operator's policy is an
 * absolute maximum of one request per second, and breaking it is how an
 * application gets blocked outright — a failure that would appear to users as
 * "address search stopped working" with nothing in this codebase to explain
 * it. The clock and the sleep are injected so the rule is asserted in
 * milliseconds rather than waited out.
 */

import { describe, expect, it } from 'vitest';

import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import {
  NOMINATIM_MINIMUM_REQUEST_INTERVAL_MS,
  NominatimGeocodingAdapter,
  type NominatimHttpResponse,
} from './nominatim-geocoding-adapter.js';

/** One real row, trimmed to the fields this adapter reads. */
const BERLIN = [
  {
    display_name: 'Brandenburger Tor, Pariser Platz, Mitte, Berlin, 10117, Deutschland',
    lat: '52.5162746',
    lon: '13.3777041',
    addresstype: 'amenity',
  },
];

function respond(body: unknown, ok = true, status = 200): NominatimHttpResponse {
  return { ok, status, json: () => Promise.resolve(body) };
}

function makeAdapter(response: () => NominatimHttpResponse) {
  const calls: { url: string; headers: Readonly<Record<string, string>> }[] = [];
  const adapter = new NominatimGeocodingAdapter({
    fetch: (url, init) => {
      calls.push({ url, headers: init.headers });
      return Promise.resolve(response());
    },
    userAgent: 'Verdery/test (+https://example.invalid)',
  });
  return { adapter, calls };
}

describe('NominatimGeocodingAdapter', () => {
  it('finds a European address, which the service it replaced could not', async () => {
    const { adapter, calls } = makeAdapter(() => respond(BERLIN));

    const candidates = await adapter.findAddressCandidates(
      'Brandenburger Tor, Berlin',
      new AbortController().signal,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.formattedAddress).toContain('Deutschland');
    // `[longitude, latitude]`, and the strings are numbers now.
    expect(candidates[0]?.position[0]).toBeCloseTo(13.3777041, 6);
    expect(candidates[0]?.position[1]).toBeCloseTo(52.5162746, 6);
    expect(calls[0]?.url).toContain('format=jsonv2');
  });

  it('identifies itself, because the service refuses requests that do not', async () => {
    const { adapter, calls } = makeAdapter(() => respond([]));

    await adapter.findAddressCandidates('anywhere', new AbortController().signal);

    expect(calls[0]?.headers['User-Agent']).toBe('Verdery/test (+https://example.invalid)');
  });

  it('refuses to be built without a User-Agent, at composition rather than in front of a user', () => {
    expect(
      () =>
        new NominatimGeocodingAdapter({
          fetch: () => Promise.resolve(respond([])),
          userAgent: '   ',
        }),
    ).toThrow(/userAgent/);
  });

  it('leaves at least a second between requests, which is the policy', async () => {
    let clock = 0;
    const slept: number[] = [];
    const adapter = new NominatimGeocodingAdapter({
      fetch: () => Promise.resolve(respond([])),
      userAgent: 'Verdery/test',
      now: () => clock,
      sleep: (milliseconds) => {
        slept.push(milliseconds);
        clock += milliseconds;
        return Promise.resolve();
      },
    });

    const signal = new AbortController().signal;
    await adapter.findAddressCandidates('one', signal);
    await adapter.findAddressCandidates('two', signal);

    expect(slept).toEqual([NOMINATIM_MINIMUM_REQUEST_INTERVAL_MS]);
  });

  it('paces two searches started in the same tick, rather than letting both leave together', async () => {
    let clock = 0;
    const startedAt: number[] = [];
    const adapter = new NominatimGeocodingAdapter({
      fetch: () => {
        startedAt.push(clock);
        return Promise.resolve(respond([]));
      },
      userAgent: 'Verdery/test',
      now: () => clock,
      sleep: (milliseconds) => {
        clock += milliseconds;
        return Promise.resolve();
      },
    });

    const signal = new AbortController().signal;
    await Promise.all([
      adapter.findAddressCandidates('one', signal),
      adapter.findAddressCandidates('two', signal),
    ]);

    expect(startedAt).toEqual([0, NOMINATIM_MINIMUM_REQUEST_INTERVAL_MS]);
  });

  it('keeps serving after a failure instead of wedging the queue behind it', async () => {
    let attempt = 0;
    const adapter = new NominatimGeocodingAdapter({
      fetch: () => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(new Error('network down'));
        }
        return Promise.resolve(respond(BERLIN));
      },
      userAgent: 'Verdery/test',
      now: () => 0,
      sleep: () => Promise.resolve(),
    });

    const signal = new AbortController().signal;
    await expect(adapter.findAddressCandidates('one', signal)).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );

    await expect(adapter.findAddressCandidates('two', signal)).resolves.toHaveLength(1);
  });

  it('converts a non-2xx status into a typed degradation', async () => {
    const { adapter } = makeAdapter(() => respond(null, false, 429));

    await expect(
      adapter.findAddressCandidates('anywhere', new AbortController().signal),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
  });

  it('converts a body that is not the documented array into a typed degradation', async () => {
    const { adapter } = makeAdapter(() => respond({ error: 'nope' }));

    await expect(
      adapter.findAddressCandidates('anywhere', new AbortController().signal),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
  });

  it('treats no matches as an answer, not a failure', async () => {
    const { adapter } = makeAdapter(() => respond([]));

    await expect(
      adapter.findAddressCandidates('nowhere at all', new AbortController().signal),
    ).resolves.toEqual([]);
  });

  it('drops an unusable row and keeps the usable ones', async () => {
    const { adapter } = makeAdapter(() =>
      respond([{ display_name: 'No coordinates here', lat: '', lon: '' }, ...BERLIN]),
    );

    const candidates = await adapter.findAddressCandidates('Berlin', new AbortController().signal);

    expect(candidates).toHaveLength(1);
  });

  it('reads the address type as the coarse precision the port asks for', async () => {
    const { adapter } = makeAdapter(() =>
      respond([
        { display_name: 'A road', lat: '1', lon: '1', addresstype: 'road' },
        { display_name: 'A city', lat: '2', lon: '2', addresstype: 'city' },
        { display_name: 'A house', lat: '3', lon: '3', addresstype: 'house' },
      ]),
    );

    const candidates = await adapter.findAddressCandidates('x', new AbortController().signal);

    expect(candidates.map((candidate) => candidate.precision)).toEqual([
      'street',
      'area',
      'streetAddress',
    ]);
  });
});
