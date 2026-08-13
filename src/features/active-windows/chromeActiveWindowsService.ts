import {
  applyRestoredTabMetadata,
  createRestoredTabMetadataService,
  type RestoredTabMetadataChromeApi,
  type RestoredTabMetadataService,
} from '../../platform/chrome/restoredTabMetadata';
import { mapWithConcurrency } from '../../shared/mapWithConcurrency';
import {
  createTabUrlCanonicalizer,
  type DedupeRule,
  type DuplicateTabGroup,
} from '../deduplication/deduplication';
import {
  type ActiveWindowsSnapshot,
  type ManagedTab,
  type ManagedTabGroup,
  type ManagedWindow,
} from './model';
import {
  detectAgentAssociatedTab,
  getRestoredGroupTitleWithProvenance,
  shouldProtectAgentTabFromDuplicateCleanup,
  type AgentTabDetection,
} from './agentTabAssociation';
import { planTabSort, type TabSortOptions } from './tabSort';
import { formatWindowLabel } from './windowLabel';

interface ChromeEvent<TArgs extends unknown[]> {
  addListener: (listener: (...args: TArgs) => void) => void;
  removeListener: (listener: (...args: TArgs) => void) => void;
}

export interface ActiveWindowsChromeApi extends RestoredTabMetadataChromeApi {
  runtime: {
    getURL: (path: string) => string;
  };
  tabGroups: {
    get: (groupId: number) => Promise<chrome.tabGroups.TabGroup>;
    move: (
      groupId: number,
      moveProperties: chrome.tabGroups.MoveProperties,
    ) => Promise<chrome.tabGroups.TabGroup | undefined>;
    onCreated: ChromeEvent<[group: chrome.tabGroups.TabGroup]>;
    onMoved: ChromeEvent<[group: chrome.tabGroups.TabGroup]>;
    onRemoved: ChromeEvent<[group: chrome.tabGroups.TabGroup]>;
    onUpdated: ChromeEvent<[group: chrome.tabGroups.TabGroup]>;
    query: (queryInfo: chrome.tabGroups.QueryInfo) => Promise<chrome.tabGroups.TabGroup[]>;
    update: (
      groupId: number,
      updateProperties: chrome.tabGroups.UpdateProperties,
    ) => Promise<chrome.tabGroups.TabGroup | undefined>;
  };
  tabs: {
    onActivated: ChromeEvent<[activeInfo: chrome.tabs.OnActivatedInfo]>;
    onAttached: ChromeEvent<[tabId: number, attachInfo: chrome.tabs.OnAttachedInfo]>;
    onCreated: ChromeEvent<[tab: chrome.tabs.Tab]>;
    onDetached: ChromeEvent<[tabId: number, detachInfo: chrome.tabs.OnDetachedInfo]>;
    onMoved: ChromeEvent<[tabId: number, moveInfo: chrome.tabs.OnMovedInfo]>;
    onRemoved: ChromeEvent<[tabId: number, removeInfo: chrome.tabs.OnRemovedInfo]>;
    onReplaced: ChromeEvent<[addedTabId: number, removedTabId: number]>;
    onUpdated: ChromeEvent<
      [tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab]
    >;
    create: (createProperties: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>;
    discard: (tabId?: number) => Promise<chrome.tabs.Tab | undefined>;
    get: (tabId: number) => Promise<chrome.tabs.Tab>;
    group: (options: chrome.tabs.GroupOptions) => Promise<number>;
    move: (tabId: number, moveProperties: chrome.tabs.MoveProperties) => Promise<chrome.tabs.Tab>;
    query: (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
    reload: (tabId?: number) => Promise<void>;
    remove: (tabId: number) => Promise<void>;
    ungroup: (tabIds: number | [number, ...number[]]) => Promise<void>;
    update: (
      tabId: number,
      updateProperties: chrome.tabs.UpdateProperties,
    ) => Promise<chrome.tabs.Tab | undefined>;
  };
  windows: {
    create: (createData?: chrome.windows.CreateData) => Promise<chrome.windows.Window | undefined>;
    getAll: (queryOptions: chrome.windows.QueryOptions) => Promise<chrome.windows.Window[]>;
    getCurrent: () => Promise<chrome.windows.Window>;
    onCreated: ChromeEvent<[window: chrome.windows.Window]>;
    onFocusChanged: ChromeEvent<[windowId: number]>;
    onRemoved: ChromeEvent<[windowId: number]>;
    remove: (windowId: number) => Promise<void>;
    update: (
      windowId: number,
      updateInfo: chrome.windows.UpdateInfo,
    ) => Promise<chrome.windows.Window>;
  };
}

export interface ActiveWindowsService {
  closeDuplicateTabs: (request: CloseDuplicateTabsRequest) => Promise<CloseDuplicateTabsResult>;
  closeTabs: (tabIds: readonly number[]) => Promise<CloseTabsResult>;
  closeWindow: (windowId: number) => Promise<void>;
  focusTab: (windowId: number, tabId: number) => Promise<void>;
  focusWindow: (windowId: number) => Promise<void>;
  loadWindowCount?: (() => Promise<number>) | undefined;
  loadSnapshot: () => Promise<ActiveWindowsSnapshot>;
  moveTab: (
    tabId: number,
    destinationWindowId: number,
    insertionIndex: number,
    destinationGroupId?: number | null,
  ) => Promise<MoveTabResult>;
  moveTabGroup: (
    groupId: number,
    destinationWindowId: number,
    insertionIndex: number,
  ) => Promise<MoveTabsResult>;
  moveTabsToNewWindow: (
    tabIds: readonly number[],
    preserveGroupIds?: readonly number[],
  ) => Promise<MoveTabsResult>;
  mergeWindows: (windowIds: readonly number[]) => Promise<MergeWindowsResult>;
  pinTab: (tabId: number) => Promise<void>;
  restoreTabs: (tabs: readonly RestorableTab[]) => Promise<RestoreTabsResult>;
  sortAllWindows: (options: TabSortOptions) => Promise<SortWindowsResult>;
  sortWindow: (windowId: number, options: TabSortOptions) => Promise<SortWindowsResult>;
  subscribe: (listener: () => void) => () => void;
  subscribeWindowCount?: ((listener: () => void) => () => void) | undefined;
  suspendTabs: (tabIds: readonly number[]) => Promise<TabSuspensionResult>;
  unpinTab: (tabId: number) => Promise<void>;
  unsuspendTabs: (tabIds: readonly number[]) => Promise<TabSuspensionResult>;
}

export interface TabOperationFailure {
  message: string;
  tabId: number;
}

interface CloseTabsResult {
  closedTabIds: number[];
  failures: TabOperationFailure[];
}

export interface CloseDuplicateTabsResult extends CloseTabsResult {
  closedTabs: RestorableTab[];
  skippedAgentAssociatedTabIds: number[];
  skippedChangedTabIds: number[];
  skippedPinnedTabIds: number[];
}

export interface CloseDuplicateTabsRequest {
  duplicateGroups: readonly DuplicateTabGroup[];
  rules: readonly DedupeRule[];
  tabIds: readonly number[];
}

interface TabSuspensionResult {
  affectedTabIds: number[];
  failures: TabOperationFailure[];
}

interface RestorableTabGroup {
  collapsed: boolean;
  color: ManagedTabGroup['color'];
  id: number;
  title: string;
}

export interface RestorableTab {
  group: RestorableTabGroup | null;
  index: number;
  originalTabId: number;
  pinned: boolean;
  title: string;
  url: string;
  windowId: number;
}

export interface RestoreTabFailure {
  message: string;
  originalTabId: number;
}

interface RestoreTabsResult {
  failures: RestoreTabFailure[];
  restoredOriginalTabIds: number[];
  restoredTabIds: number[];
  warnings: string[];
}

interface MoveTabsResult {
  destinationWindowId: number | null;
  failures: TabOperationFailure[];
  movedTabIds: number[];
  warnings: string[];
}

interface MoveTabResult {
  destinationIndex: number;
  destinationWindowId: number;
  movedTabId: number;
  warnings: string[];
}

export interface WindowOperationFailure {
  message: string;
  windowId: number;
}

interface SortWindowsResult {
  failures: WindowOperationFailure[];
  sortedWindowIds: number[];
  warnings: string[];
}

interface MergeWindowsResult {
  destinationWindowId: number;
  failures: TabOperationFailure[];
  mergedSourceWindowIds: number[];
  movedTabIds: number[];
  warnings: string[];
}

export const PINNED_TAB_GROUP_MOVE_ERROR_MESSAGE =
  'Pinned tabs cannot be added to tab groups. Unpin the tab first.';

function describeChromeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'The browser rejected the operation.';
}

const CLOSE_TAB_CONCURRENCY = 8;
const DISCARD_TAB_CONCURRENCY = 4;
const RELOAD_TAB_CONCURRENCY = 3;

function getTabId(tab: chrome.tabs.Tab): number | null {
  return tab.id === undefined ? null : tab.id;
}

function getTabsInBrowserOrder(tabs: readonly chrome.tabs.Tab[]): chrome.tabs.Tab[] {
  return [...tabs].sort((left, right) => left.index - right.index);
}

function createRestorableTabFromChromeTab(
  tab: chrome.tabs.Tab & { id: number },
  group: chrome.tabGroups.TabGroup | null,
): RestorableTab {
  return {
    group: group
      ? {
          collapsed: group.collapsed,
          color: group.color,
          id: group.id,
          title: group.title ?? '',
        }
      : null,
    index: tab.index,
    originalTabId: tab.id,
    pinned: tab.pinned,
    title: tab.title ?? '',
    url: tab.url ?? tab.pendingUrl ?? '',
    windowId: tab.windowId,
  };
}

function getMatchingTabUrl(
  tab: chrome.tabs.Tab,
  expectedKey: string,
  canonicalize: ReturnType<typeof createTabUrlCanonicalizer>,
): string | null {
  const url = tab.pendingUrl?.trim() || tab.url?.trim() || '';
  return url !== '' && canonicalize(url).key === expectedKey ? url : null;
}

interface CrossWindowMoveCompletion {
  pinRestored: boolean;
  warnings: string[];
}

function assertTabReachedWindow(
  tab: chrome.tabs.Tab | undefined,
  tabId: number,
  destinationWindowId: number,
): asserts tab is chrome.tabs.Tab {
  if (!tab || tab.id !== tabId) {
    throw new Error(`The browser did not return tab ${tabId} after moving it.`);
  }
  if (tab.windowId !== destinationWindowId) {
    throw new Error(`Tab ${tabId} did not reach the destination window.`);
  }
}

// Work around https://issues.chromium.org/issues/380088806: cross-window
// chrome.tabs.move can clear a tab's pinned state. Re-pinning can also change
// its index, so restore, re-query, and correct the final position. If Chrome
// reliably preserves pins across supported versions, this repair path can be
// removed; stable pinned/unpinned ordering remains product behavior.
async function finishCrossWindowTabMove(
  api: ActiveWindowsChromeApi,
  tab: chrome.tabs.Tab & { id: number },
  destinationWindowId: number,
  destinationIndex: number,
  movedTab?: chrome.tabs.Tab,
): Promise<CrossWindowMoveCompletion> {
  let confirmedMovedTab = movedTab;
  if (!confirmedMovedTab) {
    try {
      confirmedMovedTab = await api.tabs.get(tab.id);
    } catch {
      throw new Error(`Tab ${tab.id} could not be verified in the destination window.`);
    }
  }
  assertTabReachedWindow(confirmedMovedTab, tab.id, destinationWindowId);

  if (!tab.pinned) {
    return { pinRestored: false, warnings: [] };
  }

  try {
    await api.tabs.update(tab.id, { pinned: true });
  } catch (error) {
    return {
      pinRestored: false,
      warnings: [
        `Tab ${tab.id} moved, but its pinned state could not be restored: ${describeChromeError(error)}`,
      ],
    };
  }

  if (destinationIndex < 0) {
    return { pinRestored: true, warnings: [] };
  }

  let destinationTabs: chrome.tabs.Tab[];
  try {
    destinationTabs = getTabsInBrowserOrder(
      await api.tabs.query({ windowId: destinationWindowId }),
    );
  } catch (error) {
    return {
      pinRestored: true,
      warnings: [
        `Tab ${tab.id} moved and was re-pinned, but its final position could not be verified: ${describeChromeError(error)}`,
      ],
    };
  }
  const destinationTab = destinationTabs.find((candidate) => candidate.id === tab.id);
  if (!destinationTab) {
    throw new Error(`Tab ${tab.id} could not be verified in the destination window.`);
  }
  assertTabReachedWindow(destinationTab, tab.id, destinationWindowId);
  if (!destinationTab.pinned) {
    return {
      pinRestored: false,
      warnings: [
        `Tab ${tab.id} moved, but the browser still reports it as unpinned after restoration.`,
      ],
    };
  }
  if (destinationTab.index !== destinationIndex) {
    let repositionedTab: chrome.tabs.Tab;
    try {
      repositionedTab = await api.tabs.move(tab.id, {
        index: destinationIndex,
        windowId: destinationWindowId,
      });
    } catch (error) {
      return {
        pinRestored: true,
        warnings: [
          `Tab ${tab.id} moved and was re-pinned, but its final position could not be restored: ${describeChromeError(error)}`,
        ],
      };
    }
    assertTabReachedWindow(repositionedTab, tab.id, destinationWindowId);

    let correctedTabs: chrome.tabs.Tab[];
    try {
      correctedTabs = getTabsInBrowserOrder(
        await api.tabs.query({ windowId: destinationWindowId }),
      );
    } catch (error) {
      return {
        pinRestored: true,
        warnings: [
          `Tab ${tab.id} moved and was re-pinned, but its corrected position could not be verified: ${describeChromeError(error)}`,
        ],
      };
    }
    const correctedTab = correctedTabs.find((candidate) => candidate.id === tab.id);
    if (!correctedTab) {
      throw new Error(`Tab ${tab.id} could not be verified in the destination window.`);
    }
    assertTabReachedWindow(correctedTab, tab.id, destinationWindowId);
    if (!correctedTab.pinned) {
      return {
        pinRestored: false,
        warnings: [
          `Tab ${tab.id} moved, but the browser reports it as unpinned after repositioning.`,
        ],
      };
    }
    if (correctedTab.index !== destinationIndex) {
      return {
        pinRestored: true,
        warnings: [
          `Tab ${tab.id} moved and was re-pinned, but the browser placed it at index ${correctedTab.index} instead of ${destinationIndex}.`,
        ],
      };
    }
  }

  return { pinRestored: true, warnings: [] };
}

async function moveTabAcrossWindows(
  api: ActiveWindowsChromeApi,
  tab: chrome.tabs.Tab & { id: number },
  destinationWindowId: number,
  moveIndex: number,
  finalIndex: number = moveIndex,
): Promise<CrossWindowMoveCompletion> {
  const movedTab = await api.tabs.move(tab.id, {
    index: moveIndex,
    windowId: destinationWindowId,
  });
  assertTabReachedWindow(movedTab, tab.id, destinationWindowId);
  return finishCrossWindowTabMove(api, tab, destinationWindowId, finalIndex, movedTab);
}

async function moveAssociationProtectedGroupAcrossWindows(
  api: ActiveWindowsChromeApi,
  groupId: number,
  tabIds: readonly number[],
  destinationWindowId: number,
  destinationIndex: number,
  activeDestinationTabId?: number,
): Promise<string[]> {
  const movedGroup = await api.tabGroups.move(groupId, {
    index: destinationIndex,
    windowId: destinationWindowId,
  });
  if (!movedGroup || movedGroup.id !== groupId || movedGroup.windowId !== destinationWindowId) {
    throw new Error(`Tab group ${groupId} did not reach the destination window.`);
  }

  const destinationTabs = await api.tabs.query({ windowId: destinationWindowId });
  const destinationTabsById = new Map(
    destinationTabs.flatMap((tab) => (tab.id === undefined ? [] : [[tab.id, tab] as const])),
  );
  const missingTabId = tabIds.find((tabId) => {
    const tab = destinationTabsById.get(tabId);
    return !tab || tab.windowId !== destinationWindowId || tab.groupId !== groupId;
  });
  if (missingTabId !== undefined) {
    throw new Error(`Tab ${missingTabId} did not move with the rest of tab group ${groupId}.`);
  }

  const warnings: string[] = [];
  if (activeDestinationTabId !== undefined) {
    try {
      await api.tabs.update(activeDestinationTabId, { active: true });
    } catch (error) {
      warnings.push(
        `The previously active tab could not be restored. ${describeChromeError(error)}`,
      );
    }
  }
  return warnings;
}

async function restoreTabGroups(
  api: ActiveWindowsChromeApi,
  originalTabs: readonly chrome.tabs.Tab[],
  groups: readonly chrome.tabGroups.TabGroup[],
  destinationWindowId: number,
  includedTabIds: ReadonlySet<number>,
  allowedGroupIds: ReadonlySet<number> | null = null,
): Promise<string[]> {
  const metadataById = new Map(groups.map((group) => [group.id, group]));
  const groupedTabIds = new Map<number, number[]>();

  originalTabs.forEach((tab) => {
    const tabId = getTabId(tab);
    if (
      tabId === null ||
      tab.groupId < 0 ||
      !includedTabIds.has(tabId) ||
      (allowedGroupIds !== null && !allowedGroupIds.has(tab.groupId))
    ) {
      return;
    }
    const ids = groupedTabIds.get(tab.groupId) ?? [];
    ids.push(tabId);
    groupedTabIds.set(tab.groupId, ids);
  });

  const warnings: string[] = [];
  for (const [originalGroupId, tabIds] of groupedTabIds) {
    const [firstTabId, ...remainingTabIds] = tabIds;
    if (firstTabId === undefined) {
      continue;
    }
    try {
      const newGroupId = await api.tabs.group({
        createProperties: { windowId: destinationWindowId },
        tabIds: [firstTabId, ...remainingTabIds],
      });
      const metadata = metadataById.get(originalGroupId);
      if (metadata) {
        await api.tabGroups.update(newGroupId, {
          collapsed: metadata.collapsed,
          color: metadata.color,
          title: metadata.title ?? '',
        });
      }
    } catch (error) {
      warnings.push(`A tab group could not be restored: ${describeChromeError(error)}`);
    }
  }

  return warnings;
}

function isManagedChromeWindow(window: chrome.windows.Window): window is chrome.windows.Window & {
  id: number;
} {
  return (
    window.id !== undefined &&
    !window.incognito &&
    (window.type === undefined || window.type === 'normal')
  );
}

function addEventSubscription<TArgs extends unknown[]>(
  event: ChromeEvent<TArgs>,
  listener: () => void,
  cleanups: Array<() => void>,
  shouldNotify: (...args: TArgs) => boolean = () => true,
) {
  const eventListener: (...args: TArgs) => void = (...args) => {
    if (shouldNotify(...args)) {
      listener();
    }
  };
  event.addListener(eventListener);
  cleanups.push(() => event.removeListener(eventListener));
}

const SNAPSHOT_TAB_UPDATE_FIELDS = [
  'discarded',
  'favIconUrl',
  'frozen',
  'groupId',
  'pinned',
  'status',
  'title',
  'url',
] as const;

function changesActiveWindowsSnapshot(changeInfo: chrome.tabs.OnUpdatedInfo): boolean {
  return SNAPSHOT_TAB_UPDATE_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(changeInfo, field),
  );
}

