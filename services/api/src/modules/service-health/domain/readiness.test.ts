import { describe, expect, it } from 'vitest';
import type { DependencyHealth } from './readiness.js';
import { decideReadiness } from './readiness.js';

const available: DependencyHealth = { name: 'database', availability: 'available' };
const unavailable: DependencyHealth = { name: 'database', availability: 'unavailable' };

describe('decideReadiness', () => {
  it('is ready when every required dependency answers', () => {
    expect(decideReadiness([available])).toBe('ready');
  });

  it('is not ready when any required dependency is unavailable', () => {
    expect(decideReadiness([available, unavailable])).toBe('notReady');
  });

  it('is ready when no dependency is required', () => {
    expect(decideReadiness([])).toBe('ready');
  });
});
