import { describe, expect, it, vi } from 'vitest';

import {
  applyRestoredTabMetadata,
  createRestoredTabMetadataService,
  RESTORED_TAB_METADATA_STORAGE_KEY,
  type RestoredTabMetadataChromeApi,
} from './restoredTabMetadata';

function createTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    active: false,
    discarded: false,
    groupId: -1,
    highlighted: false,
    id: 42,
    incognito: false,
    index: 0,
    pinned: false,
    pendingUrl: 'https://docs.example/plan',
    selected: false,
    status: 'loading',
    url: 'about:blank',
    windowId: 1,
    ...overrides,
  } as chrome.tabs.Tab;
}

function createApi() {
  const stored: Record<string, unknown> = {};
  const listeners = new Set<
    (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void
  >();
  const api: RestoredTabMetadataChromeApi = {
    storage: {
      onChanged: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
      session: {
        get: vi.fn((key: string) => Promise.resolve({ [key]: stored[key] })),
        remove: vi.fn((key: string) => {
          delete stored[key];
          return Promise.resolve();
        }),
        set: vi.fn((items: Record<string, unknown>) => {
          Object.assign(stored, items);
          return Promise.resolve();
        }),
      },
    },
  };
  return {
    api,
    emit: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      listeners.forEach((listener) => listener(changes, areaName));
    },
    stored,
  };
}

describe('restored tab metadata', () => {
  it('overlays saved identity until Chrome supplies the real title and URL', async () => {
    const { api, stored } = createApi();
    const service = createRestoredTabMetadataService(api);
    await service.register([
      { tabId: 42, title: 'Quarterly plan', url: 'https://docs.example/plan' },
    ]);

    const loadingTab = createTab();
    const fallback = await service.resolve([loadingTab]);
    expect(applyRestoredTabMetadata(loadingTab, fallback)).toMatchObject({
      title: 'Quarterly plan',
      url: 'https://docs.example/plan',
    });

    const loadedTab = createTab({
      discarded: false,
      status: 'complete',
      title: 'Quarterly plan - Docs',
      url: 'https://docs.example/plan',
    });
    expect(await service.resolve([loadedTab])).toEqual(new Map());
    expect(stored[RESTORED_TAB_METADATA_STORAGE_KEY]).toBeUndefined();
  });

  it('drops fallback identity when the tab navigates elsewhere', async () => {
    const { api, stored } = createApi();
    const service = createRestoredTabMetadataService(api);
    await service.register([
      { tabId: 42, title: 'Quarterly plan', url: 'https://docs.example/plan' },
    ]);

    expect(
      await service.resolve([createTab({ pendingUrl: 'https://example.com/elsewhere' })], {
        pruneMissing: false,
      }),
    ).toEqual(new Map());
    expect(stored[RESTORED_TAB_METADATA_STORAGE_KEY]).toBeUndefined();
  });

  it('prunes metadata for closed tabs during a complete snapshot', async () => {
    const { api, stored } = createApi();
    const service = createRestoredTabMetadataService(api);
    await service.register([
      { tabId: 42, title: 'Quarterly plan', url: 'https://docs.example/plan' },
    ]);

    expect(await service.resolve([])).toEqual(new Map());
    expect(stored[RESTORED_TAB_METADATA_STORAGE_KEY]).toBeUndefined();
  });

  it('notifies only for its session-storage record', () => {
    const { api, emit } = createApi();
    const service = createRestoredTabMetadataService(api);
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    emit({ other: { newValue: true } }, 'session');
    emit({ [RESTORED_TAB_METADATA_STORAGE_KEY]: { newValue: true } }, 'local');
    emit({ [RESTORED_TAB_METADATA_STORAGE_KEY]: { newValue: true } }, 'session');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    emit({ [RESTORED_TAB_METADATA_STORAGE_KEY]: { newValue: false } }, 'session');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
