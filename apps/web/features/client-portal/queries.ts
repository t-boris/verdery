'use client';

import type {
  ClientAccessGrant,
  ClientGardenListResult,
  ClientGardenOverview,
  ClientPublicationListResult,
  ClientTimelineResult,
  MediaAccess,
} from '@verdery/api-contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createClientPortalGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hooks for the read-only client-portal domain (P9C-API-01)
 * plus client-invitation acceptance (P9C-INVITE-01) — the same hooks-wrap-
 * gateway shape `features/organizations/queries.ts` and
 * `features/collaboration/queries.ts` already establish, applied to this
 * domain's own gateway.
 *
 * Source: architecture/web-application-design.md, section "8. API Access".
 */

const CLIENT_GARDENS_QUERY_KEY = ['clientGardens'] as const;
const clientGardenOverviewQueryKey = (clientGardenId: string) =>
  ['clientGardens', clientGardenId, 'overview'] as const;
const clientPublicationsQueryKey = (clientGardenId: string) =>
  ['clientGardens', clientGardenId, 'publications'] as const;
const clientTimelineQueryKey = (clientGardenId: string) =>
  ['clientGardens', clientGardenId, 'timeline'] as const;
const clientMediaAccessQueryKey = (publicationId: string, mediaId: string) =>
  ['clientMedia', publicationId, mediaId, 'access'] as const;

function useClientPortalGateway() {
  return useMemo(() => createClientPortalGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

/** `listClientGardens` — every engagement the caller currently holds an active client access grant on. */
export function useClientGardens() {
  const gateway = useClientPortalGateway();

  return useQuery<ClientGardenListResult, ApiFailureError>({
    queryKey: CLIENT_GARDENS_QUERY_KEY,
    queryFn: async ({ signal }) => unwrap(await gateway.listClientGardens(signal)),
  });
}

/** `getClientGardenOverview` — snapshot fields are absent (not an error) when nothing has ever been published. */
export function useClientGardenOverview(clientGardenId: string) {
  const gateway = useClientPortalGateway();

  return useQuery<ClientGardenOverview, ApiFailureError>({
    queryKey: clientGardenOverviewQueryKey(clientGardenId),
    queryFn: async ({ signal }) =>
      unwrap(await gateway.getClientGardenOverview(clientGardenId, signal)),
  });
}

/** `listClientPublications` — every visible publication version, newest first. */
export function useClientPublications(clientGardenId: string) {
  const gateway = useClientPortalGateway();

  return useQuery<ClientPublicationListResult, ApiFailureError>({
    queryKey: clientPublicationsQueryKey(clientGardenId),
    queryFn: async ({ signal }) =>
      unwrap(await gateway.listClientPublications(clientGardenId, signal)),
  });
}

/** `getClientTimeline` — the same visible items flattened into one chronological sequence, oldest first. */
export function useClientTimeline(clientGardenId: string) {
  const gateway = useClientPortalGateway();

  return useQuery<ClientTimelineResult, ApiFailureError>({
    queryKey: clientTimelineQueryKey(clientGardenId),
    queryFn: async ({ signal }) => unwrap(await gateway.getClientTimeline(clientGardenId, signal)),
  });
}

/**
 * `getClientMediaAccess` — a fresh short-lived signed URL, re-authorized on
 * every call (architecture/collaboration-and-client-sharing.md, section
 * "16. Media Access": "State is rechecked before issuing access so
 * revocation and withdrawal do not wait for an old application cache").
 *
 * Unlike the operational `useMediaAccess` (`features/media/queries.ts`),
 * this sets BOTH `staleTime` and `gcTime` to zero: every mount re-issues a
 * fresh authorization check rather than serving a cached verdict, and the
 * result is dropped the instant no component observes it any longer — this
 * is the "do not cache beyond the component's own lifetime" requirement
 * this work package's own instructions state, applied literally.
 */
export function useClientMediaAccess(publicationId: string, mediaId: string) {
  const gateway = useClientPortalGateway();

  return useQuery<MediaAccess, ApiFailureError>({
    queryKey: clientMediaAccessQueryKey(publicationId, mediaId),
    queryFn: async ({ signal }) =>
      unwrap(await gateway.getClientMediaAccess(publicationId, mediaId, signal)),
    staleTime: 0,
    gcTime: 0,
  });
}

/** `acceptClientInvitation` — grants the caller the invitation's client access grant. */
export function useAcceptClientInvitation() {
  const gateway = useClientPortalGateway();

  return useMutation<ClientAccessGrant, ApiFailureError, string>({
    mutationFn: async (token) =>
      unwrap(await gateway.acceptClientInvitation(token, generateIdempotencyKey())),
  });
}
