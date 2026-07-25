import type {
  RecommendationEvidenceKind,
  RecommendationPriorityFactorKind,
  TaskTargetKind,
  TaskUrgency,
} from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  evidenceKindLabel,
  priorityFactorKindLabel,
  targetKindLabel,
  urgencyLabel,
} from './labels';

describe('urgencyLabel', () => {
  it.each<[TaskUrgency, string]>([
    ['low', 'tasks.enum.urgency.low'],
    ['normal', 'tasks.enum.urgency.normal'],
    ['high', 'tasks.enum.urgency.high'],
    ['urgent', 'tasks.enum.urgency.urgent'],
  ])('maps %s to %s', (urgency, key) => {
    expect(urgencyLabel(urgency)).toBe(key);
  });
});

describe('targetKindLabel', () => {
  it.each<[TaskTargetKind, string]>([
    ['garden', 'tasks.enum.targetKind.garden'],
    ['garden_area', 'tasks.enum.targetKind.gardenArea'],
    ['plant', 'tasks.enum.targetKind.plant'],
  ])('maps %s to %s', (kind, key) => {
    expect(targetKindLabel(kind)).toBe(key);
  });
});

describe('evidenceKindLabel', () => {
  it.each<[RecommendationEvidenceKind, string]>([
    ['plant_identity', 'today.enum.evidence.plantIdentity'],
    ['garden_context', 'today.enum.evidence.gardenContext'],
    ['weather', 'today.enum.evidence.weather'],
    ['soil_moisture', 'today.enum.evidence.soilMoisture'],
    ['observation', 'today.enum.evidence.observation'],
    ['task', 'today.enum.evidence.task'],
    ['lifecycle_stage', 'today.enum.evidence.lifecycleStage'],
    ['geometry_exposure', 'today.enum.evidence.geometryExposure'],
    ['user_preference', 'today.enum.evidence.userPreference'],
  ])('maps %s to %s', (kind, key) => {
    expect(evidenceKindLabel(kind)).toBe(key);
  });
});

describe('priorityFactorKindLabel', () => {
  it.each<[RecommendationPriorityFactorKind, string]>([
    ['urgency_window', 'today.enum.factor.urgencyWindow'],
    ['plant_impact', 'today.enum.factor.plantImpact'],
    ['confidence', 'today.enum.factor.confidence'],
    ['weather_opportunity_or_risk', 'today.enum.factor.weatherOpportunityOrRisk'],
    ['user_effort_and_availability', 'today.enum.factor.userEffortAndAvailability'],
    ['task_overlap', 'today.enum.factor.taskOverlap'],
    ['safety_constraint', 'today.enum.factor.safetyConstraint'],
    ['seasonal_constraint', 'today.enum.factor.seasonalConstraint'],
  ])('maps %s to %s', (kind, key) => {
    expect(priorityFactorKindLabel(kind)).toBe(key);
  });
});
