import type {
  HealthSuggestionDisposition,
  HealthSuggestionSafetyClass,
  ImageAnalysisKind,
  ObservationActorType,
  ObservationCorrectionKind,
} from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  actorTypeLabel,
  analysisKindLabel,
  correctionKindLabel,
  dispositionLabel,
  safetyClassLabel,
  safetyClassTone,
} from './labels';

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

describe('safetyClassLabel', () => {
  it.each<[HealthSuggestionSafetyClass, string]>([
    ['informational', 'observations.enum.safetyClass.informational'],
    ['monitor', 'observations.enum.safetyClass.monitor'],
    ['expert_review_recommended', 'observations.enum.safetyClass.expertReviewRecommended'],
  ])('maps %s to %s', (safetyClass, key) => {
    expect(safetyClassLabel(safetyClass)).toBe(key);
  });
});

describe('safetyClassTone', () => {
  it('reserves the negative tone for expert_review_recommended', () => {
    expect(safetyClassTone('informational')).toBe('neutral');
    expect(safetyClassTone('monitor')).toBe('neutral');
    expect(safetyClassTone('expert_review_recommended')).toBe('negative');
  });
});

describe('dispositionLabel', () => {
  it.each<[HealthSuggestionDisposition, string]>([
    ['unresolved', 'observations.enum.disposition.unresolved'],
    ['confirmed_externally', 'observations.enum.disposition.confirmedExternally'],
    ['accepted_as_observation', 'observations.enum.disposition.acceptedAsObservation'],
    ['rejected', 'observations.enum.disposition.rejected'],
  ])('maps %s to %s', (disposition, key) => {
    expect(dispositionLabel(disposition)).toBe(key);
  });
});
