import { describe, expect, it } from 'vitest';

import { nextGeoreferenceRevision, provenanceForGeoreferenceMethod } from './georeference.js';

describe('provenanceForGeoreferenceMethod', () => {
  it('classifies a device reading as the measurement it is', () => {
    expect(provenanceForGeoreferenceMethod('deviceLocation')).toBe('userMeasurement');
    expect(provenanceForGeoreferenceMethod('controlPoints')).toBe('userMeasurement');
  });

  it('classifies anything read off provider imagery as imported', () => {
    expect(provenanceForGeoreferenceMethod('mapPin')).toBe('importedMapImagery');
    expect(provenanceForGeoreferenceMethod('imageryAlignment')).toBe('importedMapImagery');
  });

  it('classifies typed coordinates as the user asserting them', () => {
    expect(provenanceForGeoreferenceMethod('manualCoordinates')).toBe('manualDrawing');
  });
});

describe('nextGeoreferenceRevision', () => {
  it('starts a never-georeferenced garden at the column default', () => {
    expect(nextGeoreferenceRevision(null)).toBe(1);
  });

  it('supersedes rather than reuses the current revision', () => {
    expect(nextGeoreferenceRevision(1)).toBe(2);
    expect(nextGeoreferenceRevision(37)).toBe(38);
  });
});
