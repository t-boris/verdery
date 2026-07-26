'use client';

import type { GardenMember, GardenMemberListResult } from '@verdery/api-contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createCollaborationGateway,
  isFailure,
} from '@/core/api/public';

/**
 * Read-only lookup of a garden's `editGardenContent`-holding active
 * members — the only legal `assignTask` targets (P9A-TASK-01;
 * `services/api/src/modules/tasks-recommendations/application/assign-task.ts`
 * requires the assignee to independently hold `editGardenContent`, i.e. be
 * an active `owner` or `editor`; a `viewer` is rejected as an invalid
 * parameter).
 *
 * Built on `core/api/collaboration-gateway.ts`'s `listMembers` — the same
 * shared, tested gateway the concurrent collaboration-administration work
 * (invitations, the full member table, ownership transfer, under
 * `features/gardens/`) uses for the identical endpoint. This module only
 * adds the `TaskAssignForm`-specific filtering (`selectAssignableMembers`)
 * and query wiring; it is not a parallel member-management feature, and
 * does not reach into `features/gardens/` internals — `features/gardens/
 * public.ts` did not yet expose an equivalent hook at the time this was
 * written, so `TaskAssignForm` gets its own narrowly-scoped one here.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listGardenMembers`.
 */

function assignableMembersQueryKey(gardenId: string) {
  return ['tasks', gardenId, 'assignableMembers'] as const;
}

/** Pure filter, tested directly: only an active owner or editor may be assigned a task. */
export function selectAssignableMembers(result: GardenMemberListResult): GardenMember[] {
  return result.items.filter((member) => member.role === 'owner' || member.role === 'editor');
}

export function useAssignableMembers(gardenId: string) {
  const gateway = useMemo(() => createCollaborationGateway(createBrowserApiClient()), []);

  return useQuery<GardenMember[], ApiFailureError>({
    queryKey: assignableMembersQueryKey(gardenId),
    queryFn: async ({ signal }) => {
      const result = await gateway.listMembers(gardenId, signal);
      if (isFailure(result)) {
        throw new ApiFailureError(result);
      }
      return selectAssignableMembers(result.data);
    },
  });
}
