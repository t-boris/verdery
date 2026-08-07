/**
 * The plant-candidate, conversion, suitability, and taxon-profile contract
 * surface (P11-API-01) — split out of `plants.ts` purely for the
 * repository's 600-line source-file rule, the same posture that file's own
 * header documents for its split from `index.ts`.
 */

import type { components } from './generated/schema.js';

type Schemas = components['schemas'];

export type PlantCandidateStatus = Schemas['PlantCandidateStatus'];
export type PlantCandidatePriority = Schemas['PlantCandidatePriority'];
export type CandidatePhotoConditionAnalysis = Schemas['CandidatePhotoConditionAnalysis'];
export type CandidatePhotoAnalysis = Schemas['CandidatePhotoAnalysis'];
export type PlantCandidate = Schemas['PlantCandidate'];
export type PlantCandidateListResult = Schemas['PlantCandidateListResult'];
export type AddCandidateRequest = Schemas['AddCandidateRequest'];
export type AddCandidateFromPhotoRequest = Schemas['AddCandidateFromPhotoRequest'];
export type PlantCandidatePhoto = Schemas['PlantCandidatePhoto'];
export type PlantCandidatePhotoListResult = Schemas['PlantCandidatePhotoListResult'];
export type UpdateCandidateDetailsRequest = Schemas['UpdateCandidateDetailsRequest'];
export type SetCandidateStatusRequest = Schemas['SetCandidateStatusRequest'];
export type ConvertCandidateRequest = Schemas['ConvertCandidateRequest'];
export type CandidateConversion = Schemas['CandidateConversion'];
export type ConvertCandidateResult = Schemas['ConvertCandidateResult'];
export type SuitabilityAxis = Schemas['SuitabilityAxis'];
export type SuitabilityEvidence = Schemas['SuitabilityEvidence'];
export type SuitabilityFinding = Schemas['SuitabilityFinding'];
export type SuitabilityAssessment = Schemas['SuitabilityAssessment'];
export type ResolvedFact = Schemas['ResolvedFact'];
export type PlantProfileVersion = Schemas['PlantProfileVersion'];
/** One licensed reference image; only allowlisted licences ever reach a client. */
export type PlantTaxonImage = Schemas['PlantTaxonImage'];
/** The taxon profile read: the stored projection plus its permitted imagery. */
export type PlantTaxonProfileResult = Schemas['PlantTaxonProfileResult'];
