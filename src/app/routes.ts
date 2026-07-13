export const APP_ROUTES = {
  windows: '#/windows',
  savedWindows: '#/saved-windows',
  settings: '#/settings',
  about: '#/about',
} as const;

export type AppRoute = (typeof APP_ROUTES)[keyof typeof APP_ROUTES];

const ROUTE_SET = new Set<AppRoute>(Object.values(APP_ROUTES));

export function parseAppRoute(hash: string): AppRoute {
  return ROUTE_SET.has(hash as AppRoute) ? (hash as AppRoute) : APP_ROUTES.windows;
}
