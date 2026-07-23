import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { MediaClass } from './media-record.js';
import {
  deriveDefaultSensitivityClassification,
  normalizeChecksumSha256,
  normalizeDisplayFilename,
  registerMediaRecord,
  validateDeclaredByteSize,
  validateDeclaredContentType,
} from './media-record.js';

const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const CAPTURE_SESSION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const ORIGINAL_MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f';
const NOW = new Date('2026-07-21T09:00:00Z');
const VALID_CHECKSUM = 'a'.repeat(64);

interface RegisterFixtureOptions {
  readonly gardenId?: string | null;
  readonly mediaClass?: MediaClass;
  readonly displayFilename?: string;
  readonly declaredContentType?: string;
  readonly declaredByteSize?: number;
  readonly checksumSha256?: string | null;
  readonly captureSessionId?: string | null;
  readonly derivedFromMediaId?: string | null;
  readonly transformationVersion?: number | null;
}

/** Registers a media record with sensible defaults, overriding only the fields a test cares about. */
function registerFixture(options: RegisterFixtureOptions = {}) {
  return registerMediaRecord(
    MEDIA_ID,
    options.gardenId === undefined ? GARDEN_ID : options.gardenId,
    PROFILE_ID,
    options.mediaClass ?? 'garden_photo',
    options.displayFilename ?? '  vacation photo.jpg  ',
    options.declaredContentType ?? '  image/jpeg  ',
    options.declaredByteSize ?? 123_456,
    options.checksumSha256 ?? null,
    options.captureSessionId ?? null,
    options.derivedFromMediaId ?? null,
    options.transformationVersion ?? null,
    NOW,
  );
}

describe('registerMediaRecord', () => {
  it('normalizes the display filename and content type, and stamps documented defaults', () => {
    const record = registerFixture();

    expect(record).toEqual({
      id: MEDIA_ID,
      gardenId: GARDEN_ID,
      uploadedByProfileId: PROFILE_ID,
      mediaClass: 'garden_photo',
      displayFilename: 'vacation photo.jpg',
      declaredContentType: 'image/jpeg',
      verifiedContentType: null,
      declaredByteSize: 123_456,
      verifiedByteSize: null,
      checksumSha256: null,
      bucketName: null,
      objectKey: null,
      uploadState: 'registered',
      processingState: null,
      captureSessionId: null,
      sensitivityClassification: 'standard',
      retentionDeadlineAt: null,
      derivedFromMediaId: null,
      transformationVersion: null,
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('accepts a null gardenId', () => {
    expect(registerFixture({ gardenId: null }).gardenId).toBeNull();
  });

  it('records a bare captureSessionId', () => {
    expect(registerFixture({ captureSessionId: CAPTURE_SESSION_ID }).captureSessionId).toBe(
      CAPTURE_SESSION_ID,
    );
  });

  it('normalizes a supplied checksum and derives sensitivity from the media class', () => {
    const record = registerFixture({
      mediaClass: 'raw_capture',
      checksumSha256: VALID_CHECKSUM.toUpperCase(),
    });
    expect(record.checksumSha256).toBe(VALID_CHECKSUM);
    expect(record.sensitivityClassification).toBe('restricted');
  });

  it('registers a derivative with derivedFromMediaId and transformationVersion set together', () => {
    const record = registerFixture({
      mediaClass: 'derived_preview',
      derivedFromMediaId: ORIGINAL_MEDIA_ID,
      transformationVersion: 2,
    });
    expect(record.derivedFromMediaId).toBe(ORIGINAL_MEDIA_ID);
    expect(record.transformationVersion).toBe(2);
  });

  it('rejects a transformationVersion without a derivedFromMediaId', () => {
    expect(() => registerFixture({ transformationVersion: 2 })).toThrow(ValidationError);
  });

  it('rejects a blank display filename, a blank content type, and a non-positive byte size', () => {
    expect(() => registerFixture({ displayFilename: '   ' })).toThrow(ValidationError);
    expect(() => registerFixture({ declaredContentType: '   ' })).toThrow(ValidationError);
    expect(() => registerFixture({ declaredByteSize: 0 })).toThrow(ValidationError);
  });
});

describe('normalizeDisplayFilename', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeDisplayFilename('  photo.jpg  ')).toBe('photo.jpg');
  });

  it('strips a leading directory component from a forward-slash path', () => {
    expect(normalizeDisplayFilename('/etc/passwd/photo.jpg')).toBe('photo.jpg');
    expect(normalizeDisplayFilename('../../secrets/photo.jpg')).toBe('photo.jpg');
  });

  it('strips a leading directory component from a backslash (Windows) path', () => {
    expect(normalizeDisplayFilename('C:\\Users\\alice\\Pictures\\photo.jpg')).toBe('photo.jpg');
  });

  it('strips control characters, including NUL and DEL', () => {
    const withControlCharacters = `pho${String.fromCharCode(0)}to${String.fromCharCode(127)}.jpg`;
    expect(normalizeDisplayFilename(withControlCharacters)).toBe('photo.jpg');
  });

  it('truncates to 255 characters', () => {
    const longName = `${'a'.repeat(300)}.jpg`;
    const normalized = normalizeDisplayFilename(longName);
    expect(normalized.length).toBe(255);
    expect(normalized).toBe('a'.repeat(255));
  });

  it('throws a ValidationError when nothing survives normalization', () => {
    try {
      normalizeDisplayFilename('   ');
      expect.unreachable('normalizeDisplayFilename did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toEqual([
        { code: 'media.media_record.display_filename.blank', pointer: '/displayFilename' },
      ]);
    }
  });

  it('throws when a path with only directory components and no trailing filename normalizes to blank', () => {
    expect(() => normalizeDisplayFilename('folder/')).toThrow(ValidationError);
  });
});

