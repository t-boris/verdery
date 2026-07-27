import type { Uuid } from '../../../shared/identifiers/uuid.js';

/** Mirrors `collaboration.client_update_item.kind`'s two admitted values — see the migration's own "SCOPE: WORK-LOG AND MEDIA REFERENCES ONLY" comment for why the other two `publication_item` kinds are not staged here. */
export type ClientUpdateItemKind = 'work_log' | 'media';

/** Mirrors `collaboration.publication_media_detail.media_role`/`collaboration.client_update_item.media_role`. */
export type PublicationMediaRole = 'before' | 'after' | 'general';

/** Mirrors `collaboration.client_update_item` exactly, kind-discriminated fields included. */
export interface ClientUpdateItemDetail {
  readonly id: Uuid;
  readonly clientUpdateId: Uuid;
  readonly kind: ClientUpdateItemKind;
  readonly occurredAt: Date;
  readonly sourceWorkLogId: Uuid | null;
  readonly description: string | null;
  readonly mediaRecordId: Uuid | null;
  readonly mediaRole: PublicationMediaRole | null;
  readonly caption: string | null;
  readonly createdAt: Date;
}

export type ClientUpdateItemInsertInput =
  | {
      readonly id: Uuid;
      readonly clientUpdateId: Uuid;
      readonly kind: 'work_log';
      readonly occurredAt: Date;
      readonly sourceWorkLogId: Uuid;
      readonly description: string;
      readonly now: Date;
    }
  | {
      readonly id: Uuid;
      readonly clientUpdateId: Uuid;
      readonly kind: 'media';
      readonly occurredAt: Date;
      readonly mediaRecordId: Uuid;
      readonly mediaRole: PublicationMediaRole;
      readonly caption: string | null;
      readonly now: Date;
    };

export interface ClientUpdateItemRepository {
  /** Throws a unique-violation on `client_update_item_work_log_key`/`client_update_item_media_key` if the same source is already staged on this draft — see `AddClientUpdateItem`'s own pre-check-plus-catch handling. */
  insert(input: ClientUpdateItemInsertInput): Promise<void>;

  /** One staged item by id, scoped to `clientUpdateId` — the same cross-tenant concealment every other scoped lookup in this module provides. */
  findByIdAndClientUpdate(id: Uuid, clientUpdateId: Uuid): Promise<ClientUpdateItemDetail | null>;

  remove(id: Uuid): Promise<void>;

  /** Every item currently staged on one draft, oldest first — the order a publisher added them, and the set `PublishClientUpdate` snapshots at publish time. */
  listForClientUpdate(clientUpdateId: Uuid): Promise<readonly ClientUpdateItemDetail[]>;
}
