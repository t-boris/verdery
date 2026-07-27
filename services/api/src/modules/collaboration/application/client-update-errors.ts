/**
 * Shared error constructors for the client-update lifecycle
 * (P9C-PUBLISH-01) — every command under `/client-engagements/{engagementId}
 * /updates/...` reuses these, the same "one constructor per raised error,
 * reused across every command that raises it" shape `task-errors.ts`
 * establishes for `tasks-recommendations`. Error CODES live in
 * `@verdery/api-contracts` (`ClientEngagementErrorCode`/
 * `ClientUpdateErrorCode`), unlike `task-errors.ts`'s own colocated codes —
 * this module already has a transport layer and contract document for this
 * pass, so there is no reason to invent a second, uncatalogued code space.
 */

import { ClientEngagementErrorCode, ClientUpdateErrorCode } from '@verdery/api-contracts';
import type { ErrorDetail } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  NotFoundError,
  StaleRevisionError,
} from '../../../platform/errors/application-error.js';

export function engagementNotFoundError(): NotFoundError {
  return new NotFoundError(ClientEngagementErrorCode.NotFound, 'No engagement exists at this id.');
}

export function clientUpdateNotFoundError(): NotFoundError {
  return new NotFoundError(
    ClientUpdateErrorCode.NotFound,
    'No client update exists at this id on this engagement.',
  );
}

export function clientUpdateItemNotFoundError(): NotFoundError {
  return new NotFoundError(
    ClientUpdateErrorCode.ItemNotFound,
    'No staged item exists at this id on this client update.',
  );
}

export function clientUpdateStaleRevisionError(currentRevision: number): StaleRevisionError {
  return new StaleRevisionError(
    ClientUpdateErrorCode.StaleRevision,
    'The client update changed before this command was applied.',
    { details: [{ code: 'client_update.revision', parameters: { currentRevision } }] },
  );
}

/** Raised when a transition (submit/publish) or a content/item mutation is attempted from a state that does not allow it — see `publication-state.ts`'s own state diagram. */
export function clientUpdateInvalidTransitionError(message: string): DomainRuleViolatedError {
  return new DomainRuleViolatedError(ClientUpdateErrorCode.InvalidTransition, message);
}

/** `updateClientUpdateContent`/`addClientUpdateItem`/`removeClientUpdateItem` outside `internal_draft` — content and staged items are locked from `ready_for_client` onward. */
export function clientUpdateContentLockedError(): DomainRuleViolatedError {
  return clientUpdateInvalidTransitionError(
    'Content can only be edited or staged while the update is internal_draft.',
  );
}

export function summaryRequiredError(): DomainRuleViolatedError {
  return new DomainRuleViolatedError(
    ClientUpdateErrorCode.SummaryRequired,
    'A summary is required before an update can be submitted.',
  );
}

/** A staged or inline-published item that fails re-validation at publish time (step 2 of the six-step transaction) — does not exist, belongs to a different garden, or (media) is not `available`. */
export function selectedItemInvalidError(details: readonly ErrorDetail[]): DomainRuleViolatedError {
  return new DomainRuleViolatedError(
    ClientUpdateErrorCode.SelectedItemInvalid,
    'A selected item does not exist, does not belong to this garden, or is not available.',
    { details },
  );
}

export function staffProfileNotFoundError(pointer: string): DomainRuleViolatedError {
  return new DomainRuleViolatedError(
    ClientUpdateErrorCode.StaffProfileNotFound,
    'A staff attribution named a profile that does not exist.',
    { details: [{ code: 'client_update.staff_profile_not_found', pointer }] },
  );
}
