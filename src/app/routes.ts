export const APP_ROUTES = {
  windows: '#/windows',
  savedWindows: '#/saved-windows',
  settings: '#/settings',
  about: '#/about',
} as const;

export const APP_LAUNCH_ROUTES = {
  duplicateTabs: `${APP_ROUTES.windows}?view=duplicates`,
} as const;

export type AppRoute = (typeof APP_ROUTES)[keyof typeof APP_ROUTES];
export type AppLaunchRoute = (typeof APP_LAUNCH_ROUTES)[keyof typeof APP_LAUNCH_ROUTES];
export type AppNavigationRoute = AppRoute | AppLaunchRoute;

export type AppRouteQueryValue = string | number | boolean;

const ROUTE_SET = new Set<AppRoute>(Object.values(APP_ROUTES));
const LAUNCH_ROUTE_SET = new Set<AppLaunchRoute>(Object.values(APP_LAUNCH_ROUTES));

export function parseAppRoute(hash: string): AppRoute {
  const queryStart = hash.indexOf('?');
  const pageHash = queryStart === -1 ? hash : hash.slice(0, queryStart);
  return ROUTE_SET.has(pageHash as AppRoute) ? (pageHash as AppRoute) : APP_ROUTES.windows;
}

export function parseAppNavigationRoute(hash: string): AppNavigationRoute {
  return LAUNCH_ROUTE_SET.has(hash as AppLaunchRoute)
    ? (hash as AppLaunchRoute)
    : parseAppRoute(hash);
}

export function isDuplicateTabsLaunchRoute(hash: string): boolean {
  return (
    parseAppRoute(hash) === APP_ROUTES.windows &&
    getAppRouteSearchParams(hash).get('view') === 'duplicates'
  );
}

export function createAppRouteQuery(
  route: AppRoute,
  values: Readonly<Record<string, AppRouteQueryValue>>,
): string {
  const searchParams = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => searchParams.set(key, String(value)));
  const query = searchParams.toString();
  return query ? `${route}?${query}` : route;
}

export function getAppRouteSearchParams(hash: string): URLSearchParams {
  const queryStart = hash.indexOf('?');
  return new URLSearchParams(queryStart === -1 ? '' : hash.slice(queryStart + 1));
}
