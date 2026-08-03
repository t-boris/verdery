import { describe, expect, it, vi } from 'vitest';

import { computeSha256Hex } from './media-checksum';

describe('computeSha256Hex', () => {
  it('produces the same digest the server compares against', async () => {
    // The SHA-256 of "abc", the standard test vector — a hand-checked value,
    // not one this implementation produced and then asserted about itself.
    const digest = await computeSha256Hex(new Blob(['abc']));

    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('produces lowercase hex of the full digest length', async () => {
    const digest = await computeSha256Hex(new Blob(['a longer body of bytes']));

    // The contract's own `^[0-9a-f]{64}$` pattern; an uppercase or truncated
    // value would be rejected at registration.
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns null rather than failing the upload when the platform will not hash', async () => {
    const subtle = globalThis.crypto.subtle;
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValueOnce(new Error('refused'));

    const digest = await computeSha256Hex(new Blob(['abc']));

    // An unverifiable upload is still better than no upload; the integrity
    // step must not become a new way to fail.
    expect(digest).toBeNull();
    expect(subtle).toBe(globalThis.crypto.subtle);
  });
});
