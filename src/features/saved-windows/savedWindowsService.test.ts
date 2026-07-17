import { describe, expect, it, vi } from 'vitest';

import { type RestoredTabMetadataService } from '../../platform/chrome/restoredTabMetadata';
import { type SavedWindow, type SavedWindowsCollection } from './savedWindowModel';
import {
  createChromeSavedWindowsService,
  SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY,
  SAVED_WINDOWS_STORAGE_KEY,
  type SavedWindowsChromeApi,
} from './savedWindowsService';

function createChromeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    active: false,
    audible: false,
    autoDiscardable: true,
    discarded: false,
    frozen: false,
    groupId: -1,
    highlighted: false,
    incognito: false,
    index: 0,
    pinned: false,
    selected: false,
    windowId: 1,
    ...overrides,
  };
}

function createChromeWindow(overrides: Partial<chrome.windows.Window> = {}): chrome.windows.Window {
  return {
    alwaysOnTop: false,
    focused: false,
    incognito: false,
    type: 'normal',
    ...overrides,
  };
}

function createSavedWindow(overrides: Partial<SavedWindow> = {}): SavedWindow {
  return {
    createdAt: '2026-07-10T20:00:00.000Z',
    groups: [
      {
        collapsed: true,
        color: 'purple',
        key: 'group-1',
        title: 'Planning',
      },
    ],
    id: 'saved-1',
    name: 'Research',
    tabs: [
      {
        active: false,
        order: 0,
        pinned: true,
        title: 'Inbox',
        url: 'https://mail.example.com/',
      },
      {
        active: true,
        groupKey: 'group-1',
        order: 1,
        pinned: false,
        title: 'Plan',
        url: 'https://docs.example.com/plan',
      },
      {
        active: false,
        groupKey: 'group-1',
        order: 2,
        pinned: false,
        title: 'Notes',
        url: 'https://notes.example.com/',
      },
    ],
    updatedAt: '2026-07-10T20:00:00.000Z',
    ...overrides,
  };
}

