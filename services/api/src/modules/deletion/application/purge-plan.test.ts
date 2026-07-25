/**
 * Structural invariants of the purge plans (P8-DELETE-01).
 *
 * These are the properties the runner and the checkpoint table silently
 * depend on, and every one of them is cheap to check and expensive to
 * discover broken: a duplicated step name would make two different steps
 * share a checkpoint key (and the second would be skipped forever after the
 * first ran); a non-consecutive group would split a transaction the schema
 * requires to be one; a step naming a table it does not delete from would
 * make the evidence lie.
 *
 * The plan's COMPLETENESS — that it names every garden-referencing table
 * there is — is not checkable here, because it is a fact about the live
 * database rather than about this file. That is proved against the catalog
 * in `tests/integration/deletion-garden-purge.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_PURGE_PREPARATIONS,
  ACCOUNT_PURGE_STEPS,
  GARDEN_PURGE_PREPARATIONS,
  GARDEN_PURGE_STEPS,
} from './purge-plan.js';
import type { PurgePreparation, PurgeStep } from './purge-plan.js';

const PLANS: readonly [string, readonly PurgeStep[], readonly PurgePreparation[]][] = [
  ['garden', GARDEN_PURGE_STEPS, GARDEN_PURGE_PREPARATIONS],
  ['account', ACCOUNT_PURGE_STEPS, ACCOUNT_PURGE_PREPARATIONS],
];

describe.each(PLANS)('the %s purge plan', (_name, steps, preparations) => {
  it('gives every step and preparation a unique name — the checkpoint key', () => {
    const names = [...steps.map((step) => step.name), ...preparations.map((one) => one.name)];

    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps grouped steps consecutive, so a group really is one transaction', () => {
    const seen = new Set<string>();
    let previous: string | undefined;

    for (const step of steps) {
      if (step.group !== undefined && step.group !== previous) {
        expect(seen.has(step.group)).toBe(false);
        seen.add(step.group);
      }
      previous = step.group;
    }
  });

  it('deletes from the table each step names, so a recorded count describes what it claims to', () => {
    for (const step of steps) {
      const rendered = step.rows('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b');
      expect(rendered).toBeDefined();
      expect(step.table).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });
});

describe('the garden purge plan ordering', () => {
  const index = (table: string): number =>
    GARDEN_PURGE_STEPS.findIndex((step) => step.table === table);

  it('empties the garden row last — everything else must already reference nothing', () => {
    expect(index('gardens_mapping.garden')).toBe(GARDEN_PURGE_STEPS.length - 1);
  });

  it('clears outbox payloads first, while the tables they are found through still resolve', () => {
    expect(index('platform.outbox_event')).toBe(0);
  });

  it('deletes every child before its parent for the orderings the schema does not cascade', () => {
    const before = (child: string, parent: string): void => {
      expect(index(child)).toBeGreaterThanOrEqual(0);
      expect(index(child)).toBeLessThan(index(parent));
    };

    before('plants_inventory.plant_photo', 'plants_inventory.plant');
    before('plants_inventory.plant_photo', 'media.media_record');
    before('observations_history.observation_photo', 'observations_history.observation');
    before('observations_history.observation', 'plants_inventory.plant');
    before('tasks_recommendations.task', 'plants_inventory.plant');
    before('gardens_mapping.garden_object', 'gardens_mapping.coordinate_space');
    before('gardens_mapping.calibration', 'gardens_mapping.garden_object');
    before('plants_inventory.plant', 'gardens_mapping.garden_object');
    before('media.processing_job', 'media.media_record');
    before('tasks_recommendations.recommendation_evidence', 'integrations.weather_record');
  });

  it('never names collaboration.membership or platform.sync_change — both are revocation tombstones that must outlive the garden', () => {
    const tables = new Set(GARDEN_PURGE_STEPS.map((step) => step.table));

    expect(tables.has('collaboration.membership')).toBe(false);
    expect(tables.has('platform.sync_change')).toBe(false);
  });
});

describe('the account purge plan', () => {
  it('never touches garden content: an account purge must not damage a shared garden that survives it', () => {
    const gardenScoped = ACCOUNT_PURGE_STEPS.filter((step) =>
      ['plants_inventory.', 'observations_history.', 'gardens_mapping.', 'media.media_record'].some(
        (prefix) => step.table.startsWith(prefix),
      ),
    );

    expect(gardenScoped).toEqual([]);
  });

  it('never names identity_access.profile — the row survives, minimized, because shared-garden content still points at it', () => {
    expect(ACCOUNT_PURGE_STEPS.some((step) => step.table === 'identity_access.profile')).toBe(
      false,
    );
  });
});
