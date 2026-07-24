/**
 * Unit coverage for `detectContentType`, the `file-type`-backed magic-byte
 * MIME-signature detector — the security-critical primitive
 * `media-validator.ts` compares against a record's own declared/verified
 * content type (architecture/media-storage-and-processing.md section
 * "8. File Validation": "MIME signature rather than filename alone").
 *
 * Every fixture here is synthetic, hand-constructed bytes — never a real
 * file, real malware sample, or downloaded asset — matching this work
 * package's own "safely-constructed fixtures only" requirement.
 */

import { describe, expect, it } from 'vitest';
import { detectContentType } from './content-signature.js';

describe('detectContentType', () => {
  it('detects a JPEG from its SOI magic bytes alone', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    await expect(detectContentType(jpeg)).resolves.toBe('image/jpeg');
  });

  it('detects a PNG from its signature and IHDR/IDAT chunk structure', async () => {
    // `file-type`'s PNG detector confirms the format by finding a real IDAT
    // chunk after IHDR (see its own source) — the bare 8-byte signature
    // alone is not sufficient, so this fixture is a minimal but
    // STRUCTURALLY COMPLETE PNG (matching the same chunk-building approach
    // `media-validator.test.ts`'s own "dimension bomb" fixture uses).
    function u32be(value: number): Buffer {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32BE(value, 0);
      return buffer;
    }
    function chunk(type: string, data: Buffer): Buffer {
      return Buffer.concat([u32be(data.length), Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
    }
    const ihdrData = Buffer.concat([u32be(1), u32be(1), Buffer.from([8, 2, 0, 0, 0])]);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdrData),
      chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
      chunk('IEND', Buffer.alloc(0)),
    ]);

    await expect(detectContentType(png)).resolves.toBe('image/png');
  });

  it('detects a WebP from its RIFF/WEBP container signature', async () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBPVP8 ', 'ascii'),
    ]);
    await expect(detectContentType(webp)).resolves.toBe('image/webp');
  });

  it('detects a PDF from its %PDF- header', async () => {
    const pdf = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1');
    await expect(detectContentType(pdf)).resolves.toBe('application/pdf');
  });

  it('returns null (never throws) for bytes with no recognizable magic signature', async () => {
    const junk = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    await expect(detectContentType(junk)).resolves.toBeNull();
  });

  it('returns null (never throws) for an empty buffer', async () => {
    await expect(detectContentType(Buffer.alloc(0))).resolves.toBeNull();
  });

  it('detects the REAL byte signature even when it disagrees with what a filename would suggest — the disguised-file malicious fixture', async () => {
    // Bytes are a genuine JPEG; a caller might have declared/named this as a
    // PNG. This function reports the truth from the bytes alone — the
    // mismatch itself is `media-validator.ts`'s job to reject, not this
    // function's.
    const jpegBytesNamedAsPng = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x01]);
    await expect(detectContentType(jpegBytesNamedAsPng)).resolves.toBe('image/jpeg');
  });
});
