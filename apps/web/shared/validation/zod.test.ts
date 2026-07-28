import { describe, expect, it } from 'vitest';

import { z } from './zod';

describe('browser-safe Zod configuration', () => {
  it('disables generated validators that require eval-like compilation', () => {
    expect(z.config().jitless).toBe(true);
  });

  it('still validates ordinary form schemas', () => {
    const schema = z.object({ name: z.string().min(1) });

    expect(schema.parse({ name: 'Rose garden' })).toEqual({ name: 'Rose garden' });
    expect(schema.safeParse({ name: '' }).success).toBe(false);
  });
});
