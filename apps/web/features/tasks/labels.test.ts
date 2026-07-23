import type { TaskStatus, TaskTargetKind, TaskUrgency } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  isTaskMutable,
  targetKindLabel,
  taskStatusLabel,
  taskStatusTone,
  urgencyLabel,
} from './labels';

describe('targetKindLabel', () => {
  it.each<[TaskTargetKind, string]>([
    ['garden', 'tasks.enum.targetKind.garden'],
    ['garden_area', 'tasks.enum.targetKind.gardenArea'],
    ['plant', 'tasks.enum.targetKind.plant'],
  ])('maps %s to %s', (kind, key) => {
    expect(targetKindLabel(kind)).toBe(key);
  });
});

describe('taskStatusLabel', () => {
  it.each<[TaskStatus, string]>([
    ['planned', 'tasks.enum.status.planned'],
    ['suggested', 'tasks.enum.status.suggested'],
    ['completed', 'tasks.enum.status.completed'],
    ['skipped', 'tasks.enum.status.skipped'],
    ['dismissed', 'tasks.enum.status.dismissed'],
    ['deleted', 'tasks.enum.status.deleted'],
  ])('maps %s to %s', (status, key) => {
    expect(taskStatusLabel(status)).toBe(key);
  });
});

describe('taskStatusTone', () => {
  it.each<[TaskStatus, string]>([
    ['planned', 'neutral'],
    ['suggested', 'neutral'],
    ['completed', 'positive'],
    ['skipped', 'negative'],
    ['dismissed', 'negative'],
    ['deleted', 'negative'],
  ])('maps %s to %s', (status, tone) => {
    expect(taskStatusTone(status)).toBe(tone);
  });
});

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

describe('isTaskMutable', () => {
  it.each<[TaskStatus, boolean]>([
    ['planned', true],
    ['suggested', true],
    ['completed', false],
    ['skipped', false],
    ['dismissed', false],
    ['deleted', false],
  ])('returns %s for %s', (status, expected) => {
    expect(isTaskMutable(status)).toBe(expected);
  });
});