function resolveTabIconUrl(
  tab: chrome.tabs.Tab,
  extensionRootUrl: string,
  extensionIconUrl: string,
): string | null {
  const url = tab.url ?? tab.pendingUrl ?? '';
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome:')) {
    return tab.favIconUrl;
  }
  return url.startsWith(extensionRootUrl) ? extensionIconUrl : null;
}

function resolveTabTitle(tab: chrome.tabs.Tab, url: string): string {
  return tab.title?.trim() || url || 'Untitled tab';
}

function toManagedTab(
  tab: chrome.tabs.Tab,
  agentDetection: AgentTabDetection | null,
  extensionRootUrl: string,
  extensionIconUrl: string,
): ManagedTab | null {
  if (tab.id === undefined) {
    return null;
  }

  const url = tab.url ?? tab.pendingUrl ?? '';
  return {
    active: tab.active,
    agentAssociated: agentDetection !== null,
    agentDedupeProtected: shouldProtectAgentTabFromDuplicateCleanup(agentDetection),
    agentDetection,
    discarded: tab.discarded,
    frozen: tab.frozen ?? false,
    groupId: tab.groupId >= 0 ? tab.groupId : null,
    iconUrl: resolveTabIconUrl(tab, extensionRootUrl, extensionIconUrl),
    id: tab.id,
    index: tab.index,
    pinned: tab.pinned,
    title: resolveTabTitle(tab, url),
    unloaded: tab.status === 'unloaded',
    url,
    windowId: tab.windowId,
  };
}

