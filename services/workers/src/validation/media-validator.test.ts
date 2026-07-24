import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MediaProcessingManifest } from '@verdery/api-contracts';
// `sharp` is a devDependency ONLY — used here to fabricate a real, valid PNG
// fixture; it is never imported by runtime validation code (see
// `image-metadata-parser.ts`'s own header comment for why the runtime path
// uses the pure-JS `image-size` instead).
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MaterializedMediaObject, MediaObjectSource } from './media-object-source.js';
import { MediaValidator } from './media-validator.js';
import {
  MalwareScanUnavailableError,
  type MalwareScanner,
  UnavailableMalwareScanner,
} from './validation-result.js';

const JOB_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c00';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c01';

class BufferObjectSource implements MediaObjectSource {
  constructor(private readonly bytes: Buffer) {}

  async materialize(): Promise<MaterializedMediaObject> {
    const directory = await mkdtemp(join(tmpdir(), 'verdery-validator-test-'));
    const path = join(directory, randomUUID());
    await writeFile(path, this.bytes, { mode: 0o600 });
    return {
      path,
      byteSize: this.bytes.length,
      checksumSha256: createHash('sha256').update(this.bytes).digest('hex'),
      header: this.bytes.subarray(0, 64 * 1024),
      dispose: async () => rm(directory, { recursive: true, force: true }),
    };
  }
}

class FixedMalwareScanner implements MalwareScanner {
  constructor(private readonly status: 'clean' | 'malicious') {}

  scan() {
    return Promise.resolve({ status: this.status, provider: 'test-scanner' } as const);
  }
}

function manifest(
  bytes: Buffer,
  contentType: string,
  overrides: Partial<MediaProcessingManifest['validation']> = {},
): MediaProcessingManifest {
  return {
    jobId: JOB_ID,
    mediaId: MEDIA_ID,
    processorConfigVersion: 'v1',
    inputObjects: [{ bucketName: 'private-bucket', objectKey: 'opaque/object' }],
    expectedChecksums: [createHash('sha256').update(bytes).digest('hex')],
    validation: {
      mediaClass: contentType === 'application/pdf' ? 'imported_plan' : 'garden_photo',
      displayFilename: contentType === 'application/pdf' ? 'plan.pdf' : 'photo.png',
      expectedContentType: contentType,
      expectedByteSize: bytes.length,
      ...overrides,
    },
  };
}

const VALID_PDF = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\nxref\n0 4\n' +
    '0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n0\n%%EOF\n',
  'latin1',
);

let validPng: Buffer;
beforeAll(async () => {
  validPng = await sharp({
    create: { width: 8, height: 6, channels: 3, background: '#228833' },
  })
    .png()
    .toBuffer();
});

