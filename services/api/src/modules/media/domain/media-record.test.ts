import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { registerMediaRecord, validateMimeType, validateStorageReference } from './media-record.js';

const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const NOW = new Date('2026-07-21T09:00:00Z');

describe('registerMediaRecord', () => {
  it('trims the storage reference and MIME type and stamps createdAt from the injected clock', () => {
    const record = registerMediaRecord(
      MEDIA_ID,
      '  gs://verdery-media/example.jpg  ',
      '  image/jpeg  ',
      PROFILE_ID,
      NOW,
    );

    expect(record).toEqual({
      id: MEDIA_ID,
      storageReference: 'gs://verdery-media/example.jpg',
      mimeType: 'image/jpeg',
      uploadedByProfileId: PROFILE_ID,
      createdAt: NOW,
    });
  });

  it('rejects a blank storage reference, including one that is blank only after trimming', () => {
    expect(() => registerMediaRecord(MEDIA_ID, '   ', 'image/jpeg', PROFILE_ID, NOW)).toThrow(
      ValidationError,
    );
  });

  it('rejects a blank MIME type, including one that is blank only after trimming', () => {
    expect(() =>
      registerMediaRecord(MEDIA_ID, 'gs://verdery-media/example.jpg', '   ', PROFILE_ID, NOW),
    ).toThrow(ValidationError);
  });
});

describe('validateStorageReference', () => {
  it('returns the trimmed value when non-blank', () => {
    expect(validateStorageReference('  gs://bucket/key  ')).toBe('gs://bucket/key');
  });

  it('throws a ValidationError with a storage-reference-specific detail on a blank value', () => {
    try {
      validateStorageReference('   ');
      expect.unreachable('validateStorageReference did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toEqual([
        { code: 'media.storage_reference.blank', pointer: '/storageReference' },
      ]);
    }
  });
});

describe('validateMimeType', () => {
  it('returns the trimmed value when non-blank', () => {
    expect(validateMimeType('  image/png  ')).toBe('image/png');
  });

  it('throws a ValidationError with a mime-type-specific detail on a blank value', () => {
    try {
      validateMimeType('   ');
      expect.unreachable('validateMimeType did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toEqual([
        { code: 'media.mime_type.blank', pointer: '/mimeType' },
      ]);
    }
  });
});
