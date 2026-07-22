import { describe, expect, it } from 'vitest';
import type { GardenCapability, GardenRole } from './garden-role.js';
import { roleHasCapability } from './garden-role.js';

const ROLES: readonly GardenRole[] = ['owner', 'editor', 'viewer'];
const CAPABILITIES: readonly GardenCapability[] = [
  'viewGarden',
  'editGardenContent',
  'manageGarden',
];

/**
 * Full role x capability matrix, matching architecture/identity-and-
 * authorization.md section "8. Garden Roles" and
 * architecture/testing-strategy.md's "every role/capability combination."
 */
const EXPECTED: Readonly<Record<GardenRole, ReadonlySet<GardenCapability>>> = {
  owner: new Set(['viewGarden', 'editGardenContent', 'manageGarden']),
  editor: new Set(['viewGarden', 'editGardenContent']),
  viewer: new Set(['viewGarden']),
};

describe('roleHasCapability', () => {
  for (const role of ROLES) {
    for (const capability of CAPABILITIES) {
      const expected = EXPECTED[role].has(capability);

      it(`${role} ${expected ? 'has' : 'lacks'} ${capability}`, () => {
        expect(roleHasCapability(role, capability)).toBe(expected);
      });
    }
  }
});
