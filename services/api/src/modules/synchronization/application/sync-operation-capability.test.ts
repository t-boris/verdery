import { describe, expect, it } from 'vitest';
import { roleHasCapability } from '../../gardens-mapping/public.js';
import { requiredPushCapability } from './sync-operation-capability.js';

const GARDEN_ID = '11111111-1111-7111-8111-111111111111';

function gardenPayload(
  commandType: 'gardens.create' | 'gardens.rename' | 'gardens.archive' | 'gardens.delete_request',
) {
  return {
    recordType: 'garden' as const,
    gardenId: GARDEN_ID,
    command: { commandType } as never,
  };
}

function gardenObjectPayload() {
  return {
    recordType: 'gardenObject' as const,
    gardenId: GARDEN_ID,
    command: { type: 'createObject' } as never,
  };
}

function plantPayload() {
  return {
    recordType: 'plant' as const,
    gardenId: GARDEN_ID,
    command: { commandType: 'plants.addPlant' } as never,
  };
}

function observationPayload() {
  return {
    recordType: 'observation' as const,
    gardenId: GARDEN_ID,
    command: { commandType: 'observations.record' } as never,
  };
}

function taskPayload() {
  return {
    recordType: 'task' as const,
    gardenId: GARDEN_ID,
    command: { commandType: 'tasks.createManualTask' } as never,
  };
}

describe('requiredPushCapability (G-8 boundary declaration)', () => {
  it('declares no boundary check for gardens.create — no membership exists yet to check', () => {
    expect(requiredPushCapability(gardenPayload('gardens.create'))).toBeNull();
  });

  it.each(['gardens.rename', 'gardens.archive', 'gardens.delete_request'] as const)(
    'declares manageGarden for %s',
    (commandType) => {
      expect(requiredPushCapability(gardenPayload(commandType))).toBe('manageGarden');
    },
  );

  it('declares editGardenContent for the gardenObject family', () => {
    expect(requiredPushCapability(gardenObjectPayload())).toBe('editGardenContent');
  });

  it('declares editGardenContent for the plant family', () => {
    expect(requiredPushCapability(plantPayload())).toBe('editGardenContent');
  });

  it('declares editGardenContent for the observation family', () => {
    expect(requiredPushCapability(observationPayload())).toBe('editGardenContent');
  });

  it('declares editGardenContent for the task family', () => {
    expect(requiredPushCapability(taskPayload())).toBe('editGardenContent');
  });

  it('a viewer holds neither declared mutation capability — the boundary check would reject every family but gardens.create', () => {
    expect(roleHasCapability('viewer', 'manageGarden')).toBe(false);
    expect(roleHasCapability('viewer', 'editGardenContent')).toBe(false);
  });

  it('an editor holds editGardenContent but not manageGarden — the content families pass, the garden-admin family does not', () => {
    expect(roleHasCapability('editor', 'editGardenContent')).toBe(true);
    expect(roleHasCapability('editor', 'manageGarden')).toBe(false);
  });
});
