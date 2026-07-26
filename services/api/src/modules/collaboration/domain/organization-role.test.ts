import { describe, expect, it } from 'vitest';
import { ORGANIZATION_CAPABILITIES, organizationRoleHasCapability } from './organization-role.js';

describe('organizationRoleHasCapability', () => {
  it('grants an organization admin every modeled capability', () => {
    for (const capability of ORGANIZATION_CAPABILITIES) {
      expect(organizationRoleHasCapability('organization_admin', capability)).toBe(true);
    }
  });

  it('grants a professional no organization-level capability at all — membership alone grants nothing', () => {
    for (const capability of ORGANIZATION_CAPABILITIES) {
      expect(organizationRoleHasCapability('professional', capability)).toBe(false);
    }
  });
});
