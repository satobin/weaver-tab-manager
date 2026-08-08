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
    listenerCount: () => listeners.size,
    stored,
  };
}

describe('restored tab metadata', () => {
  it('shares and caches the lazy tracked-tab lookup', async () => {
    const { api } = createApi();
    const service = createRestoredTabMetadataService(api);
    const session = api.storage?.session;
    if (!session) {
      throw new Error('Expected session storage.');
    }

    await Promise.all(Array.from({ length: 500 }, (_, tabId) => service.isTracked(tabId)));

    expect(session.get).toHaveBeenCalledTimes(1);
  });

  it('loads tracked IDs again after a service-worker restart', async () => {
    const { api } = createApi();
    await createRestoredTabMetadataService(api).register([
      { tabId: 42, title: 'Quarterly plan', url: 'https://docs.example/plan' },
    ]);

    const restartedService = createRestoredTabMetadataService(api);
    await expect(restartedService.isTracked(42)).resolves.toBe(true);
  });

  it('keeps the tracked-tab cache current across register, resolve, and remove calls', async () => {
    const { api } = createApi();
    const service = createRestoredTabMetadataService(api);
    const session = api.storage?.session;
    if (!session) {
      throw new Error('Expected session storage.');
    }

    expect(await service.isTracked(42)).toBe(false);
    await service.register([
      { tabId: 42, title: 'Quarterly plan', url: 'https://docs.example/plan' },
      { tabId: 43, title: 'Roadmap', url: 'https://docs.example/roadmap' },
    ]);
    expect(await service.isTracked(42)).toBe(true);
    expect(await service.isTracked(43)).toBe(true);

    await service.resolve([
      createTab({
        id: 42,
        pendingUrl: undefined,
        status: 'complete',
        title: 'Quarterly plan - Docs',
        url: 'https://docs.example/plan',
      }),
      createTab({ id: 43, pendingUrl: 'https://docs.example/roadmap' }),
    ]);
    expect(await service.isTracked(42)).toBe(false);
    expect(await service.isTracked(43)).toBe(true);

    await service.remove([43]);
    expect(await service.isTracked(43)).toBe(false);
    expect(session.get).toHaveBeenCalledTimes(4);
  });

  it('does not let an older lazy lookup overwrite a concurrent registration', async () => {
    const { api } = createApi();
    const session = api.storage?.session;
    if (!session) {
      throw new Error('Expected session storage.');
    }
    let resolveFirstRead: ((value: Record<string, unknown>) => void) | undefined;
    const firstRead = new Promise<Record<string, unknown>>((resolve) => {
      resolveFirstRead = resolve;
    });
    vi.mocked(session.get).mockImplementationOnce(() => firstRead);
    const service = createRestoredTabMetadataService(api);

    const pendingLookup = service.isTracked(42);
    await Promise.resolve();
    const registration = service.register([
      { tabId: 42, title: 'Quarterly plan', url: 'https://docs.example/plan' },
    ]);
    await registration;
    resolveFirstRead?.({ [RESTORED_TAB_METADATA_STORAGE_KEY]: undefined });

    await expect(pendingLookup).resolves.toBe(true);
    expect(await service.isTracked(42)).toBe(true);
    expect(session.get).toHaveBeenCalledTimes(2);
  });

  it('retries a lazy lookup invalidated by an external storage change', async () => {
    const { api, emit, stored } = createApi();
    const session = api.storage?.session;
    if (!session) {
      throw new Error('Expected session storage.');
    }
    let resolveFirstRead: ((value: Record<string, unknown>) => void) | undefined;
    const firstRead = new Promise<Record<string, unknown>>((resolve) => {
      resolveFirstRead = resolve;
    });
    vi.mocked(session.get).mockImplementationOnce(() => firstRead);
    const service = createRestoredTabMetadataService(api);

    const pendingLookup = service.isTracked(42);
    await Promise.resolve();
    const externalCollection = {
      schemaVersion: 1,
      tabs: {
        42: { title: 'Quarterly plan', url: 'https://docs.example/plan' },
      },
    };
    stored[RESTORED_TAB_METADATA_STORAGE_KEY] = externalCollection;
    emit(
      {
        [RESTORED_TAB_METADATA_STORAGE_KEY]: {
          newValue: externalCollection,
          oldValue: undefined,
        },
      },
      'session',
    );
    resolveFirstRead?.({ [RESTORED_TAB_METADATA_STORAGE_KEY]: undefined });

    await expect(pendingLookup).resolves.toBe(true);
    expect(session.get).toHaveBeenCalledTimes(2);
  });

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
    const { api, emit, listenerCount } = createApi();
    const service = createRestoredTabMetadataService(api);
    const listener = vi.fn();
    expect(listenerCount()).toBe(0);
    const unsubscribe = service.subscribe(listener);
    expect(listenerCount()).toBe(1);

    emit({ other: { newValue: true } }, 'session');
    emit({ [RESTORED_TAB_METADATA_STORAGE_KEY]: { newValue: true } }, 'local');
    emit({ [RESTORED_TAB_METADATA_STORAGE_KEY]: { newValue: true } }, 'session');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(listenerCount()).toBe(0);
    emit({ [RESTORED_TAB_METADATA_STORAGE_KEY]: { newValue: false } }, 'session');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps one invalidation listener after tracked-tab lookups are enabled', async () => {
    const { api, listenerCount } = createApi();
    const service = createRestoredTabMetadataService(api);
    const unsubscribeFirst = service.subscribe(() => undefined);
    const unsubscribeSecond = service.subscribe(() => undefined);
    expect(listenerCount()).toBe(1);

    unsubscribeFirst();
    expect(listenerCount()).toBe(1);
    unsubscribeSecond();
    expect(listenerCount()).toBe(0);

    await service.isTracked(42);
    expect(listenerCount()).toBe(1);
    const unsubscribeAfterTracking = service.subscribe(() => undefined);
    unsubscribeAfterTracking();
    expect(listenerCount()).toBe(1);
  });

  it('tracks duplicate subscriptions independently and isolates subscriber failures', () => {
    const { api, emit, listenerCount } = createApi();
    const service = createRestoredTabMetadataService(api);
    const sharedListener = vi.fn();
    const unsubscribeFirst = service.subscribe(sharedListener);
    const unsubscribeSecond = service.subscribe(sharedListener);
    service.subscribe(() => {
      throw new Error('Subscriber failed.');
    });
    const survivingListener = vi.fn();
    service.subscribe(survivingListener);

    emit({ [RESTORED_TAB_METADATA_STORAGE_KEY]: { newValue: true } }, 'session');
    expect(sharedListener).toHaveBeenCalledTimes(2);
    expect(survivingListener).toHaveBeenCalledTimes(1);
    expect(listenerCount()).toBe(1);

    unsubscribeFirst();
    emit({ [RESTORED_TAB_METADATA_STORAGE_KEY]: { newValue: false } }, 'session');
    expect(sharedListener).toHaveBeenCalledTimes(3);
    expect(survivingListener).toHaveBeenCalledTimes(2);

    unsubscribeSecond();
  });
});
