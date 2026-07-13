import { describe, expect, it } from 'vitest';

import { APP_ROUTES, parseAppRoute } from './routes';

describe('parseAppRoute', () => {
  it.each(Object.values(APP_ROUTES))('accepts %s', (route) => {
    expect(parseAppRoute(route)).toBe(route);
  });

  it('falls back to active windows for unknown routes', () => {
    expect(parseAppRoute('#/unknown')).toBe(APP_ROUTES.windows);
  });
});
