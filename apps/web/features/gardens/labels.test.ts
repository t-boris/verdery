import type { Garden, GardenRole } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { lifecycleLabel, roleLabel } from './labels';

describe('lifecycleLabel', () => {
  it.each<[Garden['lifecycleState'], string]>([
    ['active', 'gardens.lifecycleActive'],
    ['archived', 'gardens.lifecycleArchived'],
    ['deletionRequested', 'gardens.lifecycleDeletionRequested'],
  ])('maps %s to %s', (state, key) => {
    expect(lifecycleLabel(state)).toBe(key);
  });
});

describe('roleLabel', () => {
  it.each<[GardenRole, string]>([
    ['owner', 'gardens.roleOwner'],
    ['editor', 'gardens.roleEditor'],
    ['viewer', 'gardens.roleViewer'],
  ])('maps %s to %s', (role, key) => {
    expect(roleLabel(role)).toBe(key);
  });
});