describe('MediaValidator malicious and malformed fixture suite', () => {
  it('accepts a fully decodable image and records dimensions and checksum', async () => {
    const result = await new MediaValidator(
      new BufferObjectSource(validPng),
      new UnavailableMalwareScanner(),
    ).validate(manifest(validPng, 'image/png'));

    expect(result).toMatchObject({
      accepted: true,
      detectedContentType: 'image/png',
      metadata: { kind: 'image', width: 8, height: 6 },
      malwareScan: 'not_required',
    });
  });

  it('rejects a declared PNG whose bytes have a JPEG signature', async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
    const result = await new MediaValidator(
      new BufferObjectSource(fakeJpeg),
      new UnavailableMalwareScanner(),
    ).validate(manifest(fakeJpeg, 'image/png'));

    expect(result).toMatchObject({
      accepted: false,
      code: 'content_type_mismatch',
      detectedContentType: 'image/jpeg',
    });
  });

  it('rejects a truncated image even when its magic signature is valid', async () => {
    const truncated = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const result = await new MediaValidator(
      new BufferObjectSource(truncated),
      new UnavailableMalwareScanner(),
    ).validate(manifest(truncated, 'image/jpeg', { displayFilename: 'photo.jpg' }));

    expect(result).toMatchObject({ accepted: false, code: 'malformed_file' });
  });

  it('rejects a checksum mismatch before invoking a parser', async () => {
    const request = manifest(validPng, 'image/png');
    const result = await new MediaValidator(
      new BufferObjectSource(validPng),
      new UnavailableMalwareScanner(),
    ).validate({ ...request, expectedChecksums: ['0'.repeat(64)] });

    expect(result).toMatchObject({ accepted: false, code: 'checksum_mismatch' });
  });

  it('rejects active PDF content before malware scanning', async () => {
    const activePdf = Buffer.from(
      VALID_PDF.toString('latin1').replace('xref', '/OpenAction 4 0 R\nxref'),
      'latin1',
    );
    const result = await new MediaValidator(
      new BufferObjectSource(activePdf),
      new FixedMalwareScanner('clean'),
    ).validate(manifest(activePdf, 'application/pdf'));

    expect(result).toMatchObject({ accepted: false, code: 'active_content_rejected' });
  });

  it('rejects a structurally accepted PDF when the scanner detects malware', async () => {
    const result = await new MediaValidator(
      new BufferObjectSource(VALID_PDF),
      new FixedMalwareScanner('malicious'),
    ).validate(manifest(VALID_PDF, 'application/pdf'));

    expect(result).toMatchObject({
      accepted: false,
      code: 'malware_detected',
      malwareScan: 'malicious',
    });
  });

  it('fails retryably instead of pretending an unscanned PDF is clean', async () => {
    const validation = new MediaValidator(
      new BufferObjectSource(VALID_PDF),
      new UnavailableMalwareScanner(),
    ).validate(manifest(VALID_PDF, 'application/pdf'));

    await expect(validation).rejects.toBeInstanceOf(MalwareScanUnavailableError);
  });

  it('rejects a "dimension bomb": a PNG whose own header declares dimensions exceeding the validation policy, without decoding pixel data', async () => {
    // A hand-constructed but structurally complete PNG: real 8-byte
    // signature, a real 13-byte IHDR chunk declaring 50,000 x 50,000 pixels
    // (2.5 billion pixels — the classic decompression-bomb shape, where a
    // tiny file declares enormous dimensions), a minimal IDAT chunk, and an
    // IEND chunk. CRC fields are filler zero bytes: neither `file-type` nor
    // `image-size` validates PNG chunk CRCs to determine the file type or
    // read its declared dimensions (confirmed against both libraries' own
    // source), so this fixture is exactly as "valid" as either library
    // requires while remaining trivially hand-constructed. `image-size`
    // reads ONLY the IHDR header bytes to get width/height (never decodes
    // pixels — see image-metadata-parser.ts's own header comment), so this
    // fixture proves the dimension cap is enforced from the header alone,
    // before any decode would ever run.
    function u32be(value: number): Buffer {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32BE(value >>> 0, 0);
      return buffer;
    }
    function chunk(type: string, data: Buffer): Buffer {
      return Buffer.concat([u32be(data.length), Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
    }

    const oversizedDimension = 50_000;
    const ihdrData = Buffer.concat([
      u32be(oversizedDimension),
      u32be(oversizedDimension),
      Buffer.from([8, 2, 0, 0, 0]), // 8-bit depth, truecolor, default compression/filter/interlace
    ]);
    const dimensionBomb = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
      chunk('IHDR', ihdrData),
      chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
      chunk('IEND', Buffer.alloc(0)),
    ]);

    const result = await new MediaValidator(
      new BufferObjectSource(dimensionBomb),
      new UnavailableMalwareScanner(),
    ).validate(manifest(dimensionBomb, 'image/png'));

    expect(result).toMatchObject({ accepted: false, code: 'malformed_file' });
  });

  it('rejects a byte size that disagrees with the accepted upload record, before any parser runs', async () => {
    const result = await new MediaValidator(
      new BufferObjectSource(validPng),
      new UnavailableMalwareScanner(),
    ).validate(manifest(validPng, 'image/png', { expectedByteSize: validPng.length + 1 }));

    expect(result).toMatchObject({ accepted: false, code: 'byte_size_mismatch' });
  });

  it('rejects a filename extension that does not match the detected content type', async () => {
    const result = await new MediaValidator(
      new BufferObjectSource(validPng),
      new UnavailableMalwareScanner(),
    ).validate(manifest(validPng, 'image/png', { displayFilename: 'photo.pdf' }));

    expect(result).toMatchObject({ accepted: false, code: 'filename_extension_mismatch' });
  });

  it('rejects a manifest for a media class with no validation policy (defensive: this path never sees a raw_capture manifest in production — see process-media-validation-job.ts)', async () => {
    const result = await new MediaValidator(
      new BufferObjectSource(validPng),
      new UnavailableMalwareScanner(),
    ).validate(manifest(validPng, 'image/png', { mediaClass: 'not_a_real_media_class' }));

    expect(result).toMatchObject({ accepted: false, code: 'validation_policy_missing' });
  });
});