function toManagedGroup(group: chrome.tabGroups.TabGroup): ManagedTabGroup {
  return {
    collapsed: group.collapsed,
    color: group.color,
    id: group.id,
    title: group.title?.trim() ?? '',
    windowId: group.windowId,
  };
}

function orderWindows(
  windows: chrome.windows.Window[],
  currentWindowId: number | undefined,
): chrome.windows.Window[] {
  const managedWindows = windows.filter(
    (window) =>
      window.id !== undefined &&
      !window.incognito &&
      (window.type === undefined || window.type === 'normal'),
  );
  const currentWindow = managedWindows.find((window) => window.id === currentWindowId);

  return currentWindow
    ? [currentWindow, ...managedWindows.filter((window) => window.id !== currentWindowId)]
    : managedWindows;
}

function toManagedWindows(
  windows: chrome.windows.Window[],
  groups: chrome.tabGroups.TabGroup[],
  currentWindowId: number | undefined,
  api: ActiveWindowsChromeApi,
  detectAgentAssociation: (
    tab: chrome.tabs.Tab,
    group: chrome.tabGroups.TabGroup | null,
  ) => AgentTabDetection | null,
): ManagedWindow[] {
  const extensionRootUrl = api.runtime.getURL('');
  const extensionIconUrl = api.runtime.getURL('icons/default-16.png');
  const groupsById = new Map(groups.map((group) => [group.id, group]));

  return orderWindows(windows, currentWindowId).map((window, index) => {
    const windowId = window.id as number;
    const isCurrent = windowId === currentWindowId;
    const tabs = (window.tabs ?? [])
      .map((tab) =>
        toManagedTab(
          tab,
          detectAgentAssociation(
            tab,
            tab.groupId >= 0 ? (groupsById.get(tab.groupId) ?? null) : null,
          ),
          extensionRootUrl,
          extensionIconUrl,
        ),
      )
      .filter((tab): tab is ManagedTab => tab !== null)
      .sort((left, right) => left.index - right.index);

    return {
      focused: window.focused,
      groups: groups.filter((group) => group.windowId === windowId).map(toManagedGroup),
      id: windowId,
      isCurrent,
      label: formatWindowLabel(index + 1),
      state: window.state ?? null,
      tabs,
    };
  });
}

