import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from './mapWithConcurrency';

describe('mapWithConcurrency', () => {
  it('bounds active work and preserves input order', async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await mapWithConcurrency([5, 4, 3, 2, 1], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => window.setTimeout(resolve, value));
      active -= 1;
      return value * 10;
    });

    expect(maximumActive).toBe(2);
    expect(results).toEqual([50, 40, 30, 20, 10]);
  });

  it('rejects an invalid concurrency limit', async () => {
    await expect(mapWithConcurrency([1], 0, (value) => Promise.resolve(value))).rejects.toThrow(
      'Concurrency must be a positive integer.',
    );
  });
});
