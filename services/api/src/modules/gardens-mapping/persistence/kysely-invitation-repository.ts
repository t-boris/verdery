import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { InvitationRepository } from '../application/invitation-repository.js';
import type { Invitation, InvitationRole, InvitationState } from '../domain/invitation.js';

interface InvitationRowShape {
  id: string;
  garden_id: string;
  inviter_profile_id: string;
  intended_role: string;
  intended_email: string | null;
  token_hash: string;
  state: string;
  accepted_by_profile_id: string | null;
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  resulting_membership_id: string | null;
}

function toInvitation(row: InvitationRowShape): Invitation {
  return {
    id: row.id,
    gardenId: row.garden_id,
    inviterProfileId: row.inviter_profile_id,
    intendedRole: row.intended_role as InvitationRole,
    intendedEmail: row.intended_email,
    tokenHash: row.token_hash,
    state: row.state as InvitationState,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    acceptedByProfileId: row.accepted_by_profile_id,
    resultingMembershipId: row.resulting_membership_id,
  };
}

export class KyselyInvitationRepository implements InvitationRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(invitation: Invitation): Promise<void> {
    await this.db
      .insertInto('collaboration.invitation')
      .values({
        id: invitation.id,
        garden_id: invitation.gardenId,
        inviter_profile_id: invitation.inviterProfileId,
        intended_role: invitation.intendedRole,
        intended_email: invitation.intendedEmail,
        token_hash: invitation.tokenHash,
        state: invitation.state,
        accepted_by_profile_id: invitation.acceptedByProfileId,
        created_at: invitation.createdAt,
        expires_at: invitation.expiresAt,
        accepted_at: invitation.acceptedAt,
        revoked_at: invitation.revokedAt,
        resulting_membership_id: invitation.resultingMembershipId,
      })
      .execute();
  }

  async findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const row = await this.db
      .selectFrom('collaboration.invitation')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();

    return row === undefined ? null : toInvitation(row);
  }

  async findByIdAndGarden(id: Uuid, gardenId: Uuid): Promise<Invitation | null> {
    const row = await this.db
      .selectFrom('collaboration.invitation')
      .selectAll()
      .where('id', '=', id)
      .where('garden_id', '=', gardenId)
      .executeTakeFirst();

    return row === undefined ? null : toInvitation(row);
  }

  async listByGarden(gardenId: Uuid): Promise<readonly Invitation[]> {
    const rows = await this.db
      .selectFrom('collaboration.invitation')
      .selectAll()
      .where('garden_id', '=', gardenId)
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map(toInvitation);
  }

  async hasPendingForEmail(gardenId: Uuid, intendedEmail: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('collaboration.invitation')
      .select('id')
      .where('garden_id', '=', gardenId)
      .where('intended_email', '=', intendedEmail)
      .where('state', '=', 'pending')
      .executeTakeFirst();

    return row !== undefined;
  }

  async update(invitation: Invitation): Promise<void> {
    await this.db
      .updateTable('collaboration.invitation')
      .set({
        state: invitation.state,
        accepted_by_profile_id: invitation.acceptedByProfileId,
        accepted_at: invitation.acceptedAt,
        revoked_at: invitation.revokedAt,
        resulting_membership_id: invitation.resultingMembershipId,
      })
      .where('id', '=', invitation.id)
      .execute();
  }

  async expireDuePending(now: Date, limit: number): Promise<number> {
    const rows = await this.db
      .updateTable('collaboration.invitation')
      .set({ state: 'expired' })
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('collaboration.invitation')
          .select('id')
          .where('state', '=', 'pending')
          .where('expires_at', '<=', now)
          .orderBy('id')
          .limit(limit)
          .forUpdate()
          .skipLocked(),
      )
      .executeTakeFirst();

    return Number(rows.numUpdatedRows);
  }
}