export function createChromeActiveWindowsService(
  api: ActiveWindowsChromeApi = chrome,
  restoredTabMetadataService: RestoredTabMetadataService = createRestoredTabMetadataService(api),
): ActiveWindowsService {
  const recentCodexExtensionDetectionByTabId = new Map<
    number,
    { detection: AgentTabDetection; url: string }
  >();
  const detectAgentAssociation = (
    tab: chrome.tabs.Tab,
    group: chrome.tabGroups.TabGroup | null,
  ): AgentTabDetection | null => {
    const detection = detectAgentAssociatedTab(tab, group);
    const tabId = tab.id;
    if (tabId === undefined) {
      return detection;
    }

    if (
      detection?.evidence === 'codex-extension-badge' ||
      detection?.evidence === 'conflicting-signals'
    ) {
      recentCodexExtensionDetectionByTabId.set(tabId, {
        detection,
        url: tab.url ?? tab.pendingUrl ?? '',
      });
      return detection;
    }
    const recentCodexExtensionDetection = recentCodexExtensionDetectionByTabId.get(tabId);
    const hasTransientCodexSignalGap =
      recentCodexExtensionDetection !== undefined &&
      (tab.status === 'loading' ||
        (tab.pendingUrl?.trim() ?? '') !== '' ||
        ((tab.favIconUrl?.trim() ?? '') === '' &&
          (tab.url ?? '') === recentCodexExtensionDetection.url));
    if (detection) {
      if (recentCodexExtensionDetection && !hasTransientCodexSignalGap) {
        recentCodexExtensionDetectionByTabId.delete(tabId);
      }
      if (recentCodexExtensionDetection && hasTransientCodexSignalGap) {
        return {
          activity: 'unknown',
          evidence: 'conflicting-signals',
        };
      }
      return detection;
    }
    if (recentCodexExtensionDetection && hasTransientCodexSignalGap) {
      return {
        ...recentCodexExtensionDetection.detection,
        activity: 'unknown',
      };
    }

    recentCodexExtensionDetectionByTabId.delete(tabId);
    return null;
  };
  const getAssociationProtectedGroupIds = (
    tabs: readonly chrome.tabs.Tab[],
    groups: readonly chrome.tabGroups.TabGroup[],
  ): Set<number> => {
    const groupsById = new Map(groups.map((group) => [group.id, group]));
    return new Set(
      tabs.flatMap((tab) => {
        if (tab.groupId < 0) {
          return [];
        }
        const group = groupsById.get(tab.groupId) ?? null;
        return detectAgentAssociation(tab, group) ? [tab.groupId] : [];
      }),
    );
  };
  const resolveWindowTabs = async (
    windows: readonly chrome.windows.Window[],
  ): Promise<chrome.windows.Window[]> => {
    const tabs = windows.flatMap((window) => window.tabs ?? []);
    const restoredMetadata = await restoredTabMetadataService.resolve(tabs);
    return windows.map((window) =>
      window.tabs
        ? {
            ...window,
            tabs: window.tabs.map((tab) => applyRestoredTabMetadata(tab, restoredMetadata)),
          }
        : { ...window },
    );
  };

  const sortWindows = async (
    requestedWindowIds: readonly number[] | null,
    options: TabSortOptions,
  ): Promise<SortWindowsResult> => {
    const windows = await api.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const managedWindows = windows.filter(isManagedChromeWindow);
    const targetWindowIds = requestedWindowIds
      ? [...new Set(requestedWindowIds)]
      : managedWindows.map((window) => window.id);
    const result: SortWindowsResult = {
      failures: [],
      sortedWindowIds: [],
      warnings: [],
    };

    for (const windowId of targetWindowIds) {
      let window: chrome.windows.Window & { id: number };
      let groups: chrome.tabGroups.TabGroup[];
      try {
        const [latestWindows, latestGroups] = await Promise.all([
          api.windows.getAll({ populate: true, windowTypes: ['normal'] }),
          api.tabGroups.query({ windowId }),
        ]);
        const latestWindow = latestWindows
          .filter(isManagedChromeWindow)
          .find((candidate) => candidate.id === windowId);
        if (!latestWindow) {
          result.failures.push({ message: 'The window no longer exists.', windowId });
          continue;
        }
        const [resolvedWindow] = await resolveWindowTabs([latestWindow]);
        if (!resolvedWindow || !isManagedChromeWindow(resolvedWindow)) {
          result.failures.push({ message: 'The window no longer exists.', windowId });
          continue;
        }
        window = resolvedWindow;
        groups = latestGroups;
      } catch (error) {
        result.failures.push({ message: describeChromeError(error), windowId });
        continue;
      }

      const originalTabs = getTabsInBrowserOrder(window.tabs ?? []).filter(
        (tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined,
      );
      const groupsById = new Map(
        groups.filter((group) => group.windowId === windowId).map((group) => [group.id, group]),
      );
      if (originalTabs.some((tab) => tab.groupId >= 0 && !groupsById.has(tab.groupId))) {
        result.failures.push({
          message: 'The latest tab group state could not be read, so the window was not sorted.',
          windowId,
        });
        continue;
      }
      const associationProtectedGroupIds = getAssociationProtectedGroupIds(originalTabs, groups);
      const desiredTabs = planTabSort(
        originalTabs.map((tab) => {
          const url = tab.url ?? tab.pendingUrl ?? '';
          return {
            agentAssociated:
              detectAgentAssociation(
                tab,
                tab.groupId >= 0 ? (groupsById.get(tab.groupId) ?? null) : null,
              ) !== null,
            groupId: tab.groupId >= 0 ? tab.groupId : null,
            id: tab.id,
            index: tab.index,
            pinned: tab.pinned,
            title: resolveTabTitle(tab, url),
            url,
          };
        }),
        options,
      );
      const currentOrder = originalTabs.map((tab) => tab.id);
      let groupSensitiveMoveCompleted = false;

      try {
        for (let targetIndex = 0; targetIndex < desiredTabs.length; targetIndex += 1) {
          const tabId = desiredTabs[targetIndex]?.id;
          if (tabId === undefined) {
            continue;
          }
          const currentIndex = currentOrder.indexOf(tabId);
          if (currentIndex === targetIndex) {
            continue;
          }

          await api.tabs.move(tabId, { index: targetIndex, windowId });
          groupSensitiveMoveCompleted = true;
          currentOrder.splice(currentIndex, 1);
          currentOrder.splice(targetIndex, 0, tabId);
        }

        result.sortedWindowIds.push(windowId);
      } catch (error) {
        result.failures.push({ message: describeChromeError(error), windowId });
      }

      if (groupSensitiveMoveCompleted) {
        const tabIds = new Set(originalTabs.map((tab) => tab.id));
        const restorableGroupIds = new Set(
          groups.flatMap((group) => (associationProtectedGroupIds.has(group.id) ? [] : [group.id])),
        );
        const warnings = await restoreTabGroups(
          api,
          originalTabs,
          groups,
          windowId,
          tabIds,
          restorableGroupIds,
        );
        result.warnings.push(...warnings.map((warning) => `${windowId}: ${warning}`));
      }
    }

    return result;
  };

  return {
    async closeDuplicateTabs(request) {
      const canonicalize = createTabUrlCanonicalizer(request.rules);
      const requestedTabIds = [...new Set(request.tabIds)];
      const requestedTabIdSet = new Set(requestedTabIds);
      const closedTabIds: number[] = [];
      const closedTabs: RestorableTab[] = [];
      const failures: TabOperationFailure[] = [];
      const skippedAgentAssociatedTabIds: number[] = [];
      const skippedChangedTabIds: number[] = [];
      const skippedPinnedTabIds: number[] = [];
      const ambiguousPlanTabIds = new Set<number>();
      const plannedGroupByTabId = new Map<number, DuplicateTabGroup>();
      request.duplicateGroups.forEach((group) => {
        group.duplicateTabIds.forEach((tabId) => {
          if (plannedGroupByTabId.has(tabId)) {
            ambiguousPlanTabIds.add(tabId);
          } else {
            plannedGroupByTabId.set(tabId, group);
          }
        });
      });
      const [snapshotTabs, groups] = await Promise.all([
        api.tabs.query({}),
        api.tabGroups.query({}),
      ]);
      const restoredMetadata = await restoredTabMetadataService.resolve(snapshotTabs, {
        pruneMissing: false,
      });
      const snapshotTabsById = new Map(
        snapshotTabs.flatMap((tab) => {
          if (tab.id === undefined) {
            return [];
          }
          return [[tab.id, applyRestoredTabMetadata(tab, restoredMetadata)] as const];
        }),
      );
      const results = await mapWithConcurrency(
        requestedTabIds,
        CLOSE_TAB_CONCURRENCY,
        async (tabId) => {
          try {
            const plannedGroup = plannedGroupByTabId.get(tabId);
            if (!plannedGroup || ambiguousPlanTabIds.has(tabId)) {
              return { skippedChanged: true as const, tabId };
            }
            const snapshotTab = snapshotTabsById.get(tabId);
            if (!snapshotTab) {
              return { skippedChanged: true as const, tabId };
            }
            const group =
              snapshotTab.groupId >= 0
                ? (groups.find(
                    (candidate) =>
                      candidate.id === snapshotTab.groupId &&
                      candidate.windowId === snapshotTab.windowId,
                  ) ?? null)
                : null;
            if (snapshotTab.groupId >= 0 && !group) {
              throw new Error(
                'The tab group metadata could not be read, so the tab was left open.',
              );
            }

            const readCandidateAtMutationBoundary = async () => {
              let liveTab: chrome.tabs.Tab;
              try {
                liveTab = await api.tabs.get(tabId);
              } catch {
                return { state: 'changed' as const };
              }
              if (liveTab.id !== tabId) {
                return { state: 'changed' as const };
              }
              if (liveTab.windowId !== snapshotTab.windowId) {
                return { state: 'changed' as const };
              }
              if (liveTab.pinned) {
                return { state: 'pinned' as const };
              }
              if (
                shouldProtectAgentTabFromDuplicateCleanup(detectAgentAssociation(liveTab, null))
              ) {
                return { state: 'agent-associated' as const };
              }

              const liveGroup =
                liveTab.groupId >= 0 ? await api.tabGroups.get(liveTab.groupId) : null;
              if (liveTab.groupId >= 0 && (!liveGroup || liveGroup.windowId !== liveTab.windowId)) {
                throw new Error(
                  'The live tab group metadata could not be read, so the tab was left open.',
                );
              }
              if (
                shouldProtectAgentTabFromDuplicateCleanup(
                  detectAgentAssociation(liveTab, liveGroup),
                )
              ) {
                return { state: 'agent-associated' as const };
              }
              const matchedUrl = getMatchingTabUrl(liveTab, plannedGroup.key, canonicalize);
              if (!matchedUrl) {
                return { state: 'changed' as const };
              }
              return { matchedUrl, state: 'eligible' as const };
            };

            const firstCandidateCheck = await readCandidateAtMutationBoundary();
            if (firstCandidateCheck.state !== 'eligible') {
              return { state: firstCandidateCheck.state, tabId };
            }

            let hasLiveKeeper = false;
            for (const keeperTabId of plannedGroup.keepTabIds) {
              if (keeperTabId === tabId || requestedTabIdSet.has(keeperTabId)) {
                continue;
              }
              const snapshotKeeper = snapshotTabsById.get(keeperTabId);
              if (!snapshotKeeper) {
                continue;
              }
              try {
                const keeper = await api.tabs.get(keeperTabId);
                if (
                  keeper.id === keeperTabId &&
                  keeper.windowId === snapshotKeeper.windowId &&
                  getMatchingTabUrl(keeper, plannedGroup.key, canonicalize) !== null
                ) {
                  hasLiveKeeper = true;
                  break;
                }
              } catch {
                // Try another planned keeper. A stale plan must never cause a close.
              }
            }
            if (!hasLiveKeeper) {
              return { state: 'changed' as const, tabId };
            }

            // Re-read the candidate after its keeper so both sides of the
            // duplicate relationship are fresh at the removal boundary.
            const finalCandidateCheck = await readCandidateAtMutationBoundary();
            if (finalCandidateCheck.state !== 'eligible') {
              return { state: finalCandidateCheck.state, tabId };
            }

            const closedTab = createRestorableTabFromChromeTab(
              snapshotTab as chrome.tabs.Tab & { id: number },
              group,
            );
            closedTab.url = finalCandidateCheck.matchedUrl;
            await api.tabs.remove(tabId);
            return { closed: true as const, closedTab, tabId };
          } catch (error) {
            return { closed: false as const, error, tabId };
          }
        },
      );
      results.forEach((result) => {
        if ('skippedChanged' in result || ('state' in result && result.state === 'changed')) {
          skippedChangedTabIds.push(result.tabId);
        } else if ('state' in result && result.state === 'agent-associated') {
          skippedAgentAssociatedTabIds.push(result.tabId);
        } else if ('state' in result && result.state === 'pinned') {
          skippedPinnedTabIds.push(result.tabId);
        } else if ('closed' in result && result.closed) {
          closedTabIds.push(result.tabId);
          closedTabs.push(result.closedTab);
        } else if ('closed' in result) {
          failures.push({ message: describeChromeError(result.error), tabId: result.tabId });
        }
      });
      return {
        closedTabIds,
        closedTabs,
        failures,
        skippedAgentAssociatedTabIds,
        skippedChangedTabIds,
        skippedPinnedTabIds,
      };
    },

    async closeTabs(tabIds) {
      const requestedTabIds = [...new Set(tabIds)];
      const closedTabIds: number[] = [];
      const failures: TabOperationFailure[] = [];
      const results = await mapWithConcurrency(
        requestedTabIds,
        CLOSE_TAB_CONCURRENCY,
        async (tabId) => {
          try {
            await api.tabs.remove(tabId);
            return { closed: true as const, tabId };
          } catch (error) {
            return { closed: false as const, error, tabId };
          }
        },
      );
      results.forEach((result) => {
        if (result.closed) {
          closedTabIds.push(result.tabId);
        } else {
          failures.push({ message: describeChromeError(result.error), tabId: result.tabId });
        }
      });
      return { closedTabIds, failures };
    },

    async closeWindow(windowId) {
      await api.windows.remove(windowId);
    },

    async suspendTabs(tabIds) {
      const requestedTabIds = [...new Set(tabIds)];
      const affectedTabIds: number[] = [];
      const failures: TabOperationFailure[] = [];
      const results = await mapWithConcurrency(
        requestedTabIds,
        DISCARD_TAB_CONCURRENCY,
        async (tabId) => {
          try {
            const tab = await api.tabs.discard(tabId);
            if (!tab?.discarded) {
              throw new Error(
                'The browser did not suspend the tab. Active tabs cannot be suspended.',
              );
            }
            return { affected: true as const, tabId };
          } catch (error) {
            return { affected: false as const, error, tabId };
          }
        },
      );
      results.forEach((result) => {
        if (result.affected) {
          affectedTabIds.push(result.tabId);
        } else {
          failures.push({ message: describeChromeError(result.error), tabId: result.tabId });
        }
      });
      return { affectedTabIds, failures };
    },

    async unsuspendTabs(tabIds) {
      const requestedTabIds = [...new Set(tabIds)];
      const affectedTabIds: number[] = [];
      const failures: TabOperationFailure[] = [];
      let tabsById = new Map<number, chrome.tabs.Tab>();
      try {
        const tabs = await api.tabs.query({});
        tabsById = new Map(
          tabs
            .filter((tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined)
            .map((tab) => [tab.id, tab]),
        );
      } catch {
        // Fall back to reloading when the browser cannot provide current tab state.
      }
      const results = await mapWithConcurrency(
        requestedTabIds,
        RELOAD_TAB_CONCURRENCY,
        async (tabId) => {
          try {
            const tab = tabsById.get(tabId);
            if (tab?.frozen && !tab.discarded) {
              const previouslyActiveTab = [...tabsById.values()].find(
                (candidate) => candidate.windowId === tab.windowId && candidate.active,
              );
              await api.tabs.update(tabId, { active: true });
              if (previouslyActiveTab?.id !== undefined && previouslyActiveTab.id !== tabId) {
                await api.tabs.update(previouslyActiveTab.id, { active: true });
              }
            } else {
              await api.tabs.reload(tabId);
            }
            return { affected: true as const, tabId };
          } catch (error) {
            return { affected: false as const, error, tabId };
          }
        },
      );
      results.forEach((result) => {
        if (result.affected) {
          affectedTabIds.push(result.tabId);
        } else {
          failures.push({ message: describeChromeError(result.error), tabId: result.tabId });
        }
      });
      return { affectedTabIds, failures };
    },

    async loadSnapshot() {
      const [currentWindow, windows, groups] = await Promise.all([
        api.windows.getCurrent(),
        api.windows.getAll({ populate: true, windowTypes: ['normal'] }),
        api.tabGroups.query({}),
      ]);
      const resolvedWindows = await resolveWindowTabs(windows);
      const liveTabIds = new Set(
        resolvedWindows.flatMap((window) =>
          (window.tabs ?? []).flatMap((tab) => (tab.id === undefined ? [] : [tab.id])),
        ),
      );
      recentCodexExtensionDetectionByTabId.forEach((_detection, tabId) => {
        if (!liveTabIds.has(tabId)) {
          recentCodexExtensionDetectionByTabId.delete(tabId);
        }
      });
      const managedWindows = toManagedWindows(
        resolvedWindows,
        groups,
        currentWindow.id,
        api,
        detectAgentAssociation,
      );

      return {
        extensionOrigin: api.runtime.getURL(''),
        totalTabs: managedWindows.reduce((total, window) => total + window.tabs.length, 0),
        windows: managedWindows,
      };
    },

    async loadWindowCount() {
      const windows = await api.windows.getAll({ populate: false, windowTypes: ['normal'] });
      return windows.filter(isManagedChromeWindow).length;
    },

    async restoreTabs(tabs) {
      const requestedTabs = [...new Map(tabs.map((tab) => [tab.originalTabId, tab])).values()];
      const result: RestoreTabsResult = {
        failures: [],
        restoredOriginalTabIds: [],
        restoredTabIds: [],
        warnings: [],
      };
      if (requestedTabs.length === 0) {
        return result;
      }

      const windows = await api.windows.getAll({ populate: true, windowTypes: ['normal'] });
      const existingWindowIds = new Set(
        windows.filter(isManagedChromeWindow).map((window) => window.id),
      );
      const tabsByWindow = new Map<number, RestorableTab[]>();
      requestedTabs.forEach((tab) => {
        const windowTabs = tabsByWindow.get(tab.windowId) ?? [];
        windowTabs.push(tab);
        tabsByWindow.set(tab.windowId, windowTabs);
      });

      for (const [originalWindowId, windowTabs] of tabsByWindow) {
        const orderedTabs = [...windowTabs].sort((left, right) => left.index - right.index);
        let destinationWindowId = originalWindowId;
        const usesOriginalWindow = existingWindowIds.has(originalWindowId);
        let placeholderTabIds: number[] = [];

        if (!usesOriginalWindow) {
          let destination: chrome.windows.Window | undefined;
          try {
            destination = await api.windows.create({ focused: false });
          } catch (error) {
            const message = describeChromeError(error);
            result.failures.push(
              ...orderedTabs.map((tab) => ({ message, originalTabId: tab.originalTabId })),
            );
            continue;
          }
          if (destination?.id === undefined) {
            result.failures.push(
              ...orderedTabs.map((tab) => ({
                message: 'The browser did not recreate the original window.',
                originalTabId: tab.originalTabId,
              })),
            );
            continue;
          }
          destinationWindowId = destination.id;
          if (destination.tabs) {
            placeholderTabIds = destination.tabs
              .map(getTabId)
              .filter((tabId): tabId is number => tabId !== null);
          } else {
            try {
              placeholderTabIds = (await api.tabs.query({ windowId: destinationWindowId }))
                .map(getTabId)
                .filter((tabId): tabId is number => tabId !== null);
            } catch (error) {
              result.warnings.push(
                `A replacement window's temporary tab could not be identified: ${describeChromeError(error)}`,
              );
            }
          }
        }

        const restoredRecords: Array<{ input: RestorableTab; tabId: number }> = [];
        for (const tab of orderedTabs) {
          try {
            const createdTab = await api.tabs.create({
              active: false,
              index: tab.index,
              pinned: tab.pinned,
              url: tab.url,
              windowId: destinationWindowId,
            });
            const createdTabId = getTabId(createdTab);
            if (createdTabId === null) {
              throw new Error('The browser recreated a tab without an ID.');
            }
            restoredRecords.push({ input: tab, tabId: createdTabId });
            result.restoredOriginalTabIds.push(tab.originalTabId);
            result.restoredTabIds.push(createdTabId);
          } catch (error) {
            result.failures.push({
              message: describeChromeError(error),
              originalTabId: tab.originalTabId,
            });
          }
        }

        if (restoredRecords.length > 0) {
          for (const placeholderTabId of placeholderTabIds) {
            try {
              await api.tabs.remove(placeholderTabId);
            } catch (error) {
              result.warnings.push(
                `A replacement window's temporary tab could not be removed: ${describeChromeError(error)}`,
              );
            }
          }
        }

        const restoredGroups = new Map<number, { group: RestorableTabGroup; tabIds: number[] }>();
        restoredRecords.forEach(({ input, tabId }) => {
          if (!input.group) {
            return;
          }
          const record = restoredGroups.get(input.group.id) ?? {
            group: input.group,
            tabIds: [],
          };
          record.tabIds.push(tabId);
          restoredGroups.set(input.group.id, record);
        });

        for (const { group, tabIds } of restoredGroups.values()) {
          const [firstTabId, ...remainingTabIds] = tabIds;
          if (firstTabId === undefined) {
            continue;
          }
          const groupedTabIds: [number, ...number[]] = [firstTabId, ...remainingTabIds];
          if (usesOriginalWindow) {
            try {
              await api.tabs.group({ groupId: group.id, tabIds: groupedTabIds });
              continue;
            } catch {
              // The original group may have disappeared when its final tab closed.
            }
          }

          let newGroupId: number;
          try {
            newGroupId = await api.tabs.group({
              createProperties: { windowId: destinationWindowId },
              tabIds: groupedTabIds,
            });
          } catch (error) {
            result.warnings.push(
              `The ${group.title || 'untitled'} tab group could not be restored: ${describeChromeError(error)}`,
            );
            continue;
          }
          try {
            await api.tabGroups.update(newGroupId, {
              collapsed: group.collapsed,
              color: group.color,
              title: getRestoredGroupTitleWithProvenance(group),
            });
          } catch (error) {
            result.warnings.push(
              `The ${group.title || 'untitled'} tab group's details could not be restored: ${describeChromeError(error)}`,
            );
          }
        }
      }

      return result;
    },

    async mergeWindows(windowIds) {
      const requestedWindowIds = [...new Set(windowIds)];
      if (requestedWindowIds.length < 2) {
        throw new Error('Select at least two windows to merge.');
      }

      const [managerWindow, windows] = await Promise.all([
        api.windows.getCurrent(),
        api.windows.getAll({ populate: true, windowTypes: ['normal'] }),
      ]);
      const managedWindows = windows.filter(isManagedChromeWindow);
      const windowsById = new Map(managedWindows.map((window) => [window.id, window]));
      const destinationWindowId = requestedWindowIds[0] as number;
      const destinationWindow = windowsById.get(destinationWindowId);
      if (!destinationWindow) {
        throw new Error('The destination window no longer exists.');
      }

      const sourceWindowIds = requestedWindowIds.slice(1);
      const movedTabIds: number[] = [];
      const failures: TabOperationFailure[] = [];
      const mergedSourceWindowIds: number[] = [];
      const warnings: string[] = [];
      const originalSourceTabs: chrome.tabs.Tab[] = [];
      const originalSourceGroups: chrome.tabGroups.TabGroup[] = [];
      const associationProtectedGroupIds = new Set<number>();
      const destinationPinnedTabCount = (destinationWindow.tabs ?? []).filter(
        (tab) => tab.pinned,
      ).length;
      const activeDestinationTabId = (destinationWindow.tabs ?? []).find((tab) => tab.active)?.id;
      let restoredPinnedTabCount = 0;

      for (const sourceWindowId of sourceWindowIds) {
        let sourceWindow: (chrome.windows.Window & { id: number }) | undefined;
        let sourceGroups: chrome.tabGroups.TabGroup[];
        try {
          const [latestWindows, latestGroups] = await Promise.all([
            api.windows.getAll({ populate: true, windowTypes: ['normal'] }),
            api.tabGroups.query({ windowId: sourceWindowId }),
          ]);
          sourceWindow = latestWindows
            .filter(isManagedChromeWindow)
            .find((window) => window.id === sourceWindowId);
          sourceGroups = latestGroups;
        } catch (error) {
          warnings.push(
            `Window ${sourceWindowId} was skipped because its latest tab state could not be read: ${describeChromeError(error)}`,
          );
          continue;
        }
        if (!sourceWindow) {
          warnings.push(`Window ${sourceWindowId} no longer exists and was skipped.`);
          continue;
        }

        const sourceTabs = getTabsInBrowserOrder(sourceWindow.tabs ?? []).filter(
          (tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined,
        );
        const sourceGroupIds = new Set(
          sourceTabs.flatMap((tab) => (tab.groupId >= 0 ? [tab.groupId] : [])),
        );
        const readableSourceGroupIds = new Set(
          sourceGroups
            .filter((group) => group.windowId === sourceWindowId)
            .map((group) => group.id),
        );
        if ([...sourceGroupIds].some((groupId) => !readableSourceGroupIds.has(groupId))) {
          warnings.push(
            `Window ${sourceWindowId} was skipped because its latest tab group state could not be read.`,
          );
          continue;
        }
        const sourceAssociationProtectedGroupIds = getAssociationProtectedGroupIds(
          sourceTabs,
          sourceGroups,
        );
        sourceAssociationProtectedGroupIds.forEach((groupId) =>
          associationProtectedGroupIds.add(groupId),
        );
        originalSourceTabs.push(...sourceTabs);
        originalSourceGroups.push(...sourceGroups);
        let sourceFailed = false;
        const movedAssociationProtectedGroupIds = new Set<number>();
        for (const tab of sourceTabs) {
          if (tab.groupId >= 0 && sourceAssociationProtectedGroupIds.has(tab.groupId)) {
            if (movedAssociationProtectedGroupIds.has(tab.groupId)) {
              continue;
            }
            movedAssociationProtectedGroupIds.add(tab.groupId);
            const associationProtectedGroupTabs = sourceTabs.filter(
              (candidate) => candidate.groupId === tab.groupId,
            );
            const associationProtectedGroupTabIds = associationProtectedGroupTabs.map(
              (candidate) => candidate.id,
            );
            try {
              warnings.push(
                ...(await moveAssociationProtectedGroupAcrossWindows(
                  api,
                  tab.groupId,
                  associationProtectedGroupTabIds,
                  destinationWindowId,
                  -1,
                  activeDestinationTabId,
                )),
              );
              movedTabIds.push(...associationProtectedGroupTabIds);
            } catch (error) {
              sourceFailed = true;
              const message = describeChromeError(error);
              failures.push(
                ...associationProtectedGroupTabIds.map((tabId) => ({ message, tabId })),
              );
            }
            continue;
          }

          try {
            const completion = await moveTabAcrossWindows(
              api,
              tab,
              destinationWindowId,
              -1,
              tab.pinned ? destinationPinnedTabCount + restoredPinnedTabCount : -1,
            );
            movedTabIds.push(tab.id);
            warnings.push(...completion.warnings);
            if (tab.pinned && completion.pinRestored) {
              restoredPinnedTabCount += 1;
            }
          } catch (error) {
            sourceFailed = true;
            failures.push({ message: describeChromeError(error), tabId: tab.id });
          }
        }

        if (!sourceFailed) {
          let remainingSourceTabs: chrome.tabs.Tab[] | undefined;
          try {
            remainingSourceTabs = await api.tabs.query({ windowId: sourceWindowId });
          } catch {
            try {
              const currentWindows = await api.windows.getAll({
                populate: true,
                windowTypes: ['normal'],
              });
              const remainingSourceWindow = currentWindows.find(
                (window) => window.id === sourceWindowId,
              );
              if (!remainingSourceWindow) {
                mergedSourceWindowIds.push(sourceWindowId);
                continue;
              }
              remainingSourceTabs = remainingSourceWindow.tabs;
            } catch {
              warnings.push(
                `Window ${sourceWindowId} was left open because its final state could not be verified.`,
              );
              continue;
            }
          }
          if (!remainingSourceTabs || remainingSourceTabs.length > 0) {
            warnings.push(
              `Window ${sourceWindowId} still has tabs after the merge and was left open.`,
            );
            continue;
          }
          mergedSourceWindowIds.push(sourceWindowId);
        }
      }

      const movedSet = new Set(movedTabIds);
      const restorableGroupIds = new Set(
        originalSourceGroups.flatMap((group) =>
          associationProtectedGroupIds.has(group.id) ? [] : [group.id],
        ),
      );
      warnings.push(
        ...(await restoreTabGroups(
          api,
          originalSourceTabs,
          originalSourceGroups,
          destinationWindowId,
          movedSet,
          restorableGroupIds,
        )),
      );

      const managerWindowId = managerWindow.id;
      if (managerWindowId !== undefined) {
        const focusWindowId = sourceWindowIds.includes(managerWindowId)
          ? destinationWindowId
          : managerWindowId;
        try {
          await api.windows.update(focusWindowId, { focused: true });
        } catch {
          // A concurrent close should not turn a completed merge into a failure.
        }
      }

      return {
        destinationWindowId,
        failures,
        mergedSourceWindowIds,
        movedTabIds,
        warnings,
      };
    },

    async moveTab(tabId, destinationWindowId, insertionIndex, destinationGroupId = null) {
      const [allTabs, allGroups] = await Promise.all([api.tabs.query({}), api.tabGroups.query({})]);
      const tab = allTabs.find((candidate) => candidate.id === tabId);
      if (!tab) {
        throw new Error('The tab no longer exists.');
      }
      const destinationGroup =
        destinationGroupId === null
          ? null
          : allGroups.find(
              (group) => group.id === destinationGroupId && group.windowId === destinationWindowId,
            );
      if (destinationGroupId !== null && !destinationGroup) {
        throw new Error('The destination tab group no longer exists.');
      }
      if (destinationGroupId !== null && tab.pinned) {
        throw new Error(PINNED_TAB_GROUP_MOVE_ERROR_MESSAGE);
      }

      const destinationTabs = getTabsInBrowserOrder(
        allTabs.filter(
          (candidate) => candidate.windowId === destinationWindowId && candidate.id !== tabId,
        ),
      );
      let adjustedInsertionIndex = insertionIndex;
      if (
        insertionIndex >= 0 &&
        tab.windowId === destinationWindowId &&
        tab.index < insertionIndex
      ) {
        adjustedInsertionIndex -= 1;
      }
      let destinationIndex =
        adjustedInsertionIndex < 0
          ? destinationTabs.length
          : Math.min(Math.max(adjustedInsertionIndex, 0), destinationTabs.length);

      const pinnedTabs = destinationTabs.filter((candidate) => candidate.pinned).length;
      destinationIndex = tab.pinned
        ? Math.min(destinationIndex, pinnedTabs)
        : Math.max(destinationIndex, pinnedTabs);

      if (destinationGroupId !== null) {
        const warnings: string[] = [];
        const destinationGroupTabs = destinationTabs.filter(
          (candidate) => candidate.groupId === destinationGroupId,
        );
        const firstGroupTab = destinationGroupTabs[0];
        if (!firstGroupTab) {
          if (tab.windowId === destinationWindowId && tab.groupId === destinationGroupId) {
            return {
              destinationIndex: tab.index,
              destinationWindowId,
              movedTabId: tabId,
              warnings: [],
            };
          }
          throw new Error('The destination tab group no longer has any tabs.');
        }
        const groupStartIndex = destinationTabs.indexOf(firstGroupTab);
        const groupEndIndex = groupStartIndex + destinationGroupTabs.length;
        destinationIndex = Math.min(Math.max(destinationIndex, groupStartIndex), groupEndIndex);

        if (tab.windowId === destinationWindowId && tab.groupId === destinationGroupId) {
          if (tab.index !== destinationIndex) {
            await api.tabs.move(tabId, {
              index: destinationIndex,
              windowId: destinationWindowId,
            });
          }
          return {
            destinationIndex,
            destinationWindowId,
            movedTabId: tabId,
            warnings: [],
          };
        }

        if (tab.windowId !== destinationWindowId) {
          const completion = await moveTabAcrossWindows(
            api,
            tab as chrome.tabs.Tab & { id: number },
            destinationWindowId,
            -1,
          );
          warnings.push(...completion.warnings);
        }
        await api.tabs.group({ groupId: destinationGroupId, tabIds: tabId });
        await api.tabs.move(tabId, { index: destinationIndex, windowId: destinationWindowId });

        return {
          destinationIndex,
          destinationWindowId,
          movedTabId: tabId,
          warnings,
        };
      }

      if (
        tab.windowId === destinationWindowId &&
        tab.index === destinationIndex &&
        tab.groupId < 0
      ) {
        return {
          destinationIndex,
          destinationWindowId,
          movedTabId: tabId,
          warnings: [],
        };
      }

      if (tab.groupId >= 0) {
        await api.tabs.ungroup(tabId);
      }
      const warnings: string[] = [];
      if (tab.windowId !== destinationWindowId) {
        const completion = await moveTabAcrossWindows(
          api,
          tab as chrome.tabs.Tab & { id: number },
          destinationWindowId,
          destinationIndex,
        );
        warnings.push(...completion.warnings);
      } else if (tab.index !== destinationIndex) {
        await api.tabs.move(tabId, { index: destinationIndex, windowId: destinationWindowId });
      }

      return {
        destinationIndex,
        destinationWindowId,
        movedTabId: tabId,
        warnings,
      };
    },

    async moveTabGroup(groupId, destinationWindowId, insertionIndex) {
      const [allTabs, allGroups] = await Promise.all([api.tabs.query({}), api.tabGroups.query({})]);
      const group = allGroups.find((candidate) => candidate.id === groupId);
      if (!group) {
        throw new Error('The tab group no longer exists.');
      }

      const groupTabs = getTabsInBrowserOrder(
        allTabs.filter((tab) => tab.groupId === groupId),
      ).filter((tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined);
      if (groupTabs.length === 0) {
        throw new Error('The tab group no longer has any tabs.');
      }

      const groupTabIds = groupTabs.map((tab) => tab.id);
      const groupTabIdSet = new Set(groupTabIds);
      const destinationTabs = getTabsInBrowserOrder(
        allTabs.filter(
          (tab) => tab.windowId === destinationWindowId && !groupTabIdSet.has(tab.id ?? -1),
        ),
      );
      const activeDestinationTabId =
        group.windowId === destinationWindowId
          ? undefined
          : destinationTabs.find((tab) => tab.active)?.id;
      let adjustedInsertionIndex = insertionIndex;
      if (insertionIndex >= 0 && group.windowId === destinationWindowId) {
        adjustedInsertionIndex -= groupTabs.filter((tab) => tab.index < insertionIndex).length;
      }
      let destinationIndex =
        adjustedInsertionIndex < 0
          ? destinationTabs.length
          : Math.min(Math.max(adjustedInsertionIndex, 0), destinationTabs.length);
      const pinnedTabs = destinationTabs.filter((tab) => tab.pinned).length;
      destinationIndex = Math.max(destinationIndex, pinnedTabs);

      if (group.windowId === destinationWindowId) {
        const currentOrder = getTabsInBrowserOrder(
          allTabs.filter((tab) => tab.windowId === destinationWindowId),
        ).flatMap((tab) => (tab.id === undefined ? [] : [tab.id]));
        const desiredOrder = destinationTabs.flatMap((tab) =>
          tab.id === undefined ? [] : [tab.id],
        );
        desiredOrder.splice(destinationIndex, 0, ...groupTabIds);
        if (
          currentOrder.length === desiredOrder.length &&
          currentOrder.every((tabId, index) => tabId === desiredOrder[index])
        ) {
          return {
            destinationWindowId,
            failures: [],
            movedTabIds: groupTabIds,
            warnings: [],
          };
        }
      }

      const movedGroup = await api.tabGroups.move(groupId, {
        index: destinationIndex,
        windowId: destinationWindowId,
      });
      if (!movedGroup || movedGroup.id !== groupId) {
        throw new Error('The browser did not return the moved tab group.');
      }
      if (movedGroup.windowId !== destinationWindowId) {
        throw new Error('The tab group did not reach the destination window.');
      }
      const warnings: string[] = [];
      if (activeDestinationTabId !== undefined) {
        try {
          await api.tabs.update(activeDestinationTabId, { active: true });
        } catch (error) {
          warnings.push(
            `The previously active tab could not be restored. ${describeChromeError(error)}`,
          );
        }
      }
      return {
        destinationWindowId,
        failures: [],
        movedTabIds: groupTabIds,
        warnings,
      };
    },

    async moveTabsToNewWindow(tabIds, preserveGroupIds = []) {
      const requestedTabIds = [...new Set(tabIds)];
      if (requestedTabIds.length === 0) {
        return {
          destinationWindowId: null,
          failures: [],
          movedTabIds: [],
          warnings: [],
        };
      }

      const [managerWindow, allTabs, allGroups] = await Promise.all([
        api.windows.getCurrent(),
        api.tabs.query({}),
        api.tabGroups.query({}),
      ]);
      const tabsById = new Map(
        allTabs.flatMap((tab) => (tab.id === undefined ? [] : [[tab.id, tab] as const])),
      );
      const failures: TabOperationFailure[] = [];
      const requestedTabs = requestedTabIds.flatMap((tabId) => {
        const tab = tabsById.get(tabId);
        if (!tab) {
          failures.push({ message: 'The tab no longer exists.', tabId });
          return [];
        }
        return [tab as chrome.tabs.Tab & { id: number }];
      });
      const groupsById = new Map(allGroups.map((group) => [group.id, group]));
      const readableRequestedTabs = requestedTabs.filter((tab) => {
        if (tab.groupId < 0) {
          return true;
        }
        const group = groupsById.get(tab.groupId);
        if (group?.windowId === tab.windowId) {
          return true;
        }
        failures.push({
          message: 'The latest tab group state could not be read, so the tab was left in place.',
          tabId: tab.id,
        });
        return false;
      });
      const requestedTabIdSet = new Set(readableRequestedTabs.map((tab) => tab.id));
      const associationProtectedGroupIds = getAssociationProtectedGroupIds(allTabs, allGroups);
      const rejectedAssociationProtectedTabIds = new Set<number>();
      const requestedAssociationProtectedGroupIds = new Set(
        readableRequestedTabs.flatMap((tab) =>
          tab.groupId >= 0 && associationProtectedGroupIds.has(tab.groupId) ? [tab.groupId] : [],
        ),
      );
      requestedAssociationProtectedGroupIds.forEach((groupId) => {
        const groupTabIds = allTabs.flatMap((tab) =>
          tab.groupId === groupId && tab.id !== undefined ? [tab.id] : [],
        );
        if (groupTabIds.length > 0 && groupTabIds.every((tabId) => requestedTabIdSet.has(tabId))) {
          return;
        }
        readableRequestedTabs.forEach((tab) => {
          if (tab.groupId === groupId) {
            rejectedAssociationProtectedTabIds.add(tab.id);
            failures.push({
              message: 'Groups containing agent-associated tabs must be moved as a whole.',
              tabId: tab.id,
            });
          }
        });
      });
      const movableTabs = readableRequestedTabs.filter(
        (tab) => !rejectedAssociationProtectedTabIds.has(tab.id),
      );
      const orderedTabs = [
        ...movableTabs.filter((tab) => tab.pinned),
        ...movableTabs.filter((tab) => !tab.pinned),
      ];

      const firstTab = orderedTabs[0];
      if (firstTab?.id === undefined) {
        return {
          destinationWindowId: null,
          failures,
          movedTabIds: [],
          warnings: [],
        };
      }

      const preservedGroupIds = new Set([
        ...preserveGroupIds,
        ...requestedAssociationProtectedGroupIds,
      ]);
      const tabIdsToUngroup = orderedTabs.flatMap((tab) =>
        tab.id !== undefined && tab.groupId >= 0 && !preservedGroupIds.has(tab.groupId)
          ? [tab.id]
          : [],
      );

      const firstTabIsInAssociationProtectedGroup =
        firstTab.groupId >= 0 && associationProtectedGroupIds.has(firstTab.groupId);
      const destination = await api.windows.create(
        firstTabIsInAssociationProtectedGroup
          ? { focused: false }
          : { focused: false, tabId: firstTab.id },
      );
      if (destination?.id === undefined) {
        throw new Error('The browser did not create the destination window.');
      }

      const movedTabIds: number[] = [];
      const warnings: string[] = [];
      let restoredPinnedTabCount = 0;
      let activeDestinationTabId: number | undefined;
      let placeholderTabIds: number[] = [];
      if (firstTabIsInAssociationProtectedGroup) {
        if (destination.tabs) {
          placeholderTabIds = destination.tabs.flatMap((tab) =>
            tab.id === undefined ? [] : [tab.id],
          );
        } else {
          try {
            placeholderTabIds = (await api.tabs.query({ windowId: destination.id })).flatMap(
              (tab) => (tab.id === undefined ? [] : [tab.id]),
            );
          } catch (error) {
            warnings.push(
              `The new window placeholder tab could not be identified: ${describeChromeError(error)}`,
            );
          }
        }
      }
      if (!firstTabIsInAssociationProtectedGroup) {
        try {
          const adoptedTab =
            destination.tabs?.find((candidate) => candidate.id === firstTab.id) ??
            (await api.tabs.get(firstTab.id));
          const firstCompletion = await finishCrossWindowTabMove(
            api,
            firstTab,
            destination.id,
            0,
            adoptedTab,
          );
          movedTabIds.push(firstTab.id);
          warnings.push(...firstCompletion.warnings);
          restoredPinnedTabCount = firstTab.pinned && firstCompletion.pinRestored ? 1 : 0;
          activeDestinationTabId = firstTab.id;
        } catch (error) {
          failures.push({ message: describeChromeError(error), tabId: firstTab.id });
        }
      }

      const remainingTabIdsToUngroup = firstTabIsInAssociationProtectedGroup
        ? tabIdsToUngroup
        : tabIdsToUngroup.filter((tabId) => tabId !== firstTab.id);
      const tabsBlockedByUngroupFailure = new Set<number>();
      if (remainingTabIdsToUngroup.length > 0) {
        try {
          await api.tabs.ungroup(remainingTabIdsToUngroup as [number, ...number[]]);
        } catch (error) {
          const message = `The tab could not be ungrouped before moving: ${describeChromeError(error)}`;
          remainingTabIdsToUngroup.forEach((tabId) => {
            tabsBlockedByUngroupFailure.add(tabId);
            failures.push({ message, tabId });
          });
        }
      }

      const movedAssociationProtectedGroupIds = new Set<number>();
      const remainingTabs = (
        firstTabIsInAssociationProtectedGroup ? orderedTabs : orderedTabs.slice(1)
      ).filter((tab) => !tabsBlockedByUngroupFailure.has(tab.id));
      for (const tab of remainingTabs) {
        if (tab.groupId >= 0 && associationProtectedGroupIds.has(tab.groupId)) {
          if (movedAssociationProtectedGroupIds.has(tab.groupId)) {
            continue;
          }
          movedAssociationProtectedGroupIds.add(tab.groupId);
          const associationProtectedGroupTabIds = orderedTabs
            .filter((candidate) => candidate.groupId === tab.groupId)
            .map((candidate) => candidate.id);
          try {
            warnings.push(
              ...(await moveAssociationProtectedGroupAcrossWindows(
                api,
                tab.groupId,
                associationProtectedGroupTabIds,
                destination.id,
                -1,
                activeDestinationTabId,
              )),
            );
            movedTabIds.push(...associationProtectedGroupTabIds);
          } catch (error) {
            const message = describeChromeError(error);
            failures.push(...associationProtectedGroupTabIds.map((tabId) => ({ message, tabId })));
          }
          continue;
        }

        try {
          const completion = await moveTabAcrossWindows(
            api,
            tab,
            destination.id,
            -1,
            tab.pinned ? restoredPinnedTabCount : -1,
          );
          movedTabIds.push(tab.id);
          warnings.push(...completion.warnings);
          if (tab.pinned && completion.pinRestored) {
            restoredPinnedTabCount += 1;
          }
        } catch (error) {
          failures.push({ message: describeChromeError(error), tabId: tab.id });
        }
      }

      if (movedTabIds.length > 0) {
        for (const placeholderTabId of placeholderTabIds) {
          try {
            await api.tabs.remove(placeholderTabId);
          } catch (error) {
            warnings.push(
              `The new window placeholder tab could not be closed: ${describeChromeError(error)}`,
            );
          }
        }
      }

      const movedSet = new Set(movedTabIds);
      const restorableGroupIds = new Set(
        [...preservedGroupIds].filter((groupId) => !associationProtectedGroupIds.has(groupId)),
      );
      warnings.push(
        ...(await restoreTabGroups(
          api,
          orderedTabs,
          allGroups,
          destination.id,
          movedSet,
          restorableGroupIds,
        )),
      );

      if (managerWindow.id !== undefined) {
        try {
          await api.windows.update(managerWindow.id, { focused: true });
        } catch {
          // The manager's source window may have closed after its final tab moved.
        }
      }

      return {
        destinationWindowId: destination.id,
        failures,
        movedTabIds,
        warnings,
      };
    },

    sortAllWindows(options) {
      return sortWindows(null, options);
    },

    sortWindow(windowId, options) {
      return sortWindows([windowId], options);
    },

    subscribe(listener) {
      const cleanups: Array<() => void> = [];
      addEventSubscription(api.tabs.onActivated, listener, cleanups);
      addEventSubscription(api.tabs.onAttached, listener, cleanups);
      addEventSubscription(api.tabs.onCreated, listener, cleanups);
      addEventSubscription(api.tabs.onDetached, listener, cleanups);
      addEventSubscription(api.tabs.onMoved, listener, cleanups);
      addEventSubscription(api.tabs.onRemoved, listener, cleanups);
      addEventSubscription(api.tabs.onReplaced, listener, cleanups);
      addEventSubscription(api.tabs.onUpdated, listener, cleanups, (_tabId, changeInfo) =>
        changesActiveWindowsSnapshot(changeInfo),
      );
      addEventSubscription(api.windows.onCreated, listener, cleanups);
      addEventSubscription(api.windows.onFocusChanged, listener, cleanups);
      addEventSubscription(api.windows.onRemoved, listener, cleanups);
      addEventSubscription(api.tabGroups.onCreated, listener, cleanups);
      addEventSubscription(api.tabGroups.onMoved, listener, cleanups);
      addEventSubscription(api.tabGroups.onRemoved, listener, cleanups);
      addEventSubscription(api.tabGroups.onUpdated, listener, cleanups);
      cleanups.push(restoredTabMetadataService.subscribe(listener));

      return () => {
        cleanups.forEach((cleanup) => cleanup());
      };
    },

    subscribeWindowCount(listener) {
      // Preserve transient Codex badge continuity off full-snapshot routes without
      // notifying the count subscriber or querying tab/group collections.
      const handleCreated = (window: chrome.windows.Window) => {
        if (isManagedChromeWindow(window)) {
          listener();
        }
      };
      const handleRemoved = () => listener();
      const handleTabCreated = (tab: chrome.tabs.Tab) => {
        detectAgentAssociation(tab, null);
      };
      const handleTabRemoved = (tabId: number) => {
        recentCodexExtensionDetectionByTabId.delete(tabId);
      };
      const handleTabReplaced = (addedTabId: number, removedTabId: number) => {
        recentCodexExtensionDetectionByTabId.delete(removedTabId);
        recentCodexExtensionDetectionByTabId.delete(addedTabId);
      };
      const handleTabUpdated = (
        _tabId: number,
        changeInfo: chrome.tabs.OnUpdatedInfo,
        tab: chrome.tabs.Tab,
      ) => {
        if (!('favIconUrl' in changeInfo || 'status' in changeInfo || 'url' in changeInfo)) {
          return;
        }
        detectAgentAssociation(tab, null);
      };
      api.windows.onCreated.addListener(handleCreated);
      api.windows.onRemoved.addListener(handleRemoved);
      api.tabs.onCreated.addListener(handleTabCreated);
      api.tabs.onRemoved.addListener(handleTabRemoved);
      api.tabs.onReplaced.addListener(handleTabReplaced);
      api.tabs.onUpdated.addListener(handleTabUpdated);

      return () => {
        api.windows.onCreated.removeListener(handleCreated);
        api.windows.onRemoved.removeListener(handleRemoved);
        api.tabs.onCreated.removeListener(handleTabCreated);
        api.tabs.onRemoved.removeListener(handleTabRemoved);
        api.tabs.onReplaced.removeListener(handleTabReplaced);
        api.tabs.onUpdated.removeListener(handleTabUpdated);
      };
    },

    async focusWindow(windowId) {
      await api.windows.update(windowId, { focused: true });
    },

    async focusTab(windowId, tabId) {
      // Focusing another window dismisses a toolbar popup and can terminate its caller.
      await api.tabs.update(tabId, { active: true });
      await api.windows.update(windowId, { focused: true });
    },

    async pinTab(tabId) {
      await api.tabs.update(tabId, { pinned: true });
    },

    async unpinTab(tabId) {
      await api.tabs.update(tabId, { pinned: false });
    },
  };
}
