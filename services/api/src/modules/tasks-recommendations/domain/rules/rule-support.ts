/**
 * Tiny shared helpers for launch rule definitions — target construction
 * and time-unit conversion only. Anything resembling rule CONTENT
 * (thresholds, stage lists, templates) lives in each rule's own file, in
 * its `parameters`, where the horticultural reviewer reads it.
 */

import type { Uuid } from '../../../../shared/identifiers/uuid.js';
import type { RecommendationTarget } from '../recommendation-candidate.js';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** A plant-kind recommendation target, the shape every launch rule addresses. */
export function plantTarget(plantId: Uuid): RecommendationTarget {
  return { kind: 'plant', gardenAreaMapObjectId: null, plantId };
}

/** Whole elapsed days between two instants, floored — a derived fact for explanation text. */
export function wholeDaysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}
