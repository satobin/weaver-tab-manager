import { describe, expect, it, vi } from 'vitest';

import { type RestoredTabMetadataService } from '../../platform/chrome/restoredTabMetadata';
import {
  canonicalizeTabUrl,
  type DedupeRule,
  type DuplicateTabGroup,
} from '../deduplication/deduplication';
import {
  type ActiveWindowsChromeApi,
  type CloseDuplicateTabsRequest,
  createChromeActiveWindowsService,
  PINNED_TAB_GROUP_MOVE_ERROR_MESSAGE,
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

const OPENAI_DELIVERABLE_BADGE_MARKER = '<circle cx="24" cy="24" r="7" fill="#22c55e" />';
const OPENAI_HANDOFF_BADGE_MARKER = '<circle cx="24" cy="24" r="7" fill="#facc15" />';

function createOpenAiMarkerUrl(stateMarker = '') {
  const svg = `<svg data-codex-favicon-badge="codex-favicon-badge">${stateMarker}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function createDuplicateGroup(
  duplicateTabIds: readonly number[],
  keepTabIds: readonly number[],
  url: string,
  rules: readonly DedupeRule[] = [],
): DuplicateTabGroup {
  return {
    ...canonicalizeTabUrl(url, rules),
    duplicateTabIds: [...duplicateTabIds],
    keepTabIds: [...keepTabIds],
  };
}

function createCloseDuplicateTabsRequest(
  tabIds: readonly number[],
  duplicateGroups: readonly DuplicateTabGroup[],
  rules: readonly DedupeRule[] = [],
): CloseDuplicateTabsRequest {
  return { duplicateGroups, rules, tabIds };
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
      get: vi.fn((groupId: number) => {
        const group = groups.find((candidate) => candidate.id === groupId);
        return group ? Promise.resolve(group) : Promise.reject(new Error('Group no longer exists'));
      }),
      move: vi.fn((groupId: number, properties: chrome.tabGroups.MoveProperties) => {
        const group = groups.find((candidate) => candidate.id === groupId);
        return Promise.resolve(
          group
            ? {
                ...group,
                windowId: properties.windowId === undefined ? group.windowId : properties.windowId,
              }
            : undefined,
        );
      }),
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
      get: vi.fn((tabId: number) => {
        const tab = windows
          .flatMap((window) => window.tabs ?? [])
          .find((item) => item.id === tabId);
        return tab ? Promise.resolve(tab) : Promise.reject(new Error('Tab no longer exists'));
      }),
      group: vi.fn(() => Promise.resolve(70)),
      move: vi.fn((tabId: number, properties: chrome.tabs.MoveProperties) =>
        Promise.resolve(
          createChromeTab({
            id: tabId,
            index: properties.index,
            windowId: properties.windowId ?? 1,
          }),
        ),
      ),
      query: vi.fn((queryInfo: chrome.tabs.QueryInfo) =>
        Promise.resolve(
          windows
            .flatMap((window) => window.tabs ?? [])
            .filter((tab) =>
              queryInfo.windowId === undefined ? true : tab.windowId === queryInfo.windowId,
            ),
        ),
      ),
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
      create: vi.fn((data?: chrome.windows.CreateData) =>
        Promise.resolve(
          createChromeWindow({
            id: 9,
            tabs:
              data?.tabId === undefined ? [] : [createChromeTab({ id: data.tabId, windowId: 9 })],
          }),
        ),
      ),
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
    const { api, windows } = createApi();
    const unloadedTab = windows[0]?.tabs?.find((tab) => tab.id === 11);
    const frozenTab = windows[0]?.tabs?.find((tab) => tab.id === 12);
    if (!unloadedTab || !frozenTab) {
      throw new Error('Missing sleeping tab fixtures');
    }
    unloadedTab.status = 'unloaded';
    frozenTab.frozen = true;
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
    expect(snapshot.windows[1]?.tabs.map((tab) => tab.frozen)).toEqual([false, true]);
    expect(snapshot.windows[1]?.tabs.map((tab) => tab.unloaded)).toEqual([true, false]);
  });

  it('marks tabs associated with local OpenAI and Claude browser-control signals', async () => {
    const { api, windows } = createApi();
    const openAiTab = windows[0]?.tabs?.find((tab) => tab.id === 12);
    const claudeTab = windows[1]?.tabs?.find((tab) => tab.id === 21);
    if (!openAiTab || !claudeTab) {
      throw new Error('Missing agent-associated tab fixtures');
    }
    openAiTab.favIconUrl = createOpenAiMarkerUrl(OPENAI_DELIVERABLE_BADGE_MARKER);
    claudeTab.groupId = 7;
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ color: 'blue', title: '⌛Nintendo research', windowId: 2 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    const snapshot = await service.loadSnapshot();

    expect(snapshot.windows[0]?.tabs.find((tab) => tab.id === 21)).toMatchObject({
      agentAssociated: true,
      agentDetection: {
        activity: 'working',
        evidence: 'claude-status-group',
        providerHint: 'claude',
      },
    });
    expect(snapshot.windows[1]?.tabs.find((tab) => tab.id === 12)).toMatchObject({
      agentAssociated: true,
      agentDetection: {
        activity: 'output-ready',
        evidence: 'codex-favicon',
        providerHint: 'codex',
      },
    });
    expect(snapshot.windows[1]?.tabs.find((tab) => tab.id === 11)).toMatchObject({
      agentAssociated: false,
      agentDetection: null,
    });
  });

  it('retains Codex association while a loading tab temporarily loses its favicon', async () => {
    const { api, windows } = createApi();
    const openAiTab = windows[0]?.tabs?.find((tab) => tab.id === 12);
    if (!openAiTab) {
      throw new Error('Missing Codex-associated tab fixture');
    }
    openAiTab.favIconUrl = createOpenAiMarkerUrl(OPENAI_DELIVERABLE_BADGE_MARKER);
    openAiTab.status = 'complete';
    const service = createChromeActiveWindowsService(api);

    const detectedSnapshot = await service.loadSnapshot();
    expect(detectedSnapshot.windows[1]?.tabs.find((tab) => tab.id === 12)).toMatchObject({
      agentAssociated: true,
      agentDetection: {
        activity: 'output-ready',
        evidence: 'codex-favicon',
        providerHint: 'codex',
      },
    });

    delete openAiTab.favIconUrl;
    openAiTab.status = 'loading';
    const loadingSnapshot = await service.loadSnapshot();
    expect(loadingSnapshot.windows[1]?.tabs.find((tab) => tab.id === 12)).toMatchObject({
      agentAssociated: true,
      agentDetection: {
        activity: 'output-ready',
        evidence: 'codex-favicon',
        providerHint: 'codex',
      },
    });

    delete openAiTab.status;
    const statusOmittedSnapshot = await service.loadSnapshot();
    expect(statusOmittedSnapshot.windows[1]?.tabs.find((tab) => tab.id === 12)).toMatchObject({
      agentAssociated: true,
      agentDetection: {
        activity: 'output-ready',
        evidence: 'codex-favicon',
        providerHint: 'codex',
      },
    });

    openAiTab.favIconUrl = 'https://example.com/replaced-favicon.ico';
    openAiTab.status = 'complete';
    const stableSnapshot = await service.loadSnapshot();
    expect(stableSnapshot.windows[1]?.tabs.find((tab) => tab.id === 12)).toMatchObject({
      agentAssociated: false,
      agentDetection: null,
    });
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
    tabEvents.onUpdated.emit(21, { audible: true }, tab);
    expect(listener).not.toHaveBeenCalled();

    tabEvents.onUpdated.emit(21, { status: 'unloaded' }, tab);
    tabEvents.onUpdated.emit(21, { discarded: true }, tab);
    tabEvents.onUpdated.emit(21, { frozen: true }, tab);
    tabEvents.onUpdated.emit(21, { url: 'https://example.com/updated' }, tab);
    tabEvents.onUpdated.emit(21, { favIconUrl: createOpenAiMarkerUrl() }, tab);
    expect(listener).toHaveBeenCalledTimes(5);
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

  it('pins a tab through the browser API', async () => {
    const { api } = createApi();
    const service = createChromeActiveWindowsService(api);

    await expect(service.pinTab(21)).resolves.toBeUndefined();

    expect(api.tabs.update).toHaveBeenCalledOnce();
    expect(api.tabs.update).toHaveBeenCalledWith(21, { pinned: true });
  });

  it('propagates a browser failure when pinning a tab', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.update).mockRejectedValue(new Error('Tab no longer exists'));
    const service = createChromeActiveWindowsService(api);

    await expect(service.pinTab(21)).rejects.toThrow('Tab no longer exists');

    expect(api.tabs.update).toHaveBeenCalledOnce();
    expect(api.tabs.update).toHaveBeenCalledWith(21, { pinned: true });
  });

  it('unpins a tab through the browser API', async () => {
    const { api } = createApi();
    const service = createChromeActiveWindowsService(api);

    await expect(service.unpinTab(21)).resolves.toBeUndefined();

    expect(api.tabs.update).toHaveBeenCalledOnce();
    expect(api.tabs.update).toHaveBeenCalledWith(21, { pinned: false });
  });

  it('propagates a browser failure when unpinning a tab', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.update).mockRejectedValue(new Error('Tab no longer exists'));
    const service = createChromeActiveWindowsService(api);

    await expect(service.unpinTab(21)).rejects.toThrow('Tab no longer exists');

    expect(api.tabs.update).toHaveBeenCalledOnce();
    expect(api.tabs.update).toHaveBeenCalledWith(21, { pinned: false });
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

  it('keeps explicit close semantics for a pinned tab', async () => {
    const { api } = createApi();
    const service = createChromeActiveWindowsService(api);

    await expect(service.closeTabs([21])).resolves.toEqual({
      closedTabIds: [21],
      failures: [],
    });
    expect(api.tabs.remove).toHaveBeenCalledWith(21);
    expect(api.tabs.get).not.toHaveBeenCalled();
  });

  it('rechecks duplicate candidates, skips newly pinned tabs, and returns snapshot undo metadata', async () => {
    const { api } = createApi();
    const pinnedCandidateUrl = 'https://example.com/pinned-later';
    const groupedCandidateUrl = 'https://example.com/snapshot';
    const pinnedKeeper = createChromeTab({ id: 91, url: pinnedCandidateUrl, windowId: 1 });
    const groupedKeeper = createChromeTab({ id: 92, url: groupedCandidateUrl, windowId: 2 });
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({
        id: 11,
        index: 0,
        title: 'Candidate that becomes pinned',
        url: pinnedCandidateUrl,
        windowId: 1,
      }),
      createChromeTab({
        groupId: 7,
        id: 21,
        index: 4,
        title: 'Snapshot title',
        url: groupedCandidateUrl,
        windowId: 2,
      }),
    ]);
    vi.mocked(api.tabs.get).mockImplementation((tabId) => {
      if (tabId === 11) {
        return Promise.resolve(
          createChromeTab({
            id: 11,
            index: 0,
            pinned: true,
            title: 'Pinned now',
            url: pinnedCandidateUrl,
            windowId: 1,
          }),
        );
      }
      if (tabId === 91) {
        return Promise.resolve(pinnedKeeper);
      }
      if (tabId === 92) {
        return Promise.resolve(groupedKeeper);
      }
      return Promise.resolve(
        createChromeTab({
          groupId: 7,
          id: 21,
          index: 3,
          title: 'Live title',
          url: groupedCandidateUrl,
          windowId: 2,
        }),
      );
    });
    const service = createChromeActiveWindowsService(api);

    await expect(
      service.closeDuplicateTabs(
        createCloseDuplicateTabsRequest(
          [11, 21, 11],
          [
            createDuplicateGroup([11], [91], pinnedCandidateUrl),
            createDuplicateGroup([21], [92], groupedCandidateUrl),
          ],
        ),
      ),
    ).resolves.toEqual({
      closedTabIds: [21],
      closedTabs: [
        {
          group: { collapsed: true, color: 'blue', id: 7, title: 'Planning' },
          index: 4,
          originalTabId: 21,
          pinned: false,
          title: 'Snapshot title',
          url: 'https://example.com/snapshot',
          windowId: 2,
        },
      ],
      failures: [],
      skippedAgentManagedTabIds: [],
      skippedChangedTabIds: [],
      skippedPinnedTabIds: [11],
    });
    expect(api.tabs.get).toHaveBeenCalledTimes(4);
    expect(api.tabGroups.query).toHaveBeenCalledTimes(1);
    expect(api.tabs.remove).toHaveBeenCalledTimes(1);
    expect(api.tabs.remove).toHaveBeenCalledWith(21);
    expect(vi.mocked(api.tabs.get).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(api.tabs.remove).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('rechecks agent signals immediately before automatic duplicate removal', async () => {
    const { api } = createApi();
    const claudeGroup = createChromeGroup({
      color: 'purple',
      title: '🔔Browser approval',
      windowId: 2,
    });
    const openAiTab = createChromeTab({
      favIconUrl: createOpenAiMarkerUrl(OPENAI_HANDOFF_BADGE_MARKER),
      id: 11,
      title: 'OpenAI controlled',
      url: 'https://example.com/same',
      windowId: 1,
    });
    const claudeTab = createChromeTab({
      groupId: 7,
      id: 21,
      index: 1,
      title: 'Claude controlled',
      url: 'https://example.com/same',
      windowId: 2,
    });
    const ordinaryTab = createChromeTab({
      id: 12,
      index: 2,
      title: 'Ordinary duplicate',
      url: 'https://example.com/same',
      windowId: 1,
    });
    const keeperTab = createChromeTab({
      id: 91,
      title: 'Kept duplicate',
      url: 'https://example.com/same',
      windowId: 1,
    });
    vi.mocked(api.tabs.query).mockResolvedValue([openAiTab, claudeTab, ordinaryTab]);
    vi.mocked(api.tabs.get).mockImplementation((tabId) => {
      const tab = [openAiTab, claudeTab, ordinaryTab, keeperTab].find(
        (candidate) => candidate.id === tabId,
      );
      return tab ? Promise.resolve(tab) : Promise.reject(new Error('Tab no longer exists'));
    });
    vi.mocked(api.tabGroups.query).mockResolvedValue([claudeGroup]);
    vi.mocked(api.tabGroups.get).mockResolvedValue(claudeGroup);
    const service = createChromeActiveWindowsService(api);

    const result = await service.closeDuplicateTabs(
      createCloseDuplicateTabsRequest(
        [11, 21, 12],
        [createDuplicateGroup([11, 21, 12], [91], 'https://example.com/same')],
      ),
    );

    expect(result.closedTabIds).toEqual([12]);
    expect(result.skippedAgentManagedTabIds).toEqual([11, 21]);
    expect(result.skippedChangedTabIds).toEqual([]);
    expect(result.skippedPinnedTabIds).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(api.tabGroups.get).toHaveBeenCalledOnce();
    expect(api.tabs.remove).toHaveBeenCalledOnce();
    expect(api.tabs.remove).toHaveBeenCalledWith(12);
  });

  it('keeps a recently Codex-associated duplicate open when favicon and status are transiently absent', async () => {
    const { api, windows } = createApi();
    const candidate = windows[0]?.tabs?.find((tab) => tab.id === 12);
    if (!candidate || candidate.id === undefined) {
      throw new Error('Missing Codex-associated duplicate fixture');
    }
    const candidateId = candidate.id;
    const duplicateUrl = candidate.url as string;
    candidate.favIconUrl = createOpenAiMarkerUrl();
    candidate.status = 'complete';
    const keeper = createChromeTab({ id: 91, url: duplicateUrl, windowId: 1 });
    const service = createChromeActiveWindowsService(api);
    await service.loadSnapshot();

    delete candidate.favIconUrl;
    delete candidate.status;
    vi.mocked(api.tabs.query).mockResolvedValue([candidate, keeper]);
    vi.mocked(api.tabs.get).mockImplementation((tabId) =>
      Promise.resolve(tabId === candidateId ? candidate : keeper),
    );

    await expect(
      service.closeDuplicateTabs(
        createCloseDuplicateTabsRequest(
          [candidateId],
          [createDuplicateGroup([candidateId], [91], duplicateUrl)],
        ),
      ),
    ).resolves.toEqual({
      closedTabIds: [],
      closedTabs: [],
      failures: [],
      skippedAgentManagedTabIds: [candidateId],
      skippedChangedTabIds: [],
      skippedPinnedTabIds: [],
    });
    expect(api.tabs.remove).not.toHaveBeenCalled();
  });

  it('leaves stale or loading duplicate relationships open', async () => {
    const { api } = createApi();
    const duplicateUrl = 'https://example.com/same';
    const candidateTabs = [11, 12, 13, 14, 15, 16, 17].map((id) =>
      createChromeTab({ id, url: duplicateUrl, windowId: 1 }),
    );
    vi.mocked(api.tabs.query).mockResolvedValue(candidateTabs);
    vi.mocked(api.tabs.get).mockImplementation((tabId) => {
      if (tabId === 11) {
        return Promise.resolve(
          createChromeTab({ id: 11, url: 'https://example.com/navigated', windowId: 1 }),
        );
      }
      if (tabId === 12) {
        return Promise.resolve(
          createChromeTab({ id: 12, status: 'loading', url: duplicateUrl, windowId: 1 }),
        );
      }
      if (tabId === 13 || tabId === 14 || tabId === 15) {
        return Promise.resolve(createChromeTab({ id: tabId, url: duplicateUrl, windowId: 1 }));
      }
      if (tabId === 16) {
        return Promise.resolve(
          createChromeTab({
            id: 16,
            pendingUrl: 'https://example.com/candidate-navigating',
            url: duplicateUrl,
            windowId: 1,
          }),
        );
      }
      if (tabId === 17) {
        return Promise.resolve(createChromeTab({ id: 17, url: duplicateUrl, windowId: 1 }));
      }
      if (tabId === 91 || tabId === 92) {
        return Promise.resolve(createChromeTab({ id: tabId, url: duplicateUrl, windowId: 1 }));
      }
      if (tabId === 93) {
        return Promise.resolve(
          createChromeTab({ id: 93, url: 'https://example.com/keeper-navigated', windowId: 1 }),
        );
      }
      if (tabId === 94) {
        return Promise.resolve(
          createChromeTab({ id: 94, status: 'loading', url: duplicateUrl, windowId: 1 }),
        );
      }
      if (tabId === 96) {
        return Promise.resolve(
          createChromeTab({
            id: 96,
            pendingUrl: 'https://example.com/keeper-navigating',
            url: duplicateUrl,
            windowId: 1,
          }),
        );
      }
      return Promise.reject(new Error('Keeper no longer exists'));
    });
    const service = createChromeActiveWindowsService(api);

    await expect(
      service.closeDuplicateTabs(
        createCloseDuplicateTabsRequest(
          [11, 12, 13, 14, 15, 16, 17],
          [
            createDuplicateGroup([11], [91], duplicateUrl),
            createDuplicateGroup([12], [92], duplicateUrl),
            createDuplicateGroup([13], [93], duplicateUrl),
            createDuplicateGroup([14], [94], duplicateUrl),
            createDuplicateGroup([15], [95], duplicateUrl),
            createDuplicateGroup([16], [91], duplicateUrl),
            createDuplicateGroup([17], [96], duplicateUrl),
          ],
        ),
      ),
    ).resolves.toEqual({
      closedTabIds: [],
      closedTabs: [],
      failures: [],
      skippedAgentManagedTabIds: [],
      skippedChangedTabIds: [11, 12, 13, 14, 15, 16, 17],
      skippedPinnedTabIds: [],
    });
    expect(api.tabs.remove).not.toHaveBeenCalled();
  });

  it('uses restored metadata in duplicate undo records when Chrome metadata is missing', async () => {
    const { api } = createApi();
    const restoredTab = createChromeTab({ id: 12, index: 2, windowId: 1 });
    delete restoredTab.title;
    delete restoredTab.url;
    vi.mocked(api.tabs.query).mockResolvedValue([restoredTab]);
    const recoveredUrl = 'https://example.com/recovered';
    vi.mocked(api.tabs.get).mockImplementation((tabId) =>
      Promise.resolve(
        tabId === 91
          ? createChromeTab({ id: 91, url: recoveredUrl, windowId: 1 })
          : createChromeTab({ ...restoredTab, title: 'Recovered title', url: recoveredUrl }),
      ),
    );
    const restoredMetadataService: RestoredTabMetadataService = {
      register: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
      resolve: vi.fn(() =>
        Promise.resolve(
          new Map([[12, { title: 'Recovered title', url: 'https://example.com/recovered' }]]),
        ),
      ),
      subscribe: vi.fn(() => () => undefined),
    };
    const service = createChromeActiveWindowsService(api, restoredMetadataService);

    await expect(
      service.closeDuplicateTabs(
        createCloseDuplicateTabsRequest([12], [createDuplicateGroup([12], [91], recoveredUrl)]),
      ),
    ).resolves.toEqual({
      closedTabIds: [12],
      closedTabs: [
        {
          group: null,
          index: 2,
          originalTabId: 12,
          pinned: false,
          title: 'Recovered title',
          url: 'https://example.com/recovered',
          windowId: 1,
        },
      ],
      failures: [],
      skippedAgentManagedTabIds: [],
      skippedChangedTabIds: [],
      skippedPinnedTabIds: [],
    });
    expect(restoredMetadataService.resolve).toHaveBeenCalledWith([restoredTab], {
      pruneMissing: false,
    });
  });

  it('captures every duplicate undo index before concurrent removals can shift later tabs', async () => {
    const { api } = createApi();
    const firstTab = createChromeTab({
      id: 11,
      index: 1,
      title: 'First duplicate',
      url: 'https://example.com/duplicate',
      windowId: 1,
    });
    const secondTab = createChromeTab({
      id: 12,
      index: 2,
      title: 'Second duplicate',
      url: 'https://example.com/duplicate',
      windowId: 1,
    });
    vi.mocked(api.tabs.query).mockResolvedValue([firstTab, secondTab]);
    let resolveSecondGet: ((tab: chrome.tabs.Tab) => void) | undefined;
    const secondGet = new Promise<chrome.tabs.Tab>((resolve) => {
      resolveSecondGet = resolve;
    });
    const keeperTab = createChromeTab({
      id: 91,
      url: 'https://example.com/duplicate',
      windowId: 1,
    });
    vi.mocked(api.tabs.get).mockImplementation((tabId) => {
      if (tabId === 11) {
        return Promise.resolve(firstTab);
      }
      if (tabId === 91) {
        return Promise.resolve(keeperTab);
      }
      return secondGet;
    });
    vi.mocked(api.tabs.remove).mockImplementation((tabId) => {
      if (tabId === 11) {
        resolveSecondGet?.(createChromeTab({ ...secondTab, index: 1 }));
      }
      return Promise.resolve();
    });
    const service = createChromeActiveWindowsService(api);

    const result = await service.closeDuplicateTabs(
      createCloseDuplicateTabsRequest(
        [11, 12],
        [createDuplicateGroup([11, 12], [91], 'https://example.com/duplicate')],
      ),
    );

    expect(result.closedTabIds).toEqual([11, 12]);
    expect(result.closedTabs.map((tab) => tab.index)).toEqual([1, 2]);
    expect(api.tabs.remove).toHaveBeenCalledTimes(2);
  });

  it('reports stale candidates and removal failures in request order with undo for closures only', async () => {
    const { api } = createApi();
    const snapshotTabs = [
      createChromeTab({ id: 11, index: 0, title: 'Closes', url: 'https://example.com/same' }),
      createChromeTab({ id: 12, index: 1, title: 'Missing', url: 'https://example.com/same' }),
      createChromeTab({ id: 13, index: 2, title: 'Locked', url: 'https://example.com/same' }),
    ];
    vi.mocked(api.tabs.query).mockResolvedValue(snapshotTabs);
    vi.mocked(api.tabs.get).mockImplementation((tabId) => {
      if (tabId === 12) {
        return Promise.reject(new Error('Tab no longer exists'));
      }
      if (tabId === 91) {
        return Promise.resolve(
          createChromeTab({ id: 91, url: 'https://example.com/same', windowId: 1 }),
        );
      }
      const tab = snapshotTabs.find((candidate) => candidate.id === tabId);
      return tab ? Promise.resolve(tab) : Promise.reject(new Error('Unexpected tab'));
    });
    vi.mocked(api.tabs.remove).mockImplementation((tabId) =>
      tabId === 13 ? Promise.reject(new Error('Tab is locked')) : Promise.resolve(),
    );
    const service = createChromeActiveWindowsService(api);

    await expect(
      service.closeDuplicateTabs(
        createCloseDuplicateTabsRequest(
          [11, 12, 13],
          [createDuplicateGroup([11, 12, 13], [91], 'https://example.com/same')],
        ),
      ),
    ).resolves.toEqual({
      closedTabIds: [11],
      closedTabs: [
        {
          group: null,
          index: 0,
          originalTabId: 11,
          pinned: false,
          title: 'Closes',
          url: 'https://example.com/same',
          windowId: 1,
        },
      ],
      failures: [{ message: 'Tab is locked', tabId: 13 }],
      skippedAgentManagedTabIds: [],
      skippedChangedTabIds: [12],
      skippedPinnedTabIds: [],
    });
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

  it('moves a complete Claude-associated group natively into a blank new window', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query)
      .mockResolvedValueOnce([
        createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
        createChromeTab({ groupId: 7, id: 22, index: 1, windowId: 2 }),
      ])
      .mockResolvedValueOnce([createChromeTab({ id: 90, windowId: 9 })])
      .mockResolvedValueOnce([
        createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 9 }),
        createChromeTab({ groupId: 7, id: 22, index: 1, windowId: 9 }),
      ]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ color: 'orange', id: 7, title: 'Claude', windowId: 2 }),
    ]);
    vi.mocked(api.tabGroups.move).mockResolvedValue(
      createChromeGroup({ color: 'orange', id: 7, title: 'Claude', windowId: 9 }),
    );
    vi.mocked(api.windows.create).mockResolvedValue(createChromeWindow({ id: 9 }));
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabsToNewWindow([21, 22])).resolves.toEqual({
      destinationWindowId: 9,
      failures: [],
      movedTabIds: [21, 22],
      warnings: [],
    });

    expect(api.windows.create).toHaveBeenCalledWith({ focused: false });
    expect(api.tabGroups.move).toHaveBeenCalledOnce();
    expect(api.tabGroups.move).toHaveBeenCalledWith(7, { index: -1, windowId: 9 });
    expect(api.tabs.remove).toHaveBeenCalledWith(90);
    expect(api.tabs.move).not.toHaveBeenCalled();
    expect(api.tabs.ungroup).not.toHaveBeenCalled();
    expect(api.tabs.group).not.toHaveBeenCalled();
    expect(api.tabGroups.update).not.toHaveBeenCalled();
  });

  it('fails a native agent-group move when a member does not reach the new window', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query)
      .mockResolvedValueOnce([
        createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
        createChromeTab({ groupId: 7, id: 22, index: 1, windowId: 2 }),
      ])
      .mockResolvedValueOnce([createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 9 })]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ color: 'orange', id: 7, title: 'Claude', windowId: 2 }),
    ]);
    vi.mocked(api.tabGroups.move).mockResolvedValue(
      createChromeGroup({ color: 'orange', id: 7, title: 'Claude', windowId: 9 }),
    );
    vi.mocked(api.windows.create).mockResolvedValue(
      createChromeWindow({ id: 9, tabs: [createChromeTab({ id: 90, windowId: 9 })] }),
    );
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabsToNewWindow([21, 22])).resolves.toEqual({
      destinationWindowId: 9,
      failures: [
        { message: 'Tab 22 did not move with agent-associated group 7.', tabId: 21 },
        { message: 'Tab 22 did not move with agent-associated group 7.', tabId: 22 },
      ],
      movedTabIds: [],
      warnings: [],
    });

    expect(api.tabs.remove).not.toHaveBeenCalledWith(90);
    expect(api.tabs.group).not.toHaveBeenCalled();
  });

  it('rejects moving only part of a Claude-associated group to a new window', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
      createChromeTab({ groupId: 7, id: 22, index: 1, windowId: 2 }),
    ]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ color: 'orange', id: 7, title: 'Claude', windowId: 2 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabsToNewWindow([21])).resolves.toEqual({
      destinationWindowId: null,
      failures: [
        {
          message: 'Agent-associated tab groups must be moved as a whole.',
          tabId: 21,
        },
      ],
      movedTabIds: [],
      warnings: [],
    });

    expect(api.windows.create).not.toHaveBeenCalled();
    expect(api.tabGroups.move).not.toHaveBeenCalled();
    expect(api.tabs.move).not.toHaveBeenCalled();
    expect(api.tabs.ungroup).not.toHaveBeenCalled();
  });

  it('leaves a grouped tab in place when its latest group metadata is unavailable', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
    ]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabsToNewWindow([21])).resolves.toEqual({
      destinationWindowId: null,
      failures: [
        {
          message: 'The latest tab group state could not be read, so the tab was left in place.',
          tabId: 21,
        },
      ],
      movedTabIds: [],
      warnings: [],
    });

    expect(api.tabs.ungroup).not.toHaveBeenCalled();
    expect(api.windows.create).not.toHaveBeenCalled();
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

    expect(api.tabs.ungroup).toHaveBeenCalledWith([22]);
    expect(api.tabs.group).not.toHaveBeenCalled();
    expect(api.tabGroups.update).not.toHaveBeenCalled();
  });

  it('does not ungroup source tabs when new-window creation fails', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
      createChromeTab({ groupId: 7, id: 22, index: 1, windowId: 2 }),
    ]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ id: 7, title: 'Planning', windowId: 2 }),
    ]);
    vi.mocked(api.windows.create).mockRejectedValue(new Error('Window creation blocked'));
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabsToNewWindow([21, 22])).rejects.toThrow('Window creation blocked');

    expect(api.tabs.ungroup).not.toHaveBeenCalled();
    expect(api.tabs.move).not.toHaveBeenCalled();
  });

  it('reports an ungroup failure after recording an adopted first tab', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
      createChromeTab({ groupId: 7, id: 22, index: 1, windowId: 2 }),
    ]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ id: 7, title: 'Planning', windowId: 2 }),
    ]);
    vi.mocked(api.tabs.ungroup).mockRejectedValue(new Error('Group is being updated'));
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabsToNewWindow([21, 22])).resolves.toEqual({
      destinationWindowId: 9,
      failures: [
        {
          message: 'The tab could not be ungrouped before moving: Group is being updated',
          tabId: 22,
        },
      ],
      movedTabIds: [21],
      warnings: [],
    });

    expect(api.windows.create).toHaveBeenCalledWith({ focused: false, tabId: 21 });
    expect(api.tabs.move).not.toHaveBeenCalled();
  });

  it('does not record a new-window adoption that Chrome reports in another window', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ id: 21, index: 0, windowId: 2 }),
    ]);
    vi.mocked(api.windows.create).mockResolvedValue(
      createChromeWindow({ id: 9, tabs: [createChromeTab({ id: 21, windowId: 2 })] }),
    );
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabsToNewWindow([21])).resolves.toEqual({
      destinationWindowId: 9,
      failures: [{ message: 'Tab 21 did not reach the destination window.', tabId: 21 }],
      movedTabIds: [],
      warnings: [],
    });
    expect(api.tabs.group).not.toHaveBeenCalled();
  });

  it('stable-partitions pinned tabs into a new window and restores their pin state', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query)
      .mockResolvedValueOnce([
        createChromeTab({ id: 21, index: 0, windowId: 2 }),
        createChromeTab({ id: 22, index: 1, pinned: true, windowId: 2 }),
        createChromeTab({ id: 23, index: 2, pinned: true, windowId: 2 }),
        createChromeTab({ id: 24, index: 3, windowId: 2 }),
      ])
      .mockResolvedValueOnce([createChromeTab({ id: 22, index: 0, pinned: true, windowId: 9 })])
      .mockResolvedValueOnce([
        createChromeTab({ id: 22, index: 0, pinned: true, windowId: 9 }),
        createChromeTab({ id: 23, index: 1, pinned: true, windowId: 9 }),
      ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabsToNewWindow([21, 22, 23, 24])).resolves.toEqual({
      destinationWindowId: 9,
      failures: [],
      movedTabIds: [22, 23, 21, 24],
      warnings: [],
    });

    expect(api.windows.create).toHaveBeenCalledWith({ focused: false, tabId: 22 });
    expect(api.tabs.move).toHaveBeenNthCalledWith(1, 23, { index: -1, windowId: 9 });
    expect(api.tabs.move).toHaveBeenNthCalledWith(2, 21, { index: -1, windowId: 9 });
    expect(api.tabs.move).toHaveBeenNthCalledWith(3, 24, { index: -1, windowId: 9 });
    expect(api.tabs.update).toHaveBeenCalledWith(22, { pinned: true });
    expect(api.tabs.update).toHaveBeenCalledWith(23, { pinned: true });
  });

  it('reports re-pin failures as warnings without hiding successful cross-window moves', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query)
      .mockResolvedValueOnce([
        createChromeTab({ id: 21, index: 0, pinned: true, windowId: 2 }),
        createChromeTab({ id: 22, index: 1, pinned: true, windowId: 2 }),
        createChromeTab({ id: 23, index: 2, windowId: 2 }),
      ])
      .mockResolvedValueOnce([createChromeTab({ id: 21, index: 0, pinned: true, windowId: 9 })]);
    vi.mocked(api.tabs.update).mockImplementation((tabId, properties) =>
      tabId === 22 && properties.pinned
        ? Promise.reject(new Error('Pinning is temporarily unavailable'))
        : Promise.resolve(undefined),
    );
    vi.mocked(api.tabs.move).mockImplementation((tabId) =>
      tabId === 23
        ? Promise.reject(new Error('Tab is locked'))
        : Promise.resolve(createChromeTab({ id: tabId, windowId: 9 })),
    );
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabsToNewWindow([21, 22, 23])).resolves.toEqual({
      destinationWindowId: 9,
      failures: [{ message: 'Tab is locked', tabId: 23 }],
      movedTabIds: [21, 22],
      warnings: [
        'Tab 22 moved, but its pinned state could not be restored: Pinning is temporarily unavailable',
      ],
    });

    expect(api.tabs.update).toHaveBeenCalledWith(21, { pinned: true });
    expect(api.tabs.update).toHaveBeenCalledWith(22, { pinned: true });
    expect(api.tabs.move).toHaveBeenCalledWith(22, { index: -1, windowId: 9 });
  });

  it('positions later pinned tabs after only the pins that were successfully restored', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query)
      .mockResolvedValueOnce([
        createChromeTab({ id: 21, index: 0, pinned: true, windowId: 2 }),
        createChromeTab({ id: 22, index: 1, pinned: true, windowId: 2 }),
        createChromeTab({ id: 23, index: 2, windowId: 2 }),
      ])
      .mockResolvedValueOnce([createChromeTab({ id: 22, index: 0, pinned: true, windowId: 9 })]);
    vi.mocked(api.tabs.update).mockImplementation((tabId, properties) =>
      tabId === 21 && properties.pinned
        ? Promise.reject(new Error('First pin could not be restored'))
        : Promise.resolve(undefined),
    );
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabsToNewWindow([21, 22, 23])).resolves.toEqual({
      destinationWindowId: 9,
      failures: [],
      movedTabIds: [21, 22, 23],
      warnings: [
        'Tab 21 moved, but its pinned state could not be restored: First pin could not be restored',
      ],
    });

    expect(api.tabs.move).toHaveBeenNthCalledWith(1, 22, { index: -1, windowId: 9 });
    expect(api.tabs.move).toHaveBeenNthCalledWith(2, 23, { index: -1, windowId: 9 });
    expect(api.tabs.move).not.toHaveBeenCalledWith(22, { index: 1, windowId: 9 });
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
          message: 'The browser did not suspend the tab. Active tabs cannot be suspended.',
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

  it('wakes frozen tabs, reloads unloaded tabs, and restores the previously active tab', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ active: true, id: 10, windowId: 1 }),
      createChromeTab({ frozen: true, id: 11, windowId: 1 }),
      createChromeTab({ id: 12, status: 'unloaded', windowId: 1 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.unsuspendTabs([11, 12])).resolves.toEqual({
      affectedTabIds: [11, 12],
      failures: [],
    });

    expect(api.tabs.update).toHaveBeenCalledWith(11, { active: true });
    expect(api.tabs.update).toHaveBeenCalledWith(10, { active: true });
    expect(api.tabs.reload).toHaveBeenCalledWith(12);
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

  it('sorts only the unpinned suffix without moving the pinned prefix', async () => {
    const { api } = createApi();
    vi.mocked(api.windows.getAll).mockResolvedValue([
      createChromeWindow({
        id: 5,
        tabs: [
          createChromeTab({ id: 51, index: 0, pinned: true, title: 'Zulu', windowId: 5 }),
          createChromeTab({ id: 52, index: 1, pinned: true, title: 'Alpha', windowId: 5 }),
          createChromeTab({ id: 53, index: 2, title: 'Zulu unpinned', windowId: 5 }),
          createChromeTab({ id: 54, index: 3, title: 'Alpha unpinned', windowId: 5 }),
        ],
      }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(
      service.sortWindow(5, {
        criterion: 'title',
        direction: 'asc',
        preserveGroups: false,
      }),
    ).resolves.toEqual({ failures: [], sortedWindowIds: [5], warnings: [] });

    expect(api.tabs.move).toHaveBeenCalledTimes(1);
    expect(api.tabs.move).toHaveBeenCalledWith(54, { index: 2, windowId: 5 });
    expect(api.tabs.move).not.toHaveBeenCalledWith(51, expect.anything());
    expect(api.tabs.move).not.toHaveBeenCalledWith(52, expect.anything());
  });

  it('uses the displayed fallback title when Chrome reports a blank title', async () => {
    const { api } = createApi();
    vi.mocked(api.windows.getAll).mockResolvedValue([
      createChromeWindow({
        id: 5,
        tabs: [
          createChromeTab({
            id: 51,
            index: 0,
            title: '   ',
            url: 'https://zulu.example/',
            windowId: 5,
          }),
          createChromeTab({
            id: 52,
            index: 1,
            title: 'Alpha',
            url: 'https://alpha.example/',
            windowId: 5,
          }),
        ],
      }),
    ]);
    const service = createChromeActiveWindowsService(api);

    const snapshot = await service.loadSnapshot();
    expect(snapshot.windows[0]?.tabs[0]?.title).toBe('https://zulu.example/');

    await service.sortWindow(5, {
      criterion: 'title',
      direction: 'asc',
      preserveGroups: false,
    });

    expect(api.tabs.move).toHaveBeenCalledWith(52, { index: 0, windowId: 5 });
  });

  it.each([false, true])(
    'keeps a Claude-associated group intact while sorting ordinary tabs (preserveGroups: %s)',
    async (preserveGroups) => {
      const { api } = createApi();
      vi.mocked(api.windows.getAll).mockResolvedValue([
        createChromeWindow({
          id: 5,
          tabs: [
            createChromeTab({ id: 51, index: 0, title: 'Zulu before', windowId: 5 }),
            createChromeTab({ id: 52, index: 1, title: 'Alpha before', windowId: 5 }),
            createChromeTab({
              groupId: 7,
              id: 53,
              index: 2,
              title: 'Zulu agent',
              windowId: 5,
            }),
            createChromeTab({
              groupId: 7,
              id: 54,
              index: 3,
              title: 'Alpha agent',
              windowId: 5,
            }),
            createChromeTab({ id: 55, index: 4, title: 'Zulu after', windowId: 5 }),
            createChromeTab({ id: 56, index: 5, title: 'Alpha after', windowId: 5 }),
          ],
        }),
      ]);
      vi.mocked(api.tabGroups.query).mockResolvedValue([
        createChromeGroup({ color: 'orange', id: 7, title: 'Claude', windowId: 5 }),
      ]);
      const service = createChromeActiveWindowsService(api);

      await expect(
        service.sortWindow(5, {
          criterion: 'title',
          direction: 'asc',
          preserveGroups,
        }),
      ).resolves.toEqual({ failures: [], sortedWindowIds: [5], warnings: [] });

      expect(api.tabs.move).toHaveBeenCalledTimes(2);
      expect(api.tabs.move).toHaveBeenNthCalledWith(1, 52, { index: 0, windowId: 5 });
      expect(api.tabs.move).toHaveBeenNthCalledWith(2, 56, { index: 4, windowId: 5 });
      expect(api.tabs.move).not.toHaveBeenCalledWith(53, expect.anything());
      expect(api.tabs.move).not.toHaveBeenCalledWith(54, expect.anything());
      expect(api.tabs.ungroup).not.toHaveBeenCalled();
      expect(api.tabs.group).not.toHaveBeenCalled();
      expect(api.tabGroups.move).not.toHaveBeenCalled();
      expect(api.tabGroups.update).not.toHaveBeenCalled();
    },
  );

  it('rechecks each window for newly agent-associated groups during a global sort', async () => {
    const { api } = createApi();
    vi.mocked(api.windows.getAll).mockResolvedValue([
      createChromeWindow({
        id: 5,
        tabs: [createChromeTab({ id: 51, index: 0, title: 'Alpha', windowId: 5 })],
      }),
      createChromeWindow({
        id: 6,
        tabs: [
          createChromeTab({ groupId: 8, id: 61, index: 0, title: 'Zulu', windowId: 6 }),
          createChromeTab({ groupId: 8, id: 62, index: 1, title: 'Alpha', windowId: 6 }),
        ],
      }),
    ]);
    vi.mocked(api.tabGroups.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createChromeGroup({ color: 'orange', id: 8, title: 'Claude', windowId: 6 }),
      ]);
    const service = createChromeActiveWindowsService(api);

    await expect(
      service.sortAllWindows({
        criterion: 'title',
        direction: 'asc',
        preserveGroups: false,
      }),
    ).resolves.toEqual({ failures: [], sortedWindowIds: [5, 6], warnings: [] });

    expect(api.tabGroups.query).toHaveBeenNthCalledWith(1, { windowId: 5 });
    expect(api.tabGroups.query).toHaveBeenNthCalledWith(2, { windowId: 6 });
    expect(api.tabs.ungroup).not.toHaveBeenCalled();
    expect(api.tabs.move).not.toHaveBeenCalledWith(61, expect.anything());
    expect(api.tabs.move).not.toHaveBeenCalledWith(62, expect.anything());
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
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ id: 7, title: 'Planning', windowId: 5 }),
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

  it('does not sort a grouped window when its latest group metadata is unavailable', async () => {
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
    vi.mocked(api.tabGroups.query).mockResolvedValue([]);
    const service = createChromeActiveWindowsService(api);

    await expect(
      service.sortWindow(5, {
        criterion: 'title',
        direction: 'asc',
        preserveGroups: false,
      }),
    ).resolves.toEqual({
      failures: [
        {
          message: 'The latest tab group state could not be read, so the window was not sorted.',
          windowId: 5,
        },
      ],
      sortedWindowIds: [],
      warnings: [],
    });

    expect(api.tabs.ungroup).not.toHaveBeenCalled();
    expect(api.tabs.move).not.toHaveBeenCalled();
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
    vi.mocked(api.tabs.query).mockResolvedValue([]);
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
    expect(api.windows.remove).not.toHaveBeenCalled();
    expect(api.tabs.group).toHaveBeenCalledWith({
      createProperties: { windowId: 1 },
      tabIds: [21, 22],
    });
    expect(api.windows.update).toHaveBeenCalledWith(1, { focused: true });
  });

  it('moves a Claude-associated group natively while merging windows', async () => {
    const { api } = createApi();
    const destinationWindow = createChromeWindow({
      id: 1,
      tabs: [createChromeTab({ active: true, id: 11, windowId: 1 })],
    });
    const liveSourceWindow = createChromeWindow({
      id: 2,
      tabs: [
        createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
        createChromeTab({ groupId: 7, id: 22, index: 1, windowId: 2 }),
      ],
    });
    vi.mocked(api.windows.getAll)
      .mockResolvedValueOnce([
        destinationWindow,
        createChromeWindow({
          id: 2,
          tabs: [
            createChromeTab({ id: 21, index: 0, windowId: 2 }),
            createChromeTab({ id: 22, index: 1, windowId: 2 }),
          ],
        }),
      ])
      .mockResolvedValue([destinationWindow, liveSourceWindow]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ color: 'orange', id: 7, title: 'Claude', windowId: 2 }),
    ]);
    vi.mocked(api.tabGroups.move).mockResolvedValue(
      createChromeGroup({ color: 'orange', id: 7, title: 'Claude', windowId: 1 }),
    );
    vi.mocked(api.tabs.query)
      .mockResolvedValueOnce([
        createChromeTab({ id: 11, index: 0, windowId: 1 }),
        createChromeTab({ groupId: 7, id: 21, index: 1, windowId: 1 }),
        createChromeTab({ groupId: 7, id: 22, index: 2, windowId: 1 }),
      ])
      .mockResolvedValueOnce([]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.mergeWindows([1, 2])).resolves.toEqual({
      destinationWindowId: 1,
      failures: [],
      mergedSourceWindowIds: [2],
      movedTabIds: [21, 22],
      warnings: [],
    });

    expect(api.tabGroups.move).toHaveBeenCalledOnce();
    expect(api.tabGroups.move).toHaveBeenCalledWith(7, { index: -1, windowId: 1 });
    expect(api.tabs.move).not.toHaveBeenCalled();
    expect(api.tabs.group).not.toHaveBeenCalled();
    expect(api.tabGroups.update).not.toHaveBeenCalled();
    expect(api.tabs.update).toHaveBeenCalledWith(11, { active: true });
    expect(api.windows.remove).not.toHaveBeenCalled();
  });

  it('leaves a source window open when a new tab arrives during a merge', async () => {
    const { api } = createApi();
    vi.mocked(api.windows.getAll).mockResolvedValue([
      createChromeWindow({ id: 1, tabs: [createChromeTab({ id: 11, windowId: 1 })] }),
      createChromeWindow({ id: 2, tabs: [createChromeTab({ id: 21, windowId: 2 })] }),
    ]);
    vi.mocked(api.tabs.query).mockResolvedValue([createChromeTab({ id: 99, windowId: 2 })]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.mergeWindows([1, 2])).resolves.toEqual({
      destinationWindowId: 1,
      failures: [],
      mergedSourceWindowIds: [],
      movedTabIds: [21],
      warnings: ['Window 2 still has tabs after the merge and was left open.'],
    });

    expect(api.windows.remove).not.toHaveBeenCalled();
  });

  it('preserves pinned and unpinned relative order while merging multiple windows', async () => {
    const { api } = createApi();
    vi.mocked(api.windows.getAll).mockResolvedValue([
      createChromeWindow({
        id: 1,
        tabs: [
          createChromeTab({ id: 10, index: 0, pinned: true, windowId: 1 }),
          createChromeTab({ id: 11, index: 1, windowId: 1 }),
        ],
      }),
      createChromeWindow({
        id: 2,
        tabs: [
          createChromeTab({ id: 20, index: 0, pinned: true, windowId: 2 }),
          createChromeTab({ id: 21, index: 1, windowId: 2 }),
        ],
      }),
      createChromeWindow({
        id: 3,
        tabs: [
          createChromeTab({ id: 30, index: 0, pinned: true, windowId: 3 }),
          createChromeTab({ id: 31, index: 1, windowId: 3 }),
        ],
      }),
    ]);
    vi.mocked(api.tabs.query)
      .mockResolvedValueOnce([
        createChromeTab({ id: 10, index: 0, pinned: true, windowId: 1 }),
        createChromeTab({ id: 20, index: 1, pinned: true, windowId: 1 }),
        createChromeTab({ id: 11, index: 2, windowId: 1 }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        createChromeTab({ id: 10, index: 0, pinned: true, windowId: 1 }),
        createChromeTab({ id: 20, index: 1, pinned: true, windowId: 1 }),
        createChromeTab({ id: 30, index: 2, pinned: true, windowId: 1 }),
        createChromeTab({ id: 11, index: 3, windowId: 1 }),
        createChromeTab({ id: 21, index: 4, windowId: 1 }),
      ])
      .mockResolvedValueOnce([]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.mergeWindows([1, 2, 3])).resolves.toEqual({
      destinationWindowId: 1,
      failures: [],
      mergedSourceWindowIds: [2, 3],
      movedTabIds: [20, 21, 30, 31],
      warnings: [],
    });

    expect(api.tabs.move).toHaveBeenNthCalledWith(1, 20, { index: -1, windowId: 1 });
    expect(api.tabs.move).toHaveBeenNthCalledWith(2, 21, { index: -1, windowId: 1 });
    expect(api.tabs.move).toHaveBeenNthCalledWith(3, 30, { index: -1, windowId: 1 });
    expect(api.tabs.move).toHaveBeenNthCalledWith(4, 31, { index: -1, windowId: 1 });
    expect(api.tabs.update).toHaveBeenCalledWith(20, { pinned: true });
    expect(api.tabs.update).toHaveBeenCalledWith(30, { pinned: true });
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

  it('keeps a source window open when Chrome returns a moved tab in the wrong window', async () => {
    const { api } = createApi();
    vi.mocked(api.windows.getAll).mockResolvedValue([
      createChromeWindow({ id: 1, tabs: [createChromeTab({ id: 11, windowId: 1 })] }),
      createChromeWindow({ id: 2, tabs: [createChromeTab({ id: 21, windowId: 2 })] }),
    ]);
    vi.mocked(api.tabs.move).mockResolvedValue(createChromeTab({ id: 21, windowId: 2 }));
    const service = createChromeActiveWindowsService(api);

    await expect(service.mergeWindows([1, 2])).resolves.toEqual({
      destinationWindowId: 1,
      failures: [{ message: 'Tab 21 did not reach the destination window.', tabId: 21 }],
      mergedSourceWindowIds: [],
      movedTabIds: [],
      warnings: [],
    });
    expect(api.windows.remove).not.toHaveBeenCalledWith(2);
  });

  it('keeps a source window open when a re-pinned tab disappears from the destination query', async () => {
    const { api } = createApi();
    vi.mocked(api.windows.getAll).mockResolvedValue([
      createChromeWindow({ id: 1, tabs: [createChromeTab({ id: 11, windowId: 1 })] }),
      createChromeWindow({
        id: 2,
        tabs: [createChromeTab({ id: 21, pinned: true, windowId: 2 })],
      }),
    ]);
    vi.mocked(api.tabs.query).mockResolvedValue([]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.mergeWindows([1, 2])).resolves.toEqual({
      destinationWindowId: 1,
      failures: [{ message: 'Tab 21 could not be verified in the destination window.', tabId: 21 }],
      mergedSourceWindowIds: [],
      movedTabIds: [],
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

  it('re-pins and finally repositions a pinned tab dragged across windows', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query)
      .mockResolvedValueOnce([
        createChromeTab({ id: 10, index: 0, pinned: true, windowId: 1 }),
        createChromeTab({ id: 11, index: 1, windowId: 1 }),
        createChromeTab({ id: 21, index: 0, pinned: true, windowId: 2 }),
      ])
      .mockResolvedValueOnce([
        createChromeTab({ id: 10, index: 0, pinned: true, windowId: 1 }),
        createChromeTab({ id: 21, index: 1, pinned: true, windowId: 1 }),
        createChromeTab({ id: 11, index: 2, windowId: 1 }),
      ])
      .mockResolvedValueOnce([createChromeTab({ id: 21, index: 0, pinned: true, windowId: 1 })]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTab(21, 1, 0)).resolves.toEqual({
      destinationIndex: 0,
      destinationWindowId: 1,
      movedTabId: 21,
      warnings: [],
    });

    expect(api.tabs.move).toHaveBeenNthCalledWith(1, 21, { index: 0, windowId: 1 });
    expect(api.tabs.update).toHaveBeenCalledWith(21, { pinned: true });
    expect(api.tabs.query).toHaveBeenLastCalledWith({ windowId: 1 });
    expect(api.tabs.move).toHaveBeenNthCalledWith(2, 21, { index: 0, windowId: 1 });
    expect(api.tabs.query).toHaveBeenCalledTimes(3);
  });

  it('warns when the browser does not honor a corrective pinned-tab reposition', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query)
      .mockResolvedValueOnce([
        createChromeTab({ id: 10, index: 0, pinned: true, windowId: 1 }),
        createChromeTab({ id: 11, index: 1, windowId: 1 }),
        createChromeTab({ id: 21, index: 0, pinned: true, windowId: 2 }),
      ])
      .mockResolvedValueOnce([
        createChromeTab({ id: 10, index: 0, pinned: true, windowId: 1 }),
        createChromeTab({ id: 21, index: 1, pinned: true, windowId: 1 }),
      ])
      .mockResolvedValueOnce([
        createChromeTab({ id: 10, index: 0, pinned: true, windowId: 1 }),
        createChromeTab({ id: 21, index: 1, pinned: true, windowId: 1 }),
      ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTab(21, 1, 0)).resolves.toEqual({
      destinationIndex: 0,
      destinationWindowId: 1,
      movedTabId: 21,
      warnings: [
        'Tab 21 moved and was re-pinned, but the browser placed it at index 1 instead of 0.',
      ],
    });
    expect(api.tabs.move).toHaveBeenNthCalledWith(2, 21, { index: 0, windowId: 1 });
    expect(api.tabs.query).toHaveBeenCalledTimes(3);
  });

  it('blocks a pinned tab from entering a group before any Chrome mutation', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ id: 11, index: 0, pinned: true, windowId: 1 }),
      createChromeTab({ groupId: 7, id: 12, index: 1, windowId: 1 }),
    ]);
    vi.mocked(api.tabGroups.query).mockResolvedValue([
      createChromeGroup({ id: 7, title: 'Planning', windowId: 1 }),
    ]);
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTab(11, 1, 1, 7)).rejects.toThrow(PINNED_TAB_GROUP_MOVE_ERROR_MESSAGE);

    expect(api.tabs.move).not.toHaveBeenCalled();
    expect(api.tabs.update).not.toHaveBeenCalled();
    expect(api.tabs.group).not.toHaveBeenCalled();
    expect(api.tabs.ungroup).not.toHaveBeenCalled();
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
      'The browser did not return the moved tab group.',
    );
  });

  it('rejects a tab-group move reported in the wrong destination window', async () => {
    const { api } = createApi();
    vi.mocked(api.tabs.query).mockResolvedValue([
      createChromeTab({ id: 11, index: 0, windowId: 1 }),
      createChromeTab({ groupId: 7, id: 21, index: 0, windowId: 2 }),
    ]);
    vi.mocked(api.tabGroups.move).mockResolvedValue(createChromeGroup({ id: 7, windowId: 2 }));
    const service = createChromeActiveWindowsService(api);

    await expect(service.moveTabGroup(7, 1, -1)).rejects.toThrow(
      'The tab group did not reach the destination window.',
    );
  });
});
