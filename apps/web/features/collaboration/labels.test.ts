import type { GardenRole, InvitationIntendedRole, InvitationState } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { intendedRoleLabel, invitationStateLabel, invitationStateTone, roleLabel } from './labels';

describe('roleLabel', () => {
  it.each<[GardenRole, string]>([
    ['owner', 'gardens.roleOwner'],
    ['editor', 'gardens.roleEditor'],
    ['viewer', 'gardens.roleViewer'],
  ])('maps %s to %s', (role, key) => {
    expect(roleLabel(role)).toBe(key);
  });
});

describe('intendedRoleLabel', () => {
  it.each<[InvitationIntendedRole, string]>([
    ['editor', 'gardens.roleEditor'],
    ['viewer', 'gardens.roleViewer'],
  ])('maps %s to %s', (role, key) => {
    expect(intendedRoleLabel(role)).toBe(key);
  });
});

describe('invitationStateLabel', () => {
  it.each<[InvitationState, string]>([
    ['pending', 'invitations.state.pending'],
    ['accepted', 'invitations.state.accepted'],
    ['revoked', 'invitations.state.revoked'],
    ['expired', 'invitations.state.expired'],
  ])('maps %s to %s', (state, key) => {
    expect(invitationStateLabel(state)).toBe(key);
  });
});

describe('invitationStateTone', () => {
  it.each<[InvitationState, string]>([
    ['pending', 'neutral'],
    ['accepted', 'positive'],
    ['revoked', 'negative'],
    ['expired', 'negative'],
  ])('maps %s to %s', (state, tone) => {
    expect(invitationStateTone(state)).toBe(tone);
  });
});
