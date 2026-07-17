import { describe, expect, it } from 'vitest';

import { APP_LAUNCH_ROUTES, APP_ROUTES, parseAppNavigationRoute, parseAppRoute } from './routes';

describe('parseAppRoute', () => {
  it.each(Object.values(APP_ROUTES))('accepts %s', (route) => {
    expect(parseAppRoute(route)).toBe(route);
  });

  it('falls back to active windows for unknown routes', () => {
    expect(parseAppRoute('#/unknown')).toBe(APP_ROUTES.windows);
  });

  it('routes duplicate-tab launches to active windows', () => {
    expect(parseAppRoute(APP_LAUNCH_ROUTES.duplicateTabs)).toBe(APP_ROUTES.windows);
  });

  it('preserves recognized launch routes for app navigation', () => {
    expect(parseAppNavigationRoute(APP_LAUNCH_ROUTES.duplicateTabs)).toBe(
      APP_LAUNCH_ROUTES.duplicateTabs,
    );
  });
});
