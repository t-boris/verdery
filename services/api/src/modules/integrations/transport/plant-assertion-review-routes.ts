/**
 * P11-PROV-01: the horticultural-review surface's own HTTP routes — the
 * "no reviewer-facing surface exists yet" gap `plant-taxonomy-mapping-
 * repository.ts`'s own header and `docs/development/plant-knowledge-
 * provider-runbooks.md` section 6 both named as a tracked, deliberate
 * deferral. Registered in `app.ts`'s ordinary authenticated block (Firebase
 * session/ID-token auth, CSRF, account-state, App Check monitoring — no new
 * plugin), the same posture every other human-facing route in this codebase
 * takes; authorization beyond "any authenticated user" is enforced inside
 * `ListPlantAssertionsAwaitingReview`/`ApprovePlantAssertionReview`
 * themselves (`requirePlantReviewerAccess`), never a Fastify preHandler —
 * mirroring `OrganizationAuthorization.requireCapability`'s own "the guard
 * is a call at the top of the use case" convention.
 *
 * NOT IN `packages/api-contracts/openapi.yaml`: this is a professional/admin
 * capability gated by a configuration allowlist, not a surface any mobile or
 * web client contract targets today — a deliberate scope boundary, not an
 * oversight. Request/response shapes are declared locally, hand-validated
 * the same `invalid`/`UUID_PATTERN` way every other route in this codebase
 * hand-validates against its own contract.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { invalid, UUID_PATTERN } from '../../gardens-mapping/transport/garden-routes.js';
import type {
  ApprovePlantAssertionReview,
  PlantAssertionKind,
} from '../application/approve-plant-assertion-review.js';
import type { ListPlantAssertionsAwaitingReview } from '../application/list-plant-assertions-awaiting-review.js';

export interface PlantAssertionReviewRoutesDependencies {
  readonly listPlantAssertionsAwaitingReview: ListPlantAssertionsAwaitingReview;
  readonly approvePlantAssertionReview: ApprovePlantAssertionReview;
}

const ASSERTION_KINDS: readonly PlantAssertionKind[] = ['fact', 'distribution'];

function requireAssertionKind(request: FastifyRequest): PlantAssertionKind {
  const params = request.params as Record<string, unknown>;
  const kind = params['kind'];
  if (typeof kind !== 'string' || !ASSERTION_KINDS.includes(kind as PlantAssertionKind)) {
    throw invalid('kind must be "fact" or "distribution".', 'request.kind.invalid', '/kind');
  }
  return kind as PlantAssertionKind;
}

function requireAssertionId(request: FastifyRequest): string {
  const params = request.params as Record<string, unknown>;
  const assertionId = params['assertionId'];
  if (typeof assertionId !== 'string' || !UUID_PATTERN.test(assertionId)) {
    throw invalid('assertionId must be a UUID.', 'request.assertion_id.invalid', '/assertionId');
  }
  return assertionId;
}

export function registerPlantAssertionReviewRoutes(
  app: FastifyInstance,
  dependencies: PlantAssertionReviewRoutesDependencies,
): void {
  app.get('/plant-assertion-reviews', async (request, reply) => {
    const pending = await dependencies.listPlantAssertionsAwaitingReview.execute({
      email: request.actorContext.email,
      emailVerified: request.actorContext.emailVerified,
    });

    return reply.status(200).send({ pending });
  });

  app.post('/plant-assertion-reviews/:kind/:assertionId/approve', async (request, reply) => {
    const kind = requireAssertionKind(request);
    const assertionId = requireAssertionId(request);

    const result = await dependencies.approvePlantAssertionReview.execute(
      { kind, assertionId },
      { email: request.actorContext.email, emailVerified: request.actorContext.emailVerified },
    );

    return reply.status(200).send(result);
  });
}
