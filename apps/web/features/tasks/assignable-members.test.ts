import type { GardenMemberListResult } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { selectAssignableMembers } from './assignable-members';

const MEMBERS: GardenMemberListResult = {
  items: [
    {
      id: 'member-1',
      gardenId: 'garden-1',
      profileId: 'profile-owner',
      role: 'owner',
      state: 'active',
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
    },
    {
      id: 'member-2',
      gardenId: 'garden-1',
      profileId: 'profile-editor',
      role: 'editor',
      state: 'active',
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
    },
    {
      id: 'member-3',
      gardenId: 'garden-1',
      profileId: 'profile-viewer',
      role: 'viewer',
      state: 'active',
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
    },
  ],
};

describe('selectAssignableMembers', () => {
  it('keeps owner and editor members, matching AssignTask.execute’s editGardenContent gate', () => {
    expect(selectAssignableMembers(MEMBERS).map((member) => member.profileId)).toEqual([
      'profile-owner',
      'profile-editor',
    ]);
  });

  it('excludes a viewer, who cannot hold an assignment', () => {
    expect(selectAssignableMembers(MEMBERS).some((member) => member.role === 'viewer')).toBe(false);
  });

  it('returns an empty list for a garden with no eligible members', () => {
    expect(selectAssignableMembers({ items: [] })).toEqual([]);
  });
});
