import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { parseSearchPlantsQuery } from './plant-search-query.js';

function request(query: Record<string, unknown>): FastifyRequest {
  return { query } as FastifyRequest;
}

describe('parseSearchPlantsQuery — P11-SEARCH-01 filters', () => {
  it('omits every joined filter when the query carries none', () => {
    const { filters } = parseSearchPlantsQuery(request({}));

    expect(filters).not.toHaveProperty('observedWithinDays');
    expect(filters).not.toHaveProperty('healthConcern');
    expect(filters).not.toHaveProperty('seasonalActivity');
    expect(filters).not.toHaveProperty('distributionStatus');
    expect(filters).not.toHaveProperty('profileCompleteness');
  });

  it('parses the journal-recency bounds as day counts', () => {
    const { filters } = parseSearchPlantsQuery(
      request({ observedWithinDays: '14', notObservedForDays: '90' }),
    );

    expect(filters.observedWithinDays).toBe(14);
    expect(filters.notObservedForDays).toBe(90);
  });

  // Zero and negatives are a client bug, not a request for "no filter" — the
  // parser says so instead of quietly widening the result set.
  it.each(['0', '-1', '3651', 'soon', '1.5'])('rejects %s as a day count', (value) => {
    expect(() => parseSearchPlantsQuery(request({ observedWithinDays: value }))).toThrow(
      ValidationError,
    );
  });

  it('parses comma-separated health concerns and rejects an unknown kind', () => {
    const { filters } = parseSearchPlantsQuery(request({ healthConcern: 'pest,disease' }));
    expect(filters.healthConcern).toEqual(['pest', 'disease']);

    expect(() => parseSearchPlantsQuery(request({ healthConcern: 'wilting' }))).toThrow(
      ValidationError,
    );
  });

  it('parses seasonal activity with a month, and rejects a month outside the year', () => {
    const { filters } = parseSearchPlantsQuery(
      request({ seasonalActivity: 'harvest,transplant', seasonalMonth: '11' }),
    );

    expect(filters.seasonalActivity).toEqual(['harvest', 'transplant']);
    expect(filters.seasonalMonth).toBe(11);

    expect(() => parseSearchPlantsQuery(request({ seasonalMonth: '13' }))).toThrow(ValidationError);
  });

  it('parses distribution status with a region', () => {
    const { filters } = parseSearchPlantsQuery(
      request({ distributionStatus: 'invasive,regulated', distributionRegion: 'US-CA' }),
    );

    expect(filters.distributionStatus).toEqual(['invasive', 'regulated']);
    expect(filters.distributionRegion).toBe('US-CA');
  });

  // A region of spaces filters nothing and must not reach SQL as if it did.
  it('treats a blank region as absent', () => {
    const { filters } = parseSearchPlantsQuery(request({ distributionRegion: '   ' }));

    expect(filters).not.toHaveProperty('distributionRegion');
  });

  it('parses profile completeness and rejects a value outside the vocabulary', () => {
    const { filters } = parseSearchPlantsQuery(request({ profileCompleteness: 'none' }));
    expect(filters.profileCompleteness).toBe('none');

    expect(() => parseSearchPlantsQuery(request({ profileCompleteness: 'unknown' }))).toThrow(
      ValidationError,
    );
  });
});
