/**
 * The observations-history schemas (P4-CONTRACT-01, extended by P11-MEDIA-01
 * and P11-HEALTH-01).
 *
 * Their own module for the same 600-line reason `./plants.js` and
 * `./plant-candidates.js` already have theirs: this domain gained purpose
 * labels, measurements, symptoms, journal frames, and health dispositions, and
 * `index.ts` reached the limit as they landed.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Observations`.
 */

import type { components } from './generated/schema.js';

type Schemas = components['schemas'];

/** The observations-history schemas (P4-CONTRACT-01). */
export type ObservationActorType = Schemas['ObservationActorType'];
export type ObservationCorrectionKind = Schemas['ObservationCorrectionKind'];
export type ImageAnalysisKind = Schemas['ImageAnalysisKind'];
export type TaxonSeasonalActivity = Schemas['TaxonSeasonalActivity'];
export type PlantDistributionStatus = Schemas['PlantDistributionStatus'];
export type PlantProfileCompleteness = Schemas['PlantProfileCompleteness'];
export type ImageAnalysisResult = Schemas['ImageAnalysisResult'];
export type ObservationPhotoPurpose = Schemas['ObservationPhotoPurpose'];
export type ObservationPhoto = Schemas['ObservationPhoto'];
export type ObservationSymptomKind = Schemas['ObservationSymptomKind'];
export type ObservationSymptomSeverity = Schemas['ObservationSymptomSeverity'];
export type ObservationSymptom = Schemas['ObservationSymptom'];
export type ObservationSymptomInput = Schemas['ObservationSymptomInput'];
export type ObservationMeasurementKind = Schemas['ObservationMeasurementKind'];
export type ObservationMeasurement = Schemas['ObservationMeasurement'];
export type Observation = Schemas['Observation'];
export type ObservationListResult = Schemas['ObservationListResult'];
export type ObservationPhotoAttachmentRequest = Schemas['ObservationPhotoAttachmentRequest'];
export type ObservationMeasurementInput = Schemas['ObservationMeasurementInput'];
export type RecordObservationRequest = Schemas['RecordObservationRequest'];
export type CorrectObservationRequest = Schemas['CorrectObservationRequest'];
/** The visual-journal frame sequence (P11-MEDIA-01) — a plant's photographs in observed order, not a rendered time-lapse. */
export type PlantJournalFrame = Schemas['PlantJournalFrame'];
export type PlantJournalFrameListResult = Schemas['PlantJournalFrameListResult'];
/** The health-suggestion-disposition schemas (P11-HEALTH-01). */
export type HealthSuggestionSafetyClass = Schemas['HealthSuggestionSafetyClass'];
export type HealthSuggestionDisposition = Schemas['HealthSuggestionDisposition'];
export type SetHealthSuggestionDispositionRequest =
  Schemas['SetHealthSuggestionDispositionRequest'];
