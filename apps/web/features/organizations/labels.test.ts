import type {
  ClientEngagementState,
  GardenAssignmentRole,
  GardenAssignmentState,
  OrganizationRole,
} from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  assignmentRoleLabel,
  assignmentStateLabel,
  assignmentStateTone,
  engagementStateLabel,
  engagementStateTone,
  organizationRoleLabel,
} from './labels';

describe('organizationRoleLabel', () => {
  it.each<[OrganizationRole, string]>([
    ['organizationAdmin', 'organizations.roleAdmin'],
    ['professional', 'organizations.roleProfessional'],
  ])('maps %s to %s', (role, key) => {
    expect(organizationRoleLabel(role)).toBe(key);
  });
});

describe('assignmentRoleLabel', () => {
  it.each<[GardenAssignmentRole, string]>([
    ['editor', 'gardens.roleEditor'],
    ['viewer', 'gardens.roleViewer'],
  ])('maps %s to %s, reusing the garden role vocabulary', (role, key) => {
    expect(assignmentRoleLabel(role)).toBe(key);
  });
});

describe('assignmentStateLabel / assignmentStateTone', () => {
  it.each<[GardenAssignmentState, string, string]>([
    ['active', 'assignments.state.active', 'positive'],
    ['ended', 'assignments.state.ended', 'neutral'],
    ['revoked', 'assignments.state.revoked', 'neutral'],
  ])('maps %s to %s / %s', (state, key, tone) => {
    expect(assignmentStateLabel(state)).toBe(key);
    expect(assignmentStateTone(state)).toBe(tone);
  });
});

describe('engagementStateLabel / engagementStateTone', () => {
  it.each<[ClientEngagementState, string, string]>([
    ['draft', 'engagements.state.draft', 'neutral'],
    ['active', 'engagements.state.active', 'positive'],
    ['ended', 'engagements.state.ended', 'neutral'],
    ['revoked', 'engagements.state.revoked', 'neutral'],
  ])('maps %s to %s / %s', (state, key, tone) => {
    expect(engagementStateLabel(state)).toBe(key);
    expect(engagementStateTone(state)).toBe(tone);
  });
});
