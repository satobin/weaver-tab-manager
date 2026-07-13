import { describe, expect, it, vi } from 'vitest';

import { APP_ROUTES } from '../../app/routes';
import { focusOrOpenApp, type AppNavigationApi } from './openApp';

function createApi(overrides: Partial<AppNavigationApi> = {}): AppNavigationApi {
  return {
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://weaver/${path}`),
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({ id: 31 } as chrome.tabs.Tab)),
      update: vi.fn(() => Promise.resolve(undefined)),
    },
    windows: {
      update: vi.fn(() => Promise.resolve({ id: 8 } as chrome.windows.Window)),
    },
    ...overrides,
  };
}

describe('focusOrOpenApp', () => {
  it('creates the app tab when none exists', async () => {
    const api = createApi();

    await expect(focusOrOpenApp(api, APP_ROUTES.savedWindows)).resolves.toEqual({
      action: 'created',
      tabId: 31,
    });
    expect(api.tabs.query).toHaveBeenCalledWith({
      url: 'chrome-extension://weaver/app.html*',
    });
    expect(api.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://weaver/app.html#/saved-windows',
    });
  });

  it('focuses and routes an existing app tab', async () => {
    const api = createApi({
      tabs: {
        query: vi.fn(() =>
          Promise.resolve([
            {
              id: 14,
              windowId: 8,
              url: 'chrome-extension://weaver/app.html#/about',
            } as chrome.tabs.Tab,
          ]),
        ),
        create: vi.fn(() => Promise.resolve({ id: 31 } as chrome.tabs.Tab)),
        update: vi.fn(() => Promise.resolve(undefined)),
      },
    });

    await expect(focusOrOpenApp(api, APP_ROUTES.settings)).resolves.toEqual({
      action: 'focused',
      tabId: 14,
    });
    expect(api.tabs.update).toHaveBeenCalledWith(14, {
      active: true,
      url: 'chrome-extension://weaver/app.html#/settings',
    });
    expect(api.windows.update).toHaveBeenCalledWith(8, { focused: true });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it('falls back to the windows route for invalid input', async () => {
    const api = createApi();

    await focusOrOpenApp(api, '#/not-a-route');

    expect(api.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://weaver/app.html#/windows',
    });
  });
});
