/**
 * Public surface of the client-publication domain feature (P9C-PUBLISH-01):
 * publisher-grant administration and the `internal_draft ->
 * ready_for_client -> published -> withdrawn` client-update workflow,
 * including item staging.
 *
 * Source: architecture/web-application-design.md, section "5. Application Structure".
 */
export { ClientUpdateDetail, type ClientUpdateDetailProps } from './client-update-detail';
export { ClientUpdateList } from './client-update-list';
export { CreateClientUpdateForm } from './create-client-update-form';
export { PublisherAccessPanel } from './publisher-access-panel';
