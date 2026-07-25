import type {
  RecommendationEvidenceKind,
  RecommendationPriorityFactorKind,
  TaskTargetKind,
  TaskUrgency,
} from '@verdery/api-contracts';

import type { MessageKey } from '@/shared/localization/public';

/**
 * Message-key mapping for the recommendation enums.
 *
 * `urgencyLabel` and `targetKindLabel` reuse the `tasks.enum.*` message keys
 * verbatim: the contract deliberately shares `TaskUrgency`/`TaskTargetKind`
 * between tasks and recommendations (one P0-PROD-03 glossary — see the
 * `Recommendations` section comment in `openapi.yaml`), so the two features
 * must speak the same words too. The switches are duplicated rather than
 * imported from `features/tasks` because features expose components and
 * hooks, not internals, to each other.
 *
 * Source: packages/api-contracts/openapi.yaml, schemas
 * `RecommendationEvidenceKind`, `RecommendationPriorityFactorKind`.
 */

export function urgencyLabel(urgency: TaskUrgency): MessageKey {
  switch (urgency) {
    case 'low':
      return 'tasks.enum.urgency.low';
    case 'normal':
      return 'tasks.enum.urgency.normal';
    case 'high':
      return 'tasks.enum.urgency.high';
    case 'urgent':
      return 'tasks.enum.urgency.urgent';
  }
}

export function targetKindLabel(kind: TaskTargetKind): MessageKey {
  switch (kind) {
    case 'garden':
      return 'tasks.enum.targetKind.garden';
    case 'garden_area':
      return 'tasks.enum.targetKind.gardenArea';
    case 'plant':
      return 'tasks.enum.targetKind.plant';
  }
}

export function evidenceKindLabel(kind: RecommendationEvidenceKind): MessageKey {
  switch (kind) {
    case 'plant_identity':
      return 'today.enum.evidence.plantIdentity';
    case 'garden_context':
      return 'today.enum.evidence.gardenContext';
    case 'weather':
      return 'today.enum.evidence.weather';
    case 'soil_moisture':
      return 'today.enum.evidence.soilMoisture';
    case 'observation':
      return 'today.enum.evidence.observation';
    case 'task':
      return 'today.enum.evidence.task';
    case 'lifecycle_stage':
      return 'today.enum.evidence.lifecycleStage';
    case 'geometry_exposure':
      return 'today.enum.evidence.geometryExposure';
    case 'user_preference':
      return 'today.enum.evidence.userPreference';
  }
}

export function priorityFactorKindLabel(kind: RecommendationPriorityFactorKind): MessageKey {
  switch (kind) {
    case 'urgency_window':
      return 'today.enum.factor.urgencyWindow';
    case 'plant_impact':
      return 'today.enum.factor.plantImpact';
    case 'confidence':
      return 'today.enum.factor.confidence';
    case 'weather_opportunity_or_risk':
      return 'today.enum.factor.weatherOpportunityOrRisk';
    case 'user_effort_and_availability':
      return 'today.enum.factor.userEffortAndAvailability';
    case 'task_overlap':
      return 'today.enum.factor.taskOverlap';
    case 'safety_constraint':
      return 'today.enum.factor.safetyConstraint';
    case 'seasonal_constraint':
      return 'today.enum.factor.seasonalConstraint';
  }
}
