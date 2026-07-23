/**
 * Public surface of the local-drafts module.
 *
 * Source: architecture/web-application-design.md, section "9. Online-First
 * Behavior".
 */
export {
  clearLocalDraft,
  loadLocalDraft,
  saveLocalDraft,
  type DraftEnvelope,
} from './local-draft-store';
export {
  useRecoverableDraft,
  type RecoverableDraft,
  type UseRecoverableDraftOptions,
} from './use-recoverable-draft';
