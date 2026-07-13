import { describe, expect, it, vi } from 'vitest';

import { type RestoredTabMetadataService } from '../../platform/chrome/restoredTabMetadata';
import {
  type ActiveWindowsChromeApi,
  createChromeActiveWindowsService,
} from './chromeActiveWindowsService';

interface FakeChromeEvent<TArgs extends unknown[]> {
  addListener: (listener: (...args: TArgs) => void) => void;
  emit: (...args: TArgs) => void;
  listenerCount: () => number;
  notify: () => void;
  removeListener: (listener: (...args: TArgs) => void) => void;
}

function createFakeChromeEvent<TArgs extends unknown[]>(): FakeChromeEvent<TArgs> {
  const listeners = new Set<(...args: TArgs) => void>();
  return {
    addListener: (listener) => listeners.add(listener),
    emit: (...args) => listeners.forEach((listener) => listener(...args)),
    listenerCount: () => listeners.size,
    notify: () => {
      const args = [] as unknown as TArgs;
      listeners.forEach((listener) => listener(...args));
    },
    removeListener: (listener) => listeners.delete(listener),
  };
}

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

function createChromeGroup(
  overrides: Partial<chrome.tabGroups.TabGroup> = {},
): chrome.tabGroups.TabGroup {
  return {
    collapsed: false,
    color: 'blue',
    id: 7,
    shared: false,
    windowId: 2,
    ...overrides,
  };
}

function createApi() {
  const currentWindow = createChromeWindow({ id: 2 });
  const windows = [
    createChromeWindow({
      id: 1,
      tabs: [
        createChromeTab({
          discarded: true,
          favIconUrl: 'https://example.com/favicon.ico',
          id: 12,
          index: 1,
          title: 'Second tab',
          url: 'https://example.com/second',
        }),
        createChromeTab({
          id: 11,
          index: 0,
          title: 'Chrome settings',
          url: 'chrome://settings/',
        }),
      ],
    }),
    createChromeWindow({
      focused: true,
      id: 2,
      state: 'maximized',
      tabs: [
        createChromeTab({
          active: true,
          groupId: 7,
          id: 21,
          pinned: true,
          title: 'Weaver',
          url: 'chrome-extension://weaver/app.html#/windows',
          windowId: 2,
        }),
      ],
    }),
    createChromeWindow({ id: 3, incognito: true, tabs: [] }),
    createChromeWindow({ id: 4, type: 'popup', tabs: [] }),
  ];
  const groups = [createChromeGroup({ collapsed: true, title: 'Planning' })];

  const tabEvents = {
    onActivated: createFakeChromeEvent<[chrome.tabs.OnActivatedInfo]>(),
    onAttached: createFakeChromeEvent<[number, chrome.tabs.OnAttachedInfo]>(),
    onCreated: createFakeChromeEvent<[chrome.tabs.Tab]>(),
    onDetached: createFakeChromeEvent<[number, chrome.tabs.OnDetachedInfo]>(),
    onMoved: createFakeChromeEvent<[number, chrome.tabs.OnMovedInfo]>(),
    onRemoved: createFakeChromeEvent<[number, chrome.tabs.OnRemovedInfo]>(),
    onReplaced: createFakeChromeEvent<[number, number]>(),
    onUpdated: createFakeChromeEvent<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>(),
  };
  const windowEvents = {
    onCreated: createFakeChromeEvent<[chrome.windows.Window]>(),
    onFocusChanged: createFakeChromeEvent<[number]>(),
    onRemoved: createFakeChromeEvent<[number]>(),
  };
  const groupEvents = {
    onCreated: createFakeChromeEvent<[chrome.tabGroups.TabGroup]>(),
    onMoved: createFakeChromeEvent<[chrome.tabGroups.TabGroup]>(),
    onRemoved: createFakeChromeEvent<[chrome.tabGroups.TabGroup]>(),
    onUpdated: createFakeChromeEvent<[chrome.tabGroups.TabGroup]>(),
  };
  const callOrder: string[] = [];
  let nextCreatedTabId = 101;

  const api: ActiveWindowsChromeApi = {
    runtime: {
      getURL: (path) => `chrome-extension://weaver/${path}`,
    },
    tabGroups: {
      ...groupEvents,
      move: vi.fn((groupId: number) =>
        Promise.resolve(groups.find((group) => group.id === groupId)),
      ),
      query: vi.fn(() => Promise.resolve(groups)),
      update: vi.fn(() => Promise.resolve(undefined)),
    },
    tabs: {
      ...tabEvents,
      create: vi.fn((properties: chrome.tabs.CreateProperties) =>
        Promise.resolve(
          createChromeTab({
            active: properties.active ?? false,
            id: nextCreatedTabId++,
            index: properties.index ?? 0,
            pinned: properties.pinned ?? false,
            url: properties.url,
            windowId: properties.windowId ?? 9,
          }),
        ),
      ),
      discard: vi.fn((tabId?: number) =>
        Promise.resolve(createChromeTab({ discarded: true, id: tabId })),
      ),
      group: vi.fn(() => Promise.resolve(70)),
      move: vi.fn((tabId: number) => Promise.resolve(createChromeTab({ id: tabId }))),
      query: vi.fn(() => Promise.resolve(windows.flatMap((window) => window.tabs ?? []))),
      reload: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
      ungroup: vi.fn(() => Promise.resolve()),
      update: vi.fn(() => {
        callOrder.push('tab');
        return Promise.resolve(undefined);
      }),
    },
    windows: {
      ...windowEvents,
      create: vi.fn(() => Promise.resolve(createChromeWindow({ id: 9, tabs: [] }))),
      getAll: vi.fn(() => Promise.resolve(windows)),
      getCurrent: vi.fn(() => Promise.resolve(currentWindow)),
      remove: vi.fn(() => Promise.resolve()),
      update: vi.fn((windowId: number) => {
        callOrder.push(`window:${windowId}`);
        return Promise.resolve(createChromeWindow({ id: windowId }));
      }),
    },
  };

  return {
    allEvents: [
      tabEvents.onActivated,
      tabEvents.onAttached,
      tabEvents.onCreated,
      tabEvents.onDetached,
      tabEvents.onMoved,
      tabEvents.onRemoved,
      tabEvents.onReplaced,
      ...Object.values(windowEvents),
      ...Object.values(groupEvents),
    ],
    api,
    callOrder,
    tabEvents,
    windows,
  };
}

