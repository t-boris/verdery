import type {
  ClientUpdateItemKind,
  ClientUpdateState,
  PublicationMediaRole,
  PublisherGrantState,
} from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  clientUpdateItemKindLabel,
  clientUpdateStateLabel,
  clientUpdateStateTone,
  publicationMediaRoleLabel,
  publisherGrantStateLabel,
  publisherGrantStateTone,
} from './labels';

describe('clientUpdateStateLabel / clientUpdateStateTone', () => {
  it.each<[ClientUpdateState, string, string]>([
    ['internal_draft', 'publications.state.internal_draft', 'neutral'],
    ['ready_for_client', 'publications.state.ready_for_client', 'neutral'],
    ['published', 'publications.state.published', 'positive'],
    ['withdrawn', 'publications.state.withdrawn', 'negative'],
  ])('maps %s to %s / %s', (state, key, tone) => {
    expect(clientUpdateStateLabel(state)).toBe(key);
    expect(clientUpdateStateTone(state)).toBe(tone);
  });
});

describe('clientUpdateItemKindLabel', () => {
  it.each<[ClientUpdateItemKind, string]>([
    ['work_log', 'publications.itemKind.work_log'],
    ['media', 'publications.itemKind.media'],
    ['observation', 'publications.itemKind.observation'],
  ])('maps %s to %s', (kind, key) => {
    expect(clientUpdateItemKindLabel(kind)).toBe(key);
  });
});

describe('publicationMediaRoleLabel', () => {
  it.each<[PublicationMediaRole, string]>([
    ['before', 'publications.mediaRole.before'],
    ['after', 'publications.mediaRole.after'],
    ['general', 'publications.mediaRole.general'],
  ])('maps %s to %s', (role, key) => {
    expect(publicationMediaRoleLabel(role)).toBe(key);
  });
});

describe('publisherGrantStateLabel / publisherGrantStateTone', () => {
  it.each<[PublisherGrantState, string, string]>([
    ['active', 'publications.accessState.active', 'positive'],
    ['revoked', 'publications.accessState.revoked', 'neutral'],
  ])('maps %s to %s / %s', (state, key, tone) => {
    expect(publisherGrantStateLabel(state)).toBe(key);
    expect(publisherGrantStateTone(state)).toBe(tone);
  });
});