describe('validateDeclaredContentType', () => {
  it('returns the trimmed value when non-blank', () => {
    expect(validateDeclaredContentType('  image/png  ')).toBe('image/png');
  });

  it('throws a ValidationError on a blank value', () => {
    expect(() => validateDeclaredContentType('   ')).toThrow(ValidationError);
  });
});

describe('validateDeclaredByteSize', () => {
  it('returns a positive integer unchanged', () => {
    expect(validateDeclaredByteSize(42)).toBe(42);
  });

  it('rejects zero, negative, and non-integer values', () => {
    expect(() => validateDeclaredByteSize(0)).toThrow(ValidationError);
    expect(() => validateDeclaredByteSize(-1)).toThrow(ValidationError);
    expect(() => validateDeclaredByteSize(1.5)).toThrow(ValidationError);
  });
});

describe('normalizeChecksumSha256', () => {
  it('returns null unchanged', () => {
    expect(normalizeChecksumSha256(null)).toBeNull();
  });

  it('trims and lowercases a valid checksum', () => {
    expect(normalizeChecksumSha256(`  ${VALID_CHECKSUM.toUpperCase()}  `)).toBe(VALID_CHECKSUM);
  });

  it('rejects a checksum of the wrong length or containing non-hex characters', () => {
    expect(() => normalizeChecksumSha256('abc')).toThrow(ValidationError);
    expect(() => normalizeChecksumSha256('g'.repeat(64))).toThrow(ValidationError);
  });
});

describe('deriveDefaultSensitivityClassification', () => {
  it('classifies garden_photo and derived_preview as standard', () => {
    expect(deriveDefaultSensitivityClassification('garden_photo')).toBe('standard');
    expect(deriveDefaultSensitivityClassification('derived_preview')).toBe('standard');
  });

  it('classifies imported_plan, processing_output, and export_package as sensitive', () => {
    expect(deriveDefaultSensitivityClassification('imported_plan')).toBe('sensitive');
    expect(deriveDefaultSensitivityClassification('processing_output')).toBe('sensitive');
    expect(deriveDefaultSensitivityClassification('export_package')).toBe('sensitive');
  });

  it('classifies raw_capture as restricted', () => {
    expect(deriveDefaultSensitivityClassification('raw_capture')).toBe('restricted');
  });
});
