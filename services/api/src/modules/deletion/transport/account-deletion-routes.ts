/**
 * Account-deletion HTTP routes (P8-DELETE-01) — hand-written request
 * validation against `openapi.yaml`'s `Account` tag, matching every other
 * transport layer in this codebase.
 *
 * REGISTERED IN THEIR OWN ENCAPSULATION CONTEXT, with authentication
 * configured to admit a `deletion_requested` account. That is not a
 * loophole — it is the requirement: architecture/data-export-and-deletion.md
 * section 11 says ordinary access is disabled during the window AND that the
 * user may recover, which is impossible if every route refuses them. The
 * authentication plugin anticipated exactly this ("A future endpoint that
 * must remain reachable for a non-active account (account recovery, for
 * example) ... can opt out of this plugin's context when it exists").
 *
 * The admission is narrow in both directions: only `deletion_requested` is
 * added (never `suspended`, `disabled`, or `purged` — a claimed purge and a
 * suspension are not the user's to undo), and only these three routes live
 * here. `requestAccountDeletion` refuses anything but an `active` account in
 * its own domain transition, so nothing here can start a second deletion.
 *
 * One structured log line per command, ids and counts only.
 */

import type { AccountDeletion } from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER, SharedErrorCode } from '@verdery/api-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { UUID_PATTERN } from '../../gardens-mapping/public.js';
import type { GetAccountDeletion } from '../application/get-account-deletion.js';
import type { RequestAccountDeletion } from '../application/request-account-deletion.js';
import type { RestoreAccountDeletion } from '../application/restore-account-deletion.js';

export interface AccountDeletionRoutesDependencies {
  readonly requestAccountDeletion: RequestAccountDeletion;
  readonly restoreAccountDeletion: RestoreAccountDeletion;
  readonly getAccountDeletion: GetAccountDeletion;
}

function requireIdempotencyKey(request: FastifyRequest): string {
  const header = request.headers[IDEMPOTENCY_KEY_HEADER];
  const key = Array.isArray(header) ? header[0] : header;

  if (typeof key !== 'string' || !UUID_PATTERN.test(key)) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      `${IDEMPOTENCY_KEY_HEADER} header must be a UUID.`,
      {
        details: [
          {
            code: 'request.idempotency_key.invalid',
            pointer: `/headers/${IDEMPOTENCY_KEY_HEADER}`,
          },
        ],
      },
    );
  }

  return key;
}

export function registerAccountDeletionRoutes(
  app: FastifyInstance,
  dependencies: AccountDeletionRoutesDependencies,
): void {
  app.post('/account/deletion', async (request, reply) => {
    const idempotencyKey = requireIdempotencyKey(request);

    const resource: AccountDeletion = await dependencies.requestAccountDeletion.execute(
      request.actorContext,
      idempotencyKey,
    );

    request.log.info(
      {
        event: 'account.deletion_requested',
        recoveryDeadlineAt: resource.recoveryDeadlineAt,
        gardenCount: resource.gardens.length,
      },
      'Account deletion requested',
    );

    return reply.status(200).send(resource);
  });

  app.get('/account/deletion', async (request, reply) => {
    const resource: AccountDeletion = await dependencies.getAccountDeletion.execute(
      request.actorContext.profileId,
    );

    return reply.status(200).send(resource);
  });

  app.delete('/account/deletion', async (request, reply) => {
    const idempotencyKey = requireIdempotencyKey(request);

    await dependencies.restoreAccountDeletion.execute(request.actorContext, idempotencyKey);

    request.log.info({ event: 'account.deletion_withdrawn' }, 'Account deletion withdrawn');

    return reply.status(204).send();
  });
}
