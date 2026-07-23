import { describe, expect, it } from 'vitest';
import { createObservationPhoto } from './observation-photo.js';

const PHOTO_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11';
const OBSERVATION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a12';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a13';
const NOW = new Date('2026-07-21T09:00:00Z');

describe('createObservationPhoto', () => {
  it('builds an observation photo stamped with the injected clock', () => {
    expect(createObservationPhoto(PHOTO_ID, OBSERVATION_ID, MEDIA_ID, NOW)).toEqual({
      id: PHOTO_ID,
      observationId: OBSERVATION_ID,
      mediaId: MEDIA_ID,
      createdAt: NOW,
    });
  });
});
