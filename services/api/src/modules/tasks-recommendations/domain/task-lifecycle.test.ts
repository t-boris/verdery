import { describe, expect, it } from 'vitest';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { Task } from './task.js';
import { requireEditableStatus, transitionTaskToTerminalStatus } from './task-lifecycle.js';

const NOW = new Date('2026-07-21T12:00:00Z');

function plannedTask(overrides: Partial<Task> = {}): Task {
  return {
    id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
    gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c',
    targetKind: 'garden',
    targetGardenAreaMapObjectId: null,
    targetPlantId: null,
    title: 'Water the tomatoes',
    notes: null,
    status: 'planned',
    dueDate: null,
    timeWindowStart: null,
    timeWindowEnd: null,
    recurrenceRule: null,
    urgency: 'normal',
    source: 'manual',
    originObservationId: null,
    revision: 1,
    createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    completedAt: null,
    ...overrides,
  };
}

describe('requireEditableStatus', () => {
  it('accepts planned and suggested', () => {
    expect(() => requireEditableStatus(plannedTask({ status: 'planned' }))).not.toThrow();
    expect(() => requireEditableStatus(plannedTask({ status: 'suggested' }))).not.toThrow();
  });

  it('rejects every terminal status', () => {
    for (const status of ['completed', 'skipped', 'dismissed', 'deleted'] as const) {
      expect(() => requireEditableStatus(plannedTask({ status }))).toThrow(DomainRuleViolatedError);
    }
  });
});

describe('transitionTaskToTerminalStatus', () => {
  it('completes a planned task, setting completedAt and bumping the revision', () => {
    const result = transitionTaskToTerminalStatus(plannedTask(), 'completed', NOW);
    expect(result.status).toBe('completed');
    expect(result.completedAt).toBe(NOW);
    expect(result.revision).toBe(2);
    expect(result.updatedAt).toBe(NOW);
  });

  it('dismisses, skips, and deletes a planned task without touching completedAt', () => {
    for (const target of ['dismissed', 'skipped', 'deleted'] as const) {
      const result = transitionTaskToTerminalStatus(plannedTask(), target, NOW);
      expect(result.status).toBe(target);
      expect(result.completedAt).toBeNull();
    }
  });

  it('rejects transitioning a task that is already terminal', () => {
    const completed = plannedTask({ status: 'completed', completedAt: NOW });
    expect(() => transitionTaskToTerminalStatus(completed, 'dismissed', NOW)).toThrow(
      DomainRuleViolatedError,
    );
  });

  it('rejects completing a task twice', () => {
    const completed = plannedTask({ status: 'completed', completedAt: NOW });
    expect(() => transitionTaskToTerminalStatus(completed, 'completed', NOW)).toThrow(
      DomainRuleViolatedError,
    );
  });

  it('accepts a transition from suggested', () => {
    const suggested = plannedTask({ status: 'suggested' });
    const result = transitionTaskToTerminalStatus(suggested, 'skipped', NOW);
    expect(result.status).toBe('skipped');
  });
});
