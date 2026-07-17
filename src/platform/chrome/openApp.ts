import { APP_ROUTES, parseAppNavigationRoute, type AppNavigationRoute } from '../../app/routes';

export interface AppNavigationApi {
  runtime: Pick<typeof chrome.runtime, 'getURL'>;
  tabs: Pick<typeof chrome.tabs, 'create' | 'query' | 'update'>;
  windows: Pick<typeof chrome.windows, 'update'>;
}

export interface OpenAppResult {
  action: 'created' | 'focused';
  tabId?: number;
}

export async function focusOrOpenApp(
  api: AppNavigationApi,
  requestedRoute: string = APP_ROUTES.windows,
): Promise<OpenAppResult> {
  const route: AppNavigationRoute = parseAppNavigationRoute(requestedRoute);
  const appBaseUrl = api.runtime.getURL('app.html');
  const appUrl = `${appBaseUrl}${route}`;
  const tabs = await api.tabs.query({ url: `${appBaseUrl}*` });
  const existing = tabs.find((tab) => tab.id !== undefined && tab.url?.startsWith(appBaseUrl));

  if (existing?.id !== undefined) {
    await api.tabs.update(existing.id, { active: true, url: appUrl });
    if (existing.windowId !== undefined) {
      await api.windows.update(existing.windowId, { focused: true });
    }
    return { action: 'focused', tabId: existing.id };
  }

  const created = await api.tabs.create({ url: appUrl });
  return created.id === undefined
    ? { action: 'created' }
    : { action: 'created', tabId: created.id };
}
