/**
 * Direct unit coverage of the header-only image dimension checks'
 * TWO DISTINCT ceilings (architecture/media-storage-and-processing.md
 * section 8.1: "bounded to 40 megapixels and 16,384 pixels per axis") —
 * P6-QA-01's parser-limit audit found only their conjunction tested: the
 * `MediaValidator` dimension-bomb fixture (50,000 x 50,000) violates both
 * at once, so either comparison could silently disappear without a test
 * failing. Each case below violates exactly one ceiling while satisfying
 * the other, using the same hand-constructed PNG IHDR technique that
 * fixture documents (neither `file-type` nor `image-size` validates chunk
 * CRCs; `image-size` reads only the IHDR header bytes).
 */

import { describe, expect, it } from 'vitest';
import { parseImageMetadata } from './image-metadata-parser.js';

// The implemented validation profile's own numbers (validation-policy.ts).
const MAX_PIXELS = 40_000_000;
const MAX_DIMENSION = 16_384;

function u32be(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function chunk(type: string, data: Buffer): Buffer {
  return Buffer.concat([u32be(data.length), Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

function pngHeader(width: number, height: number): Buffer {
  const ihdrData = Buffer.concat([
    u32be(width),
    u32be(height),
    Buffer.from([8, 2, 0, 0, 0]), // 8-bit depth, truecolor, default compression/filter/interlace
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    chunk('IHDR', ihdrData),
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('parseImageMetadata dimension ceilings', () => {
  it('accepts dimensions under both ceilings and reports them', () => {
    // 6,000 x 6,000 = 36 MP < 40 MP, both axes < 16,384.
    expect(parseImageMetadata(pngHeader(6_000, 6_000), MAX_PIXELS, MAX_DIMENSION)).toEqual({
      kind: 'image',
      width: 6_000,
      height: 6_000,
    });
  });

  it('rejects a pixel-count violation whose axes both satisfy the per-axis cap — the megapixel ceiling alone', () => {
    // 8,000 x 6,000 = 48 MP > 40 MP; each axis well under 16,384.
    expect(() => parseImageMetadata(pngHeader(8_000, 6_000), MAX_PIXELS, MAX_DIMENSION)).toThrow(
      /exceed the validation policy/u,
    );
  });

  it('rejects a per-axis violation whose total pixels satisfy the megapixel ceiling — the dimension cap alone', () => {
    // 17,000 x 2,000 = 34 MP < 40 MP; the long axis exceeds 16,384.
    expect(() => parseImageMetadata(pngHeader(17_000, 2_000), MAX_PIXELS, MAX_DIMENSION)).toThrow(
      /exceed the validation policy/u,
    );
  });
});
