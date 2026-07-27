import { describe, expect, it } from 'vitest';
import type { Position } from '@verdery/geometry-contracts';
import { deriveHemisphere } from './garden-facts.js';

describe('deriveHemisphere', () => {
  it('returns null when the garden has never been georeferenced', () => {
    expect(deriveHemisphere(null)).toBeNull();
  });

  it('resolves a positive latitude to northern', () => {
    const amsterdam: Position = [4.895, 52.37];
    expect(deriveHemisphere(amsterdam)).toBe('northern');
  });

  it('resolves a negative latitude to southern', () => {
    const sydney: Position = [151.21, -33.87];
    expect(deriveHemisphere(sydney)).toBe('southern');
  });

  it('resolves exactly zero latitude (the equator) to northern — the documented conservative choice', () => {
    const onTheEquator: Position = [0, 0];
    expect(deriveHemisphere(onTheEquator)).toBe('northern');
  });
});
