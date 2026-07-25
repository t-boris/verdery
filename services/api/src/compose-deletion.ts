/**
 * Composition-root helper for the deletion module's P8-DELETE-01 surface:
 * the account-deletion command/status routes and the internal sweep endpoint
 * that executes both halves of the purge. Split out of `app.ts` for the same
 * 600-line reason as its sibling `compose-*.ts` files. Still composition-root
 * code, not a module boundary.
 *
 * Reuses the media module's own byte-deletion workflow
 * (`SchedulePurgeMediaDeletion`), the shared identity-provider gateway (the
 * Firebase half of account deletion), and the same worker-to-API invocation
 * verifier as every other internal endpoint.
 */

import {
  GetAccountDeletion,
  KyselyDeletionUnitOfWork,
  RequestAccountDeletion,
  RestoreAccountDeletion,
  RunDeletionSweep,
  RunPurge,
} from './modules/deletion/public.js';
import type {
  AccountDeletionRoutesDependencies,
  DeletionSweepRouteDependencies,
} from './modules/deletion/public.js';
import {
  KyselyGardenRepository,
  KyselyMembershipRepository,
} from './modules/gardens-mapping/public.js';
import { KyselyProfileRepository } from './modules/identity-access/public.js';
import { KyselyMediaUnitOfWork, SchedulePurgeMediaDeletion } from './modules/media/public.js';
import type { IdentityProviderAccountGateway } from './platform/authentication/identity-provider-account-gateway.js';
import type { MediaConfiguration } from './platform/configuration/configuration-schema.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import type { CloudTasksInvocationVerifier } from './platform/tasks/cloud-tasks-invocation-verifier.js';
import type { Clock } from './shared/time/clock.js';

export interface DeletionComposition {
  readonly accountDeletionRoutesDependencies: AccountDeletionRoutesDependencies;
  readonly deletionSweepRouteDependencies: DeletionSweepRouteDependencies;
}

export function composeDeletion(
  database: DatabaseGateway,
  clock: Clock,
  bucketNames: MediaConfiguration['buckets'],
  identityProviderAccounts: IdentityProviderAccountGateway,
  cloudTasksInvocationVerifier: CloudTasksInvocationVerifier,
): DeletionComposition {
  const deletionUnitOfWork = new KyselyDeletionUnitOfWork(database.queries, clock);
  const deletionIdempotency = new KyselyIdempotencyStore(database.queries, clock);

  const accountDeletionRoutesDependencies: AccountDeletionRoutesDependencies = {
    requestAccountDeletion: new RequestAccountDeletion(
      deletionIdempotency,
      deletionUnitOfWork,
      clock,
    ),
    restoreAccountDeletion: new RestoreAccountDeletion(
      deletionIdempotency,
      deletionUnitOfWork,
      clock,
    ),
    getAccountDeletion: new GetAccountDeletion(
      new KyselyProfileRepository(database.queries),
      new KyselyMembershipRepository(database.queries),
      new KyselyGardenRepository(database.queries),
    ),
  };

  const deletionSweepRouteDependencies: DeletionSweepRouteDependencies = {
    runDeletionSweep: new RunDeletionSweep(
      deletionUnitOfWork,
      new RunPurge(
        deletionUnitOfWork,
        new SchedulePurgeMediaDeletion(
          new KyselyMediaUnitOfWork(database.queries, clock),
          bucketNames,
          clock,
        ),
        identityProviderAccounts,
        clock,
      ),
      clock,
    ),
    cloudTasksInvocationVerifier,
  };

  return { accountDeletionRoutesDependencies, deletionSweepRouteDependencies };
}
