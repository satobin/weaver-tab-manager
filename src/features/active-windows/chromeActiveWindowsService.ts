import {
  applyRestoredTabMetadata,
  createRestoredTabMetadataService,
  type RestoredTabMetadataChromeApi,
  type RestoredTabMetadataService,
} from '../../platform/chrome/restoredTabMetadata';
import { mapWithConcurrency } from '../../shared/mapWithConcurrency';
import {
  type ActiveWindowsSnapshot,
  type ManagedTab,
  type ManagedTabGroup,
  type ManagedWindow,
} from './model';
import { detectAgentAssociatedTab, isAgentAssociatedTab } from './agentManagedTabs';
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
  closeDuplicateTabs: (tabIds: readonly number[]) => Promise<CloseDuplicateTabsResult>;
  closeTabs: (tabIds: readonly number[]) => Promise<CloseTabsResult>;
  closeWindow: (windowId: number) => Promise<void>;
  focusTab: (windowId: number, tabId: number) => Promise<void>;
  focusWindow: (windowId: number) => Promise<void>;
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
  skippedAgentManagedTabIds: number[];
  skippedPinnedTabIds: number[];
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

interface CrossWindowMoveCompletion {
  pinRestored: boolean;
  warnings: string[];
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
): Promise<CrossWindowMoveCompletion> {
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

  try {
    const destinationTabs = getTabsInBrowserOrder(
      await api.tabs.query({ windowId: destinationWindowId }),
    );
    const movedTab = destinationTabs.find(
      (candidate) => candidate.id === tab.id && candidate.windowId === destinationWindowId,
    );
    if (!movedTab) {
      return {
        pinRestored: true,
        warnings: [
          `Tab ${tab.id} moved and was re-pinned, but its final position could not be verified.`,
        ],
      };
    }
    if (!movedTab.pinned) {
      return {
        pinRestored: false,
        warnings: [
          `Tab ${tab.id} moved, but the browser still reports it as unpinned after restoration.`,
        ],
      };
    }
    if (movedTab.index !== destinationIndex) {
      await api.tabs.move(tab.id, { index: destinationIndex, windowId: destinationWindowId });

      const correctedTabs = getTabsInBrowserOrder(
        await api.tabs.query({ windowId: destinationWindowId }),
      );
      const correctedTab = correctedTabs.find(
        (candidate) => candidate.id === tab.id && candidate.windowId === destinationWindowId,
      );
      if (!correctedTab) {
        return {
          pinRestored: true,
          warnings: [
            `Tab ${tab.id} moved and was re-pinned, but its corrected position could not be verified.`,
          ],
        };
      }
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
  } catch (error) {
    return {
      pinRestored: true,
      warnings: [
        `Tab ${tab.id} moved and was re-pinned, but its final position could not be restored: ${describeChromeError(error)}`,
      ],
    };
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
  await api.tabs.move(tab.id, { index: moveIndex, windowId: destinationWindowId });
  return finishCrossWindowTabMove(api, tab, destinationWindowId, finalIndex);
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
  group: chrome.tabGroups.TabGroup | null,
  extensionRootUrl: string,
  extensionIconUrl: string,
): ManagedTab | null {
  if (tab.id === undefined) {
    return null;
  }

  const url = tab.url ?? tab.pendingUrl ?? '';
  const agentDetection = detectAgentAssociatedTab(tab, group);
  return {
    active: tab.active,
    agentAssociated: agentDetection !== null,
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
          tab.groupId >= 0 ? (groupsById.get(tab.groupId) ?? null) : null,
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
    const [windows, groups] = await Promise.all([
      api.windows.getAll({ populate: true, windowTypes: ['normal'] }),
      api.tabGroups.query({}),
    ]);
    const resolvedWindows = await resolveWindowTabs(windows);
    const managedWindows = resolvedWindows.filter(isManagedChromeWindow);
    const windowsById = new Map(managedWindows.map((window) => [window.id, window]));
    const targetWindowIds = requestedWindowIds
      ? [...new Set(requestedWindowIds)]
      : managedWindows.map((window) => window.id);
    const result: SortWindowsResult = {
      failures: [],
      sortedWindowIds: [],
      warnings: [],
    };

    for (const windowId of targetWindowIds) {
      const window = windowsById.get(windowId);
      if (!window) {
        result.failures.push({ message: 'The window no longer exists.', windowId });
        continue;
      }

      const originalTabs = getTabsInBrowserOrder(window.tabs ?? []).filter(
        (tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined,
      );
      const desiredTabs = planTabSort(
        originalTabs.map((tab) => {
          const url = tab.url ?? tab.pendingUrl ?? '';
          return {
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
        if (!options.preserveGroups) {
          const groupedTabIds = originalTabs.filter((tab) => tab.groupId >= 0).map((tab) => tab.id);
          const [firstGroupedTabId, ...remainingGroupedTabIds] = groupedTabIds;
          if (firstGroupedTabId !== undefined) {
            await api.tabs.ungroup([firstGroupedTabId, ...remainingGroupedTabIds]);
          }
        }

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

      if (options.preserveGroups && groupSensitiveMoveCompleted) {
        const tabIds = new Set(originalTabs.map((tab) => tab.id));
        const warnings = await restoreTabGroups(api, originalTabs, groups, windowId, tabIds);
        result.warnings.push(...warnings.map((warning) => `${windowId}: ${warning}`));
      }
    }

    return result;
  };

  return {
    async closeDuplicateTabs(tabIds) {
      const requestedTabIds = [...new Set(tabIds)];
      const closedTabIds: number[] = [];
      const closedTabs: RestorableTab[] = [];
      const failures: TabOperationFailure[] = [];
      const skippedAgentManagedTabIds: number[] = [];
      const skippedPinnedTabIds: number[] = [];
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
            const snapshotTab = snapshotTabsById.get(tabId);
            if (!snapshotTab) {
              throw new Error('The tab no longer exists.');
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

            // The undo record comes from one pre-removal snapshot so concurrent
            // closes cannot shift later indices. Re-read only the pin state at
            // the mutation boundary so a tab pinned after the preview stays open.
            const liveTab = await api.tabs.get(tabId);
            if (liveTab.id !== tabId) {
              throw new Error('The browser returned a different tab than requested.');
            }
            if (liveTab.pinned) {
              return { skippedPinned: true as const, tabId };
            }

            if (isAgentAssociatedTab(liveTab, null)) {
              return { skippedAgentManaged: true as const, tabId };
            }

            const liveGroup =
              liveTab.groupId >= 0 ? await api.tabGroups.get(liveTab.groupId) : null;
            if (liveTab.groupId >= 0 && (!liveGroup || liveGroup.windowId !== liveTab.windowId)) {
              throw new Error(
                'The live tab group metadata could not be read, so the tab was left open.',
              );
            }
            if (isAgentAssociatedTab(liveTab, liveGroup)) {
              return { skippedAgentManaged: true as const, tabId };
            }

            const closedTab = createRestorableTabFromChromeTab(
              snapshotTab as chrome.tabs.Tab & { id: number },
              group,
            );
            await api.tabs.remove(tabId);
            return { closed: true as const, closedTab, tabId };
          } catch (error) {
            return { closed: false as const, error, tabId };
          }
        },
      );
      results.forEach((result) => {
        if ('skippedAgentManaged' in result) {
          skippedAgentManagedTabIds.push(result.tabId);
        } else if ('skippedPinned' in result) {
          skippedPinnedTabIds.push(result.tabId);
        } else if (result.closed) {
          closedTabIds.push(result.tabId);
          closedTabs.push(result.closedTab);
        } else {
          failures.push({ message: describeChromeError(result.error), tabId: result.tabId });
        }
      });
      return {
        closedTabIds,
        closedTabs,
        failures,
        skippedAgentManagedTabIds,
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
      const managedWindows = toManagedWindows(resolvedWindows, groups, currentWindow.id, api);

      return {
        extensionOrigin: api.runtime.getURL(''),
        totalTabs: managedWindows.reduce((total, window) => total + window.tabs.length, 0),
        windows: managedWindows,
      };
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
              title: group.title,
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

      const [managerWindow, windows, groups] = await Promise.all([
        api.windows.getCurrent(),
        api.windows.getAll({ populate: true, windowTypes: ['normal'] }),
        api.tabGroups.query({}),
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
      const destinationPinnedTabCount = (destinationWindow.tabs ?? []).filter(
        (tab) => tab.pinned,
      ).length;
      let restoredPinnedTabCount = 0;

      for (const sourceWindowId of sourceWindowIds) {
        const sourceWindow = windowsById.get(sourceWindowId);
        if (!sourceWindow) {
          warnings.push(`Window ${sourceWindowId} no longer exists and was skipped.`);
          continue;
        }

        const sourceTabs = getTabsInBrowserOrder(sourceWindow.tabs ?? []).filter(
          (tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined,
        );
        originalSourceTabs.push(...sourceTabs);
        let sourceFailed = false;
        for (const tab of sourceTabs) {
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
          mergedSourceWindowIds.push(sourceWindowId);
          try {
            await api.windows.remove(sourceWindowId);
          } catch {
            // Chrome may already close a source window after its final tab moves.
          }
        }
      }

      const movedSet = new Set(movedTabIds);
      warnings.push(
        ...(await restoreTabGroups(api, originalSourceTabs, groups, destinationWindowId, movedSet)),
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
      if (!movedGroup) {
        throw new Error('The browser did not return the moved tab group.');
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
        return [tab];
      });
      const orderedTabs = [
        ...requestedTabs.filter((tab) => tab.pinned),
        ...requestedTabs.filter((tab) => !tab.pinned),
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

      const preservedGroupIds = new Set(preserveGroupIds);
      const tabIdsToUngroup = orderedTabs.flatMap((tab) =>
        tab.id !== undefined && tab.groupId >= 0 && !preservedGroupIds.has(tab.groupId)
          ? [tab.id]
          : [],
      );
      if (tabIdsToUngroup.length > 0) {
        await api.tabs.ungroup(tabIdsToUngroup as [number, ...number[]]);
      }

      const destination = await api.windows.create({ focused: false, tabId: firstTab.id });
      if (destination?.id === undefined) {
        throw new Error('The browser did not create the destination window.');
      }

      const movedTabIds = [firstTab.id];
      const firstCompletion = await finishCrossWindowTabMove(
        api,
        firstTab as chrome.tabs.Tab & { id: number },
        destination.id,
        0,
      );
      const warnings = [...firstCompletion.warnings];
      let restoredPinnedTabCount = firstTab.pinned && firstCompletion.pinRestored ? 1 : 0;
      for (const tab of orderedTabs.slice(1)) {
        if (tab.id === undefined) {
          continue;
        }
        try {
          const completion = await moveTabAcrossWindows(
            api,
            tab as chrome.tabs.Tab & { id: number },
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

      const movedSet = new Set(movedTabIds);
      warnings.push(
        ...(await restoreTabGroups(
          api,
          orderedTabs,
          allGroups,
          destination.id,
          movedSet,
          preservedGroupIds,
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
