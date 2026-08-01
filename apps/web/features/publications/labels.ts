import type {
  ClientUpdateItemKind,
  ClientUpdateState,
  PublicationMediaRole,
  PublisherGrantState,
} from '@verdery/api-contracts';

import type { MessageKey } from '@/shared/localization/public';
import type { StatusTone } from '@/shared/ui/public';

/**
 * Message-key and presentation mapping for the client-publication domain
 * enums (P9C-PUBLISH-01).
 *
 * Source: packages/api-contracts/openapi.yaml, schemas `ClientUpdateState`,
 * `ClientUpdateItemKind`, `PublicationMediaRole`, `PublisherGrantState`.
 */

export const CLIENT_UPDATE_ITEM_KINDS: readonly ClientUpdateItemKind[] = [
  'work_log',
  'media',
  'observation',
];

export const PUBLICATION_MEDIA_ROLES: readonly PublicationMediaRole[] = [
  'before',
  'after',
  'general',
];

export function clientUpdateStateLabel(state: ClientUpdateState): MessageKey {
  switch (state) {
    case 'internal_draft':
      return 'publications.state.internal_draft';
    case 'ready_for_client':
      return 'publications.state.ready_for_client';
    case 'published':
      return 'publications.state.published';
    case 'withdrawn':
      return 'publications.state.withdrawn';
  }
}

/** `published` reads as positive, `ready_for_client` as a neutral in-progress step, `internal_draft` as neutral, `withdrawn` as negative — the terminal, no-longer-visible state. */
export function clientUpdateStateTone(state: ClientUpdateState): StatusTone {
  switch (state) {
    case 'published':
      return 'positive';
    case 'internal_draft':
    case 'ready_for_client':
      return 'neutral';
    case 'withdrawn':
      return 'negative';
  }
}

export function clientUpdateItemKindLabel(kind: ClientUpdateItemKind): MessageKey {
  switch (kind) {
    case 'work_log':
      return 'publications.itemKind.work_log';
    case 'media':
      return 'publications.itemKind.media';
    case 'observation':
      return 'publications.itemKind.observation';
  }
}

export function publicationMediaRoleLabel(role: PublicationMediaRole): MessageKey {
  switch (role) {
    case 'before':
      return 'publications.mediaRole.before';
    case 'after':
      return 'publications.mediaRole.after';
    case 'general':
      return 'publications.mediaRole.general';
  }
}

export function publisherGrantStateLabel(state: PublisherGrantState): MessageKey {
  switch (state) {
    case 'active':
      return 'publications.accessState.active';
    case 'revoked':
      return 'publications.accessState.revoked';
  }
}

export function publisherGrantStateTone(state: PublisherGrantState): StatusTone {
  switch (state) {
    case 'active':
      return 'positive';
    case 'revoked':
      return 'neutral';
  }
}