function createApi(initialWindows: SavedWindow[] = []) {
  const listeners = new Set<
    (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void
  >();
  const state: Record<string, unknown> = {
    [SAVED_WINDOWS_STORAGE_KEY]: {
      schemaVersion: 1,
      windows: initialWindows,
    } satisfies SavedWindowsCollection,
  };
  const callOrder: string[] = [];
  let nextTabId = 100;
  const sourceWindow = createChromeWindow({
    focused: true,
    id: 1,
    tabs: [
      createChromeTab({
        active: true,
        id: 1,
        pinned: true,
        title: 'Inbox',
        url: 'https://mail.example.com/',
      }),
      createChromeTab({
        groupId: 7,
        id: 2,
        index: 1,
        title: 'Plan',
        url: 'https://docs.example.com/plan',
      }),
    ],
  });

  const api: SavedWindowsChromeApi = {
    storage: {
      local: {
        get: vi.fn((key: string) => Promise.resolve({ [key]: state[key] })),
        set: vi.fn((items: Record<string, unknown>) => {
          callOrder.push('storage');
          Object.assign(state, items);
          return Promise.resolve();
        }),
      },
      onChanged: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
    },
    tabGroups: {
      query: vi.fn(() =>
        Promise.resolve<chrome.tabGroups.TabGroup[]>([
          {
            collapsed: true,
            color: 'purple',
            id: 7,
            shared: false,
            title: 'Planning',
            windowId: 1,
          },
        ]),
      ),
      update: vi.fn(() => Promise.resolve(undefined)),
    },
    tabs: {
      create: vi.fn((properties: chrome.tabs.CreateProperties) => {
        const requestedUrl =
          typeof properties.url === 'string' ? properties.url : properties.url?.[0];
        return Promise.resolve(
          createChromeTab({
            active: properties.active ?? false,
            id: nextTabId++,
            index: properties.index ?? 0,
            pendingUrl: requestedUrl,
            pinned: properties.pinned ?? false,
            url: 'about:blank',
            windowId: properties.windowId ?? 9,
          }),
        );
      }),
      group: vi.fn(() => Promise.resolve(70)),
      query: vi.fn(() => Promise.resolve([createChromeTab({ active: true, id: 90, windowId: 9 })])),
      remove: vi.fn(() => {
        callOrder.push('remove-placeholder');
        return Promise.resolve();
      }),
      update: vi.fn((tabId: number) => {
        callOrder.push(`activate:${tabId}`);
        return Promise.resolve(createChromeTab({ active: true, id: tabId, windowId: 9 }));
      }),
    },
    windows: {
      create: vi.fn(() =>
        Promise.resolve(
          createChromeWindow({
            id: 9,
            tabs: [createChromeTab({ active: true, id: 90, windowId: 9 })],
          }),
        ),
      ),
      get: vi.fn(() => Promise.resolve(sourceWindow)),
      remove: vi.fn(() => {
        callOrder.push('close');
        return Promise.resolve();
      }),
      update: vi.fn((windowId: number) =>
        Promise.resolve(createChromeWindow({ focused: true, id: windowId })),
      ),
    },
  };

  return {
    api,
    callOrder,
    emit: (key = SAVED_WINDOWS_STORAGE_KEY, areaName = 'local') => {
      listeners.forEach((listener) => listener({ [key]: { newValue: state[key] } }, areaName));
    },
    listenerCount: () => listeners.size,
    sourceWindow,
    state,
  };
}

const environment = {
  createId: () => 'saved-new',
  now: () => '2026-07-10T21:00:00.000Z',
};

describe('createChromeSavedWindowsService', () => {
  it('persists a fresh browser capture before optionally closing its source window', async () => {
    const fake = createApi();
    const service = createChromeSavedWindowsService(fake.api, environment);

    const result = await service.saveWindow(1, '  Project work  ', true);

    expect(fake.api.windows.get).toHaveBeenCalledWith(1, { populate: true });
    expect(fake.api.tabGroups.query).toHaveBeenCalledWith({ windowId: 1 });
    expect(fake.callOrder).toEqual(['storage', 'close']);
    expect(result).toMatchObject({
      savedWindow: { id: 'saved-new', name: 'Project work' },
      sourceWindowClosed: true,
      warnings: [],
    });
    await expect(service.load()).resolves.toMatchObject([
      {
        groups: [{ collapsed: true, color: 'purple', title: 'Planning' }],
        id: 'saved-new',
        tabs: [
          { active: true, pinned: true, url: 'https://mail.example.com/' },
          { groupKey: 'group-1', url: 'https://docs.example.com/plan' },
        ],
      },
    ]);
  });

  it('uses restored session metadata when saving a recently restored tab again', async () => {
    const fake = createApi();
    const restoredTab = fake.sourceWindow.tabs?.[1];
    if (!restoredTab) {
      throw new Error('Missing restored tab fixture');
    }
    delete restoredTab.title;
    delete restoredTab.url;
    const restoredTabMetadataService: RestoredTabMetadataService = {
      register: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
      resolve: vi.fn(() =>
        Promise.resolve(
          new Map([
            [
              2,
              {
                title: 'Restored plan',
                url: 'https://docs.example.com/restored-plan',
              },
            ],
          ]),
        ),
      ),
      subscribe: vi.fn(() => () => undefined),
    };
    const service = createChromeSavedWindowsService(
      fake.api,
      environment,
      restoredTabMetadataService,
    );

    await service.saveWindow(1, 'Restored work', false);

    await expect(service.load()).resolves.toMatchObject([
      {
        tabs: [
          { title: 'Inbox', url: 'https://mail.example.com/' },
          { title: 'Restored plan', url: 'https://docs.example.com/restored-plan' },
        ],
      },
    ]);
    expect(restoredTabMetadataService.resolve).toHaveBeenCalledWith(fake.sourceWindow.tabs, {
      pruneMissing: false,
    });
  });

  it('never closes the source when persistence fails', async () => {
    const fake = createApi();
    vi.mocked(fake.api.storage.local.set).mockRejectedValue(new Error('Quota exceeded'));
    const service = createChromeSavedWindowsService(fake.api, environment);

    await expect(service.saveWindow(1, 'Project work', true)).rejects.toThrow('Quota exceeded');
    expect(fake.api.windows.remove).not.toHaveBeenCalled();
  });

  it('keeps a successful snapshot and reports when the optional source close fails', async () => {
    const fake = createApi();
    vi.mocked(fake.api.windows.remove).mockRejectedValue(new Error('Last window'));
    const service = createChromeSavedWindowsService(fake.api, environment);

    const result = await service.saveWindow(1, 'Project work', true);

    expect(result.sourceWindowClosed).toBe(false);
    expect(result.warnings).toEqual([
      'The window was saved, but its source could not be closed: Last window',
    ]);
    await expect(service.load()).resolves.toHaveLength(1);
  });

  it('opens an individual saved URL as a new active tab', async () => {
    const fake = createApi([createSavedWindow()]);
    const service = createChromeSavedWindowsService(fake.api, environment);

    await expect(service.openTab('https://docs.example.com/plan')).resolves.toBe(100);
    expect(fake.api.tabs.create).toHaveBeenCalledWith({
      active: true,
      url: 'https://docs.example.com/plan',
    });
    await expect(service.load()).resolves.toHaveLength(1);
  });

  it('rejects an individual saved-tab open when Chrome omits the tab ID', async () => {
    const fake = createApi([createSavedWindow()]);
    vi.mocked(fake.api.tabs.create).mockResolvedValue(createChromeTab());
    const service = createChromeSavedWindowsService(fake.api, environment);

    await expect(service.openTab('https://docs.example.com/plan')).rejects.toThrow(
      'The browser created a tab without an ID.',
    );
  });

  it('serializes rename and delete mutations without reviving stale records', async () => {
    const existing = createSavedWindow();
    const fake = createApi([existing]);
    const service = createChromeSavedWindowsService(fake.api, environment);

    const rename = service.renameWindow(existing.id, 'Renamed');
    const deletion = service.deleteWindow(existing.id);

    await expect(rename).resolves.toMatchObject({
      name: 'Renamed',
      updatedAt: '2026-07-10T21:00:00.000Z',
    });
    await expect(deletion).resolves.toBeUndefined();
    await expect(service.load()).resolves.toEqual([]);
  });

  it('keeps a consumed snapshot idempotently without changing its identity', async () => {
    const savedWindow = createSavedWindow();
    const fake = createApi();
    const service = createChromeSavedWindowsService(fake.api, environment);

    await expect(service.keepWindow(savedWindow)).resolves.toEqual(savedWindow);
    await expect(service.keepWindow(savedWindow)).resolves.toEqual(savedWindow);

    await expect(service.load()).resolves.toEqual([savedWindow]);
    expect(fake.api.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it('uses a shared write lock so concurrent app contexts cannot lose snapshots', async () => {
    const fake = createApi();
    let lockQueue: Promise<void> = Promise.resolve();
    const lockCalls: string[] = [];
    const withWriteLock = <T>(operation: () => Promise<T>): Promise<T> => {
      lockCalls.push('lock');
      const result = lockQueue.then(operation);
      lockQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    const firstService = createChromeSavedWindowsService(fake.api, {
      createId: () => 'saved-first',
      now: environment.now,
      withWriteLock,
    });
    const secondService = createChromeSavedWindowsService(fake.api, {
      createId: () => 'saved-second',
      now: environment.now,
      withWriteLock,
    });

    await Promise.all([
      firstService.saveWindow(1, 'First snapshot', false),
      secondService.saveWindow(1, 'Second snapshot', false),
    ]);

    const stored = await firstService.load();
    expect(new Set(stored.map((savedWindow) => savedWindow.name))).toEqual(
      new Set(['First snapshot', 'Second snapshot']),
    );
    expect(lockCalls).toEqual(['lock', 'lock', 'lock']);
  });

  it('restores tab order, pinning, active state, and full group membership', async () => {
    const savedWindow = createSavedWindow();
    const fake = createApi([savedWindow]);
    const restoredTabMetadataService: RestoredTabMetadataService = {
      register: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
      resolve: vi.fn(() => Promise.resolve(new Map())),
      subscribe: vi.fn(() => () => undefined),
    };
    const service = createChromeSavedWindowsService(
      fake.api,
      environment,
      restoredTabMetadataService,
    );

    const result = await service.restoreWindow(savedWindow.id);

    expect(result).toEqual({
      destinationWindowId: 9,
      failures: [],
      restoredTabCount: 3,
      savedWindowRemoved: true,
      warnings: [],
    });
    expect(fake.api.tabs.create).toHaveBeenNthCalledWith(1, {
      active: false,
      index: 0,
      pinned: true,
      url: 'https://mail.example.com/',
      windowId: 9,
    });
    expect(fake.api.tabs.create).toHaveBeenNthCalledWith(2, {
      active: false,
      index: 1,
      pinned: false,
      url: 'https://docs.example.com/plan',
      windowId: 9,
    });
    expect(fake.api.tabs.create).toHaveBeenNthCalledWith(3, {
      active: false,
      index: 2,
      pinned: false,
      url: 'https://notes.example.com/',
      windowId: 9,
    });
    expect(fake.api.tabs.group).toHaveBeenCalledWith({
      createProperties: { windowId: 9 },
      tabIds: [101, 102],
    });
    expect(fake.api.tabs.update).toHaveBeenCalledWith(101, { active: true });
    expect(fake.callOrder.indexOf('activate:101')).toBeLessThan(
      fake.callOrder.indexOf('remove-placeholder'),
    );
    expect(restoredTabMetadataService.register).toHaveBeenCalledWith([
      { tabId: 100, title: 'Inbox', url: 'https://mail.example.com/' },
      { tabId: 101, title: 'Plan', url: 'https://docs.example.com/plan' },
      { tabId: 102, title: 'Notes', url: 'https://notes.example.com/' },
    ]);
    await expect(service.load()).resolves.toEqual([]);
  });

  it('keeps a fully restored snapshot when removing its saved copy fails', async () => {
    const savedWindow = createSavedWindow();
    const fake = createApi([savedWindow]);
    vi.mocked(fake.api.storage.local.set).mockRejectedValueOnce(new Error('Storage unavailable'));
    const service = createChromeSavedWindowsService(fake.api, environment);

    const result = await service.restoreWindow(savedWindow.id);

    expect(result).toMatchObject({
      failures: [],
      restoredTabCount: 3,
      savedWindowRemoved: false,
      warnings: [
        'The window was restored, but its saved copy could not be removed: Storage unavailable',
      ],
    });
    await expect(service.load()).resolves.toEqual([savedWindow]);
  });

  it('serializes restore claims across app contexts so a snapshot is restored once', async () => {
    const savedWindow = createSavedWindow();
    const fake = createApi([savedWindow]);
    let writeQueue: Promise<void> = Promise.resolve();
    let restoreQueue: Promise<void> = Promise.resolve();
    const withWriteLock = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = writeQueue.then(operation);
      writeQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    const withRestoreLock = <T>(
      _savedWindowId: string,
      operation: () => Promise<T>,
    ): Promise<T> => {
      const result = restoreQueue.then(operation);
      restoreQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    const sharedEnvironment = { ...environment, withRestoreLock, withWriteLock };
    const firstService = createChromeSavedWindowsService(fake.api, sharedEnvironment);
    const secondService = createChromeSavedWindowsService(fake.api, sharedEnvironment);

    const [first, second] = await Promise.allSettled([
      firstService.restoreWindow(savedWindow.id),
      secondService.restoreWindow(savedWindow.id),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(second).toMatchObject({
      reason: new Error('That saved window no longer exists.'),
      status: 'rejected',
    });
    expect(fake.api.windows.create).toHaveBeenCalledTimes(1);
    expect(fake.api.tabs.create).toHaveBeenCalledTimes(3);
    await expect(firstService.load()).resolves.toEqual([]);
  });

  it('salvages valid snapshots, discards invalid values, and exposes a dismissible notice', async () => {
    const savedWindow = createSavedWindow();
    const invalidRecord = { id: 'broken' };
    const fake = createApi();
    fake.state[SAVED_WINDOWS_STORAGE_KEY] = {
      schemaVersion: 1,
      windows: [savedWindow, invalidRecord],
    };
    const service = createChromeSavedWindowsService(fake.api, environment);

    await expect(service.load()).resolves.toEqual([savedWindow]);

    expect(fake.state[SAVED_WINDOWS_STORAGE_KEY]).toEqual({
      schemaVersion: 1,
      windows: [savedWindow],
    });
    expect(fake.state[SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY]).toEqual({
      discardedRecordCount: 1,
      schemaVersion: 1,
    });
    await expect(service.loadCleanupNotice?.()).resolves.toBe(
      'Weaver discarded 1 invalid saved-window record and kept every valid saved window.',
    );

    await service.dismissCleanupNotice?.();
    expect(fake.state[SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY]).toBeNull();
  });

  it('reports when transient restored-tab metadata cannot be stored', async () => {
    const savedWindow = createSavedWindow();
    const fake = createApi([savedWindow]);
    const restoredTabMetadataService: RestoredTabMetadataService = {
      register: vi.fn(() => Promise.reject(new Error('Session storage unavailable'))),
      remove: vi.fn(() => Promise.resolve()),
      resolve: vi.fn(() => Promise.resolve(new Map())),
      subscribe: vi.fn(() => () => undefined),
    };
    const service = createChromeSavedWindowsService(
      fake.api,
      environment,
      restoredTabMetadataService,
    );

    const result = await service.restoreWindow(savedWindow.id);

    expect(result).toMatchObject({
      restoredTabCount: 3,
      savedWindowRemoved: true,
      warnings: [
        'Restored tab titles and URLs could not be retained while pages load: Session storage unavailable',
      ],
    });
  });

  it('focuses a fallback before removing the placeholder without discarding other tabs', async () => {
    const savedWindow = createSavedWindow();
    const fake = createApi([savedWindow]);
    vi.mocked(fake.api.tabs.update).mockImplementation((tabId: number) => {
      fake.callOrder.push(`activate:${tabId}`);
      return tabId === 101
        ? Promise.reject(new Error('Target unavailable'))
        : Promise.resolve(createChromeTab({ active: true, id: tabId, windowId: 9 }));
    });
    const service = createChromeSavedWindowsService(fake.api, environment);

    const result = await service.restoreWindow(savedWindow.id);

    expect(result).toMatchObject({
      restoredTabCount: 3,
      savedWindowRemoved: true,
      warnings: ['The intended active tab could not be selected; another tab was focused.'],
    });
    expect(fake.api.tabs.update).toHaveBeenNthCalledWith(1, 101, { active: true });
    expect(fake.api.tabs.update).toHaveBeenNthCalledWith(2, 100, { active: true });
    expect(fake.callOrder.indexOf('activate:100')).toBeLessThan(
      fake.callOrder.indexOf('remove-placeholder'),
    );
  });

  it('does not discard pending web navigations and retains a failed active file URL for retry', async () => {
    const savedWindow = createSavedWindow({
      groups: [],
      tabs: [
        {
          active: false,
          order: 0,
          pinned: false,
          title: 'Web one',
          url: 'https://one.example.com/',
        },
        {
          active: true,
          order: 1,
          pinned: false,
          title: 'Local file',
          url: 'file:///Users/example/travel.html',
        },
        {
          active: false,
          order: 2,
          pinned: false,
          title: 'Web two',
          url: 'https://two.example.com/',
        },
      ],
    });
    const fake = createApi([savedWindow]);
    const pendingTabs = new Map<number, chrome.tabs.Tab>();
    vi.mocked(fake.api.tabs.create).mockImplementation((properties) => {
      const url = properties.url as string;
      if (url.startsWith('file:')) {
        return Promise.reject(
          new Error('Cannot navigate to a file URL without local file access.'),
        );
      }
      const id = properties.index === 0 ? 100 : 102;
      const tab = createChromeTab({
        id,
        index: properties.index ?? 0,
        pendingUrl: url,
        url: 'about:blank',
        windowId: 9,
      });
      pendingTabs.set(id, tab);
      return Promise.resolve(tab);
    });
    const discard = vi.fn((tabId?: number) => {
      const tab = tabId === undefined ? undefined : pendingTabs.get(tabId);
      if (tab) {
        delete tab.pendingUrl;
        tab.discarded = true;
      }
      return Promise.resolve(tab);
    });
    Object.assign(fake.api.tabs, { discard });
    const service = createChromeSavedWindowsService(fake.api, environment);

    const result = await service.restoreWindow(savedWindow.id);

    expect(result).toEqual({
      destinationWindowId: 9,
      failures: [
        {
          message: 'Cannot navigate to a file URL without local file access.',
          order: 1,
          title: 'Local file',
          url: 'file:///Users/example/travel.html',
        },
      ],
      restoredTabCount: 2,
      savedWindowRemoved: false,
      warnings: [],
    });
    expect(discard).not.toHaveBeenCalled();
    expect([...pendingTabs.values()].map((tab) => tab.pendingUrl)).toEqual([
      'https://one.example.com/',
      'https://two.example.com/',
    ]);
    expect(fake.api.tabs.update).toHaveBeenCalledWith(100, { active: true });
    await expect(service.load()).resolves.toEqual([
      {
        ...savedWindow,
        tabs: [{ ...savedWindow.tabs[1], order: 0 }],
        updatedAt: '2026-07-10T21:00:00.000Z',
      },
    ]);
  });

  it('continues a partial restore, rebuilds available groups, and falls back from a failed active tab', async () => {
    const savedWindow = createSavedWindow();
    const fake = createApi([savedWindow]);
    vi.mocked(fake.api.tabs.create).mockImplementation((properties) => {
      if (properties.url === 'https://docs.example.com/plan') {
        return Promise.reject(new Error('URL blocked'));
      }
      const id = properties.index === 0 ? 100 : 102;
      return Promise.resolve(
        createChromeTab({
          id,
          index: properties.index ?? 0,
          pinned: properties.pinned ?? false,
          url: properties.url as string,
          windowId: 9,
        }),
      );
    });
    const service = createChromeSavedWindowsService(fake.api, environment);

    const result = await service.restoreWindow(savedWindow.id);

    expect(result).toEqual({
      destinationWindowId: 9,
      failures: [
        {
          message: 'URL blocked',
          order: 1,
          title: 'Plan',
          url: 'https://docs.example.com/plan',
        },
      ],
      restoredTabCount: 2,
      savedWindowRemoved: false,
      warnings: [],
    });
    expect(fake.api.tabs.remove).toHaveBeenCalledWith([90]);
    expect(fake.api.tabs.group).toHaveBeenCalledWith({
      createProperties: { windowId: 9 },
      tabIds: [102],
    });
    expect(fake.api.tabGroups.update).toHaveBeenCalledWith(70, {
      collapsed: true,
      color: 'purple',
      title: 'Planning',
    });
    expect(fake.api.tabs.update).toHaveBeenCalledWith(100, { active: true });
    expect(fake.api.windows.update).toHaveBeenCalledWith(9, { focused: true });
    await expect(service.load()).resolves.toEqual([
      {
        ...savedWindow,
        tabs: [
          {
            active: true,
            groupKey: 'group-1',
            order: 0,
            pinned: false,
            title: 'Plan',
            url: 'https://docs.example.com/plan',
          },
        ],
        updatedAt: '2026-07-10T21:00:00.000Z',
      },
    ]);

    const callsBeforeRetry = vi.mocked(fake.api.tabs.create).mock.calls.length;
    vi.mocked(fake.api.tabs.create).mockImplementation((properties) =>
      Promise.resolve(
        createChromeTab({
          id: 200,
          index: properties.index ?? 0,
          pinned: properties.pinned ?? false,
          url: properties.url as string,
          windowId: 9,
        }),
      ),
    );

    await expect(service.restoreWindow(savedWindow.id)).resolves.toMatchObject({
      failures: [],
      restoredTabCount: 1,
      savedWindowRemoved: true,
    });
    expect(
      vi
        .mocked(fake.api.tabs.create)
        .mock.calls.slice(callsBeforeRetry)
        .map(([properties]) => properties.url),
    ).toEqual(['https://docs.example.com/plan']);
    await expect(service.load()).resolves.toEqual([]);
  });

  it('keeps the temporary tab when every saved URL fails', async () => {
    const savedWindow = createSavedWindow();
    const fake = createApi([savedWindow]);
    vi.mocked(fake.api.tabs.create).mockRejectedValue(new Error('URL blocked'));
    const service = createChromeSavedWindowsService(fake.api, environment);

    const result = await service.restoreWindow(savedWindow.id);

    expect(result.restoredTabCount).toBe(0);
    expect(result.savedWindowRemoved).toBe(false);
    expect(result.failures).toHaveLength(3);
    expect(fake.api.tabs.remove).not.toHaveBeenCalled();
    expect(fake.api.tabs.group).not.toHaveBeenCalled();
    expect(fake.api.tabs.update).not.toHaveBeenCalled();
    expect(fake.api.windows.update).toHaveBeenCalledWith(9, { focused: true });
    await expect(service.load()).resolves.toEqual([savedWindow]);
  });

  it('subscribes only to local changes for the saved-window key and cleans up', () => {
    const fake = createApi();
    const service = createChromeSavedWindowsService(fake.api, environment);
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    fake.emit('another-key');
    fake.emit(SAVED_WINDOWS_STORAGE_KEY, 'sync');
    expect(listener).not.toHaveBeenCalled();
    fake.emit();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    fake.emit();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount()).toBe(0);
  });
});
