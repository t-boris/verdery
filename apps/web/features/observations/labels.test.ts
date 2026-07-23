import type {
  ImageAnalysisKind,
  ObservationActorType,
  ObservationCorrectionKind,
} from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { actorTypeLabel, analysisKindLabel, correctionKindLabel } from './labels';

describe('analysisKindLabel', () => {
  it.each<[ImageAnalysisKind, string]>([
    ['stress', 'observations.enum.analysisKind.stress'],
    ['disease', 'observations.enum.analysisKind.disease'],
    ['pest', 'observations.enum.analysisKind.pest'],
    ['other', 'observations.enum.analysisKind.other'],
  ])('maps %s to %s', (kind, key) => {
    expect(analysisKindLabel(kind)).toBe(key);
  });
});

describe('correctionKindLabel', () => {
  it.each<[ObservationCorrectionKind, string]>([
    ['amendment', 'observations.enum.correctionKind.amendment'],
    ['supersede', 'observations.enum.correctionKind.supersede'],
  ])('maps %s to %s', (kind, key) => {
    expect(correctionKindLabel(kind)).toBe(key);
  });
});

describe('actorTypeLabel', () => {
  it.each<[ObservationActorType, string]>([
    ['user', 'observations.enum.actorType.user'],
    ['system', 'observations.enum.actorType.system'],
  ])('maps %s to %s', (actor, key) => {
    expect(actorTypeLabel(actor)).toBe(key);
  });
});