describe('createChromeActiveWindowsService', () => {
  it('loads normal non-incognito windows with the current window first', async () => {
    const { api } = createApi();
    const service = createChromeActiveWindowsService(api);

    const snapshot = await service.loadSnapshot();

    expect(api.windows.getAll).toHaveBeenCalledWith({
      populate: true,
      windowTypes: ['normal'],
    });
    expect(snapshot.extensionOrigin).toBe('chrome-extension://weaver/');
    expect(snapshot.windows.map((window) => [window.id, window.label])).toEqual([
      [2, 'Window 1'],
      [1, 'Window 2'],
    ]);
    expect(snapshot.totalTabs).toBe(3);
    expect(snapshot.windows[0]).toMatchObject({
      focused: true,
      state: 'maximized',
      groups: [
        {
          collapsed: true,
          color: 'blue',
          id: 7,
          title: 'Planning',
        },
      ],
    });
    expect(snapshot.windows[0]?.tabs[0]).toMatchObject({
      active: true,
      iconUrl: 'chrome-extension://weaver/icons/default-16.png',
      pinned: true,
    });
    expect(snapshot.windows[1]?.tabs.map((tab) => tab.id)).toEqual([11, 12]);
    expect(snapshot.windows[1]?.tabs.map((tab) => tab.iconUrl)).toEqual([
      null,
      'https://example.com/favicon.ico',
    ]);
    expect(snapshot.windows[1]?.tabs.map((tab) => tab.discarded)).toEqual([false, true]);
  });

  it('uses restored metadata in snapshots and sort planning while Chrome metadata is missing', async () => {
    const { api, windows } = createApi();
    const restoredTab = windows[0]?.tabs?.[0];
    if (!restoredTab) {
      throw new Error('Missing restored tab fixture');
    }
    delete restoredTab.title;
    delete restoredTab.url;
    const restoredMetadataService: RestoredTabMetadataService = {
      register: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
      resolve: vi.fn(() =>
        Promise.resolve(
          new Map([[12, { title: 'A restored plan', url: 'https://example.com/restored-plan' }]]),
        ),
      ),
      subscribe: vi.fn(() => () => undefined),
    };
    const service = createChromeActiveWindowsService(api, restoredMetadataService);

    const snapshot = await service.loadSnapshot();
    expect(snapshot.windows[1]?.tabs.find((tab) => tab.id === 12)).toMatchObject({
      title: 'A restored plan',
      url: 'https://example.com/restored-plan',
    });

    await service.sortWindow(1, {
      criterion: 'title',
      direction: 'asc',
      preserveGroups: true,
    });
    expect(api.tabs.move).toHaveBeenCalledWith(12, { index: 0, windowId: 1 });
  });

  it('subscribes once to every relevant Chrome event and removes every listener', () => {
    const { allEvents, api, tabEvents } = createApi();
    const service = createChromeActiveWindowsService(api);
    const listener = vi.fn();

    const unsubscribe = service.subscribe(listener);
    allEvents.forEach((event) => event.notify());
    tabEvents.onUpdated.emit(21, { title: 'Updated title' }, createChromeTab({ id: 21 }));

    expect(listener).toHaveBeenCalledTimes(15);
    expect(allEvents.every((event) => event.listenerCount() === 1)).toBe(true);

    unsubscribe();
    allEvents.forEach((event) => event.notify());
    tabEvents.onUpdated.emit(21, { title: 'Another title' }, createChromeTab({ id: 21 }));
    expect(listener).toHaveBeenCalledTimes(15);
    expect(allEvents.every((event) => event.listenerCount() === 0)).toBe(true);
  });

  it('ignores tab updates that cannot change the active-window snapshot', () => {
    const { api, tabEvents } = createApi();
    const service = createChromeActiveWindowsService(api);
    const listener = vi.fn();
    const tab = createChromeTab({ id: 21 });

    const unsubscribe = service.subscribe(listener);
    tabEvents.onUpdated.emit(21, { status: 'complete' }, tab);
    tabEvents.onUpdated.emit(21, { audible: true }, tab);
    expect(listener).not.toHaveBeenCalled();

    tabEvents.onUpdated.emit(21, { discarded: true }, tab);
    tabEvents.onUpdated.emit(21, { url: 'https://example.com/updated' }, tab);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('refreshes when restored-tab session metadata changes', () => {
    const { api } = createApi();
    const metadataSubscription: { listener?: () => void } = {};
    const restoredMetadataService: RestoredTabMetadataService = {
      register: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
      resolve: vi.fn(() => Promise.resolve(new Map())),
      subscribe: (listener: () => void) => {
        metadataSubscription.listener = listener;
        return () => {
          delete metadataSubscription.listener;
        };
      },
    };
    const service = createChromeActiveWindowsService(api, restoredMetadataService);
    const listener = vi.fn();

    const unsubscribe = service.subscribe(listener);
    expect(metadataSubscription.listener).toBeDefined();
    metadataSubscription.listener?.();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(metadataSubscription.listener).toBeUndefined();
  });

  it('activates a tab before focusing its window so popup callers can complete', async () => {
    const { api, callOrder } = createApi();
    const service = createChromeActiveWindowsService(api);

    await service.focusTab(8, 81);

    expect(callOrder).toEqual(['tab', 'window:8']);
    expect(api.tabs.update).toHaveBeenCalledWith(81, { active: true });
    expect(api.windows.update).toHaveBeenCalledWith(8, { focused: true });
  });

  it('does not focus a window when its target tab cannot be activated', async () => {
    const { api, callOrder } = createApi();
    vi.mocked(api.tabs.update).mockImplementation(() => {
      callOrder.push('tab');
      return Promise.reject(new Error('Tab no longer exists'));
    });
    const service = createChromeActiveWindowsService(api);

    await expect(service.focusTab(8, 81)).rejects.toThrow('Tab no longer exists');

    expect(callOrder).toEqual(['tab']);
    expect(api.windows.update).not.toHaveBeenCalled();
  });

  it('attempts each unique tab close and reports partial failures in request order', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.remove).mockImplementation((tabId) =>
      tabId === 12 ? Promise.reject(new Error('Tab is locked')) : Promise.resolve(),
    );
    const service = createChromeActiveWindowsService(api);

    await expect(service.closeTabs([11, 12, 11])).resolves.toEqual({
      closedTabIds: [11],
      failures: [{ message: 'Tab is locked', tabId: 12 }],
    });
    expect(api.tabs.remove).toHaveBeenCalledTimes(2);
  });

  it('restores closed tabs into original or replacement windows without stealing focus', async () => {
    const { api } = createApi();
    const service = createChromeActiveWindowsService(api);

    await expect(
      service.restoreTabs([
        {
          group: { collapsed: true, color: 'blue', id: 7, title: 'Planning' },
          index: 1,
          originalTabId: 91,
          pinned: false,
          title: 'Existing window tab',
          url: 'https://example.com/existing',
          windowId: 2,
        },
        {
          group: { collapsed: false, color: 'purple', id: 17, title: 'Recovered' },
          index: 0,
          originalTabId: 92,
          pinned: true,
          title: 'Missing window tab',
          url: 'https://example.com/missing',
          windowId: 8,
        },
      ]),
    ).resolves.toEqual({
      failures: [],
      restoredOriginalTabIds: [91, 92],
      restoredTabIds: [101, 102],
      warnings: [],
    });
    expect(api.tabs.create).toHaveBeenNthCalledWith(1, {
      active: false,
      index: 1,
      pinned: false,
      url: 'https://example.com/existing',
      windowId: 2,
    });
    expect(api.windows.create).toHaveBeenCalledWith({ focused: false });
    expect(api.tabs.create).toHaveBeenNthCalledWith(2, {
      active: false,
      index: 0,
      pinned: true,
      url: 'https://example.com/missing',
      windowId: 9,
    });
    expect(api.tabs.group).toHaveBeenNthCalledWith(1, { groupId: 7, tabIds: [101] });
    expect(api.tabs.group).toHaveBeenNthCalledWith(2, {
      createProperties: { windowId: 9 },
      tabIds: [102],
    });
    expect(api.tabGroups.update).toHaveBeenCalledWith(70, {
      collapsed: false,
      color: 'purple',
      title: 'Recovered',
    });
    expect(api.windows.update).not.toHaveBeenCalled();
  });

  it('keeps a replacement window placeholder when every tab restore fails', async () => {
    const { api } = createApi();
    vi.mocked(api.windows.create).mockResolvedValue(
      createChromeWindow({ id: 9, tabs: [createChromeTab({ id: 90, windowId: 9 })] }),
    );
    vi.mocked(api.tabs.create).mockRejectedValue(new Error('URL blocked'));
    const service = createChromeActiveWindowsService(api);

    await expect(
      service.restoreTabs([
        {
          group: null,
          index: 0,
          originalTabId: 92,
          pinned: false,
          title: 'Blocked tab',
          url: 'https://example.com/blocked',
          windowId: 8,
        },
      ]),
    ).resolves.toEqual({
      failures: [{ message: 'URL blocked', originalTabId: 92 }],
      restoredOriginalTabIds: [],
      restoredTabIds: [],
      warnings: [],
    });
    expect(api.tabs.remove).not.toHaveBeenCalled();
  });

  it('moves tabs in requested order and recreates group metadata', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
      createChromeTab({ groupId: 7, id: 22, index: 1, windowId: 2 }),
      createChromeTab({ id: 11, index: 0, windowId: 1 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    const result = await service.moveTabsToNewWindow([999, 21, 22, 11], [7]);

    expect(result).toEqual({
      destinationWindowId: 9,
      failures: [{ message: 'The tab no longer exists.', tabId: 999 }],
      movedTabIds: [21, 22, 11],
      warnings: [],
    });
    expect(api.windows.create).toHaveBeenCalledWith({ focused: false, tabId: 21 });
    expect(api.tabs.move).toHaveBeenNthCalledWith(1, 22, { index: -1, windowId: 9 });
    expect(api.tabs.move).toHaveBeenNthCalledWith(2, 11, { index: -1, windowId: 9 });
    expect(api.tabs.group).toHaveBeenCalledWith({
      createProperties: { windowId: 9 },
      tabIds: [21, 22],
    });
    expect(api.tabGroups.update).toHaveBeenCalledWith(70, {
      collapsed: true,
      color: 'blue',
      title: 'Planning',
    });
    expect(api.windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(api.tabs.ungroup).not.toHaveBeenCalled();
  });

  it('ungroups individually selected tabs before moving them to a new window', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
      createChromeTab({ groupId: 7, id: 22, index: 1, windowId: 2 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabsToNewWindow([21, 22])).resolves.toMatchObject({
      destinationWindowId: 9,
      movedTabIds: [21, 22],
      warnings: [],
    });

    expect(api.tabs.ungroup).toHaveBeenCalledWith([21, 22]);
    expect(api.tabs.group).not.toHaveBeenCalled();
    expect(api.tabGroups.update).not.toHaveBeenCalled();
  });

  it('closes a browser window through the same service boundary', async () => {
    const { api } = createApi();
    const service = createChromeActiveWindowsService(api);

    await service.closeWindow(8);

    expect(api.windows.remove).toHaveBeenCalledWith(8);
  });

  it('suspends and unsuspends each unique tab with partial failure reporting', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.discard).mockImplementation((tabId) =>
      tabId === 12
        ? Promise.resolve(undefined)
        : Promise.resolve(createChromeTab({ discarded: true, id: tabId })),
    );
    vi.mocked(api.tabs.reload).mockImplementation((tabId) =>
      tabId === 12 ? Promise.reject(new Error('Tab is locked')) : Promise.resolve(),
    );
    const service = createChromeActiveWindowsService(api);

    await expect(service.suspendTabs([11, 12, 11])).resolves.toEqual({
      affectedTabIds: [11],
      failures: [
        {
          message: 'Chrome did not suspend the tab. Active tabs cannot be suspended.',
          tabId: 12,
        },
      ],
    });
    await expect(service.unsuspendTabs([11, 12, 11])).resolves.toEqual({
      affectedTabIds: [11],
      failures: [{ message: 'Tab is locked', tabId: 12 }],
    });
    expect(api.tabs.discard).toHaveBeenCalledTimes(2);
    expect(api.tabs.reload).toHaveBeenCalledTimes(2);
  });

  it('sorts grouped runs in place and restores all group metadata', async () => {
    const { api } = createApi();
    vi.mocked(api.windows.getAll).mockResolvedValue([
      createChromeWindow({
        id: 5,
        tabs: [
          createChromeTab({ groupId: 7, id: 51, index: 0, title: 'Zulu', windowId: 5 }),
          createChromeTab({ groupId: 7, id: 52, index: 1, title: 'Alpha', windowId: 5 }),
          createChromeTab({ id: 53, index: 2, title: 'Beta', windowId: 5 }),
        ],
      }),
    ]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ collapsed: true, id: 7, title: 'Planning', windowId: 5 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(
      service.sortWindow(5, {
        criterion: 'title',
        direction: 'asc',
        preserveGroups: true,
      }),
    ).resolves.toEqual({ failures: [], sortedWindowIds: [5], warnings: [] });

    expect(api.tabs.move).toHaveBeenCalledTimes(1);
    expect(api.tabs.move).toHaveBeenCalledWith(52, { index: 0, windowId: 5 });
    expect(api.tabs.group).toHaveBeenCalledWith({
      createProperties: { windowId: 5 },
      tabIds: [51, 52],
    });
    expect(api.tabGroups.update).toHaveBeenCalledWith(70, {
      collapsed: true,
      color: 'blue',
      title: 'Planning',
    });
  });

  it('ungroups tabs before a global sort when preservation is disabled', async () => {
    const { api } = createApi();
    vi.mocked(api.windows.getAll).mockResolvedValue([
      createChromeWindow({
        id: 5,
        tabs: [
          createChromeTab({ groupId: 7, id: 51, index: 0, title: 'Zulu', windowId: 5 }),
          createChromeTab({ id: 52, index: 1, title: 'Alpha', windowId: 5 }),
        ],
      }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await service.sortWindow(5, {
      criterion: 'title',
      direction: 'asc',
      preserveGroups: false,
    });

    expect(api.tabs.ungroup).toHaveBeenCalledWith([51]);
    expect(api.tabs.move).toHaveBeenCalledWith(52, { index: 0, windowId: 5 });
    expect(api.tabs.group).not.toHaveBeenCalled();
  });

  it('merges source windows in selection order and preserves their groups', async () => {
    const { api } = createApi();
    vi.mocked(api.windows.getAll).mockResolvedValue([
      createChromeWindow({ id: 1, tabs: [createChromeTab({ id: 11, windowId: 1 })] }),
      createChromeWindow({
        id: 2,
        tabs: [
          createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
          createChromeTab({ groupId: 7, id: 22, index: 1, windowId: 2 }),
        ],
      }),
      createChromeWindow({ id: 3, tabs: [createChromeTab({ id: 31, windowId: 3 })] }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.mergeWindows([1, 2, 3])).resolves.toEqual({
      destinationWindowId: 1,
      failures: [],
      mergedSourceWindowIds: [2, 3],
      movedTabIds: [21, 22, 31],
      warnings: [],
    });

    expect(api.tabs.move).toHaveBeenNthCalledWith(1, 21, { index: -1, windowId: 1 });
    expect(api.tabs.move).toHaveBeenNthCalledWith(2, 22, { index: -1, windowId: 1 });
    expect(api.tabs.move).toHaveBeenNthCalledWith(3, 31, { index: -1, windowId: 1 });
    expect(api.windows.remove).toHaveBeenCalledWith(2);
    expect(api.windows.remove).toHaveBeenCalledWith(3);
    expect(api.tabs.group).toHaveBeenCalledWith({
      createProperties: { windowId: 1 },
      tabIds: [21, 22],
    });
    expect(api.windows.update).toHaveBeenCalledWith(1, { focused: true });
  });

  it('keeps a partially merged source window open and reports the failed tab', async () => {
    const { api } = createApi();
    vi.mocked(api.windows.getAll).mockResolvedValue([
      createChromeWindow({ id: 1, tabs: [createChromeTab({ id: 11, windowId: 1 })] }),
      createChromeWindow({
        id: 2,
        tabs: [
          createChromeTab({ id: 21, index: 0, windowId: 2 }),
          createChromeTab({ id: 22, index: 1, windowId: 2 }),
        ],
      }),
    ]);
    vi.mocked(api.tabs.move).mockImplementation((tabId) =>
      tabId === 22
        ? Promise.reject(new Error('Tab is locked'))
        : Promise.resolve(createChromeTab({ id: tabId })),
    );
    const service = createChromeActiveWindowsService(api);

    await expect(service.mergeWindows([1, 2])).resolves.toEqual({
      destinationWindowId: 1,
      failures: [{ message: 'Tab is locked', tabId: 22 }],
      mergedSourceWindowIds: [],
      movedTabIds: [21],
      warnings: [],
    });
    expect(api.windows.remove).not.toHaveBeenCalledWith(2);
  });

  it('translates insertion boundaries and keeps unpinned drops after pinned tabs', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ id: 10, index: 0, pinned: true, windowId: 1 }),
      createChromeTab({ id: 11, index: 1, windowId: 1 }),
      createChromeTab({ id: 12, index: 2, windowId: 1 }),
      createChromeTab({ id: 13, index: 3, windowId: 1 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTab(11, 1, 4)).resolves.toEqual({
      destinationIndex: 3,
      destinationWindowId: 1,
      movedTabId: 11,
      warnings: [],
    });
    expect(api.tabs.move).toHaveBeenCalledWith(11, { index: 3, windowId: 1 });

    await expect(service.moveTab(12, 1, 0)).resolves.toMatchObject({ destinationIndex: 1 });
    expect(api.tabs.move).toHaveBeenLastCalledWith(12, { index: 1, windowId: 1 });
  });

  it('ungroups an individual grouped tab when it is dragged across windows', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ id: 11, index: 0, windowId: 1 }),
      createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
    ]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ collapsed: true, id: 7, title: 'Planning', windowId: 2 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTab(21, 1, -1)).resolves.toEqual({
      destinationIndex: 1,
      destinationWindowId: 1,
      movedTabId: 21,
      warnings: [],
    });
    expect(api.tabs.ungroup).toHaveBeenCalledWith(21);
    expect(api.tabs.move).toHaveBeenCalledWith(21, { index: 1, windowId: 1 });
    expect(api.tabs.group).not.toHaveBeenCalled();
    expect(api.tabGroups.update).not.toHaveBeenCalled();
  });

  it('moves a cross-window tab safely before adding it to the destination group', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ id: 10, index: 0, pinned: true, windowId: 1 }),
      createChromeTab({ groupId: 7, id: 11, index: 1, windowId: 1 }),
      createChromeTab({ groupId: 7, id: 12, index: 2, windowId: 1 }),
      createChromeTab({ id: 21, index: 0, windowId: 2 }),
    ]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ id: 7, title: 'Planning', windowId: 1 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTab(21, 1, 2, 7)).resolves.toEqual({
      destinationIndex: 2,
      destinationWindowId: 1,
      movedTabId: 21,
      warnings: [],
    });
    expect(api.tabs.move).toHaveBeenNthCalledWith(1, 21, { index: -1, windowId: 1 });
    expect(api.tabs.group).toHaveBeenCalledWith({ groupId: 7, tabIds: 21 });
    expect(api.tabs.move).toHaveBeenNthCalledWith(2, 21, { index: 2, windowId: 1 });
    expect(api.tabGroups.update).not.toHaveBeenCalled();
  });

  it('reorders a tab already in the destination group without regrouping it', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ id: 10, index: 0, windowId: 1 }),
      createChromeTab({ groupId: 7, id: 11, index: 1, windowId: 1 }),
      createChromeTab({ groupId: 7, id: 12, index: 2, windowId: 1 }),
    ]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ id: 7, title: 'Planning', windowId: 1 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTab(12, 1, 1, 7)).resolves.toMatchObject({
      destinationIndex: 1,
      movedTabId: 12,
    });
    expect(api.tabs.group).not.toHaveBeenCalled();
    expect(api.tabs.move).toHaveBeenCalledWith(12, { index: 1, windowId: 1 });
  });

  it('leaves the sole tab in a one-tab group in place when dropped on itself', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ groupId: 7, id: 11, index: 0, windowId: 1 }),
    ]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ id: 7, title: 'Planning', windowId: 1 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTab(11, 1, 0, 7)).resolves.toEqual({
      destinationIndex: 0,
      destinationWindowId: 1,
      movedTabId: 11,
      warnings: [],
    });
    expect(api.tabs.group).not.toHaveBeenCalled();
    expect(api.tabs.move).not.toHaveBeenCalled();
  });

  it('moves a complete tab group natively and keeps it after destination pinned tabs', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ active: true, id: 11, index: 0, pinned: true, windowId: 1 }),
      createChromeTab({ groupId: 7, id: 22, index: 1, windowId: 2 }),
      createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
    ]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ collapsed: true, id: 7, title: 'Planning', windowId: 2 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabGroup(7, 1, 0)).resolves.toEqual({
      destinationWindowId: 1,
      failures: [],
      movedTabIds: [21, 22],
      warnings: [],
    });
    expect(api.tabGroups.move).toHaveBeenCalledWith(7, { index: 1, windowId: 1 });
    expect(api.tabs.update).toHaveBeenCalledWith(11, { active: true });
    expect(api.tabs.group).not.toHaveBeenCalled();
    expect(api.tabGroups.update).not.toHaveBeenCalled();
  });

  it('does not move a tab group when dropped within its existing run', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ id: 11, index: 0, windowId: 1 }),
      createChromeTab({ groupId: 7, id: 21, index: 1, windowId: 1 }),
      createChromeTab({ groupId: 7, id: 22, index: 2, windowId: 1 }),
      createChromeTab({ id: 12, index: 3, windowId: 1 }),
    ]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ id: 7, title: 'Planning', windowId: 1 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabGroup(7, 1, 2)).resolves.toMatchObject({
      destinationWindowId: 1,
      movedTabIds: [21, 22],
    });
    expect(api.tabGroups.move).not.toHaveBeenCalled();
  });

  it('rejects a tab-group move when Chrome does not return the moved group', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ id: 11, index: 0, windowId: 1 }),
      createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
    ]);
    vi.mocked(api.tabGroups.move).mockResolvedValue(undefined);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabGroup(7, 1, -1)).rejects.toThrow(
      'Chrome did not return the moved tab group.',
    );
  });
});
