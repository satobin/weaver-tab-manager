import { createTabUrlCanonicalizer, type DedupeRule } from '../deduplication/deduplication';
import {
  isTabOrderSorted,
  planTabSort,
  type SortableTab,
  type TabSortOptions,
} from '../active-windows/tabSort';
import {
  cloneSavedWindow,
  normalizeSavedWindowName,
  parseSavedWindow,
  type SavedWindow,
} from './savedWindowModel';

export interface SavedWindowDuplicateTabReference {
  tabOrder: number;
  windowId: string;
}

export interface SavedWindowDuplicateGroup {
  keepTab: SavedWindowDuplicateTabReference;
  removeTabs: readonly SavedWindowDuplicateTabReference[];
}

export interface SavedWindowDuplicatePlan {
  duplicateGroups: readonly SavedWindowDuplicateGroup[];
  duplicateGroupCount: number;
  duplicateTabCount: number;
}

export interface DeduplicateSavedWindowsResult {
  duplicateGroupCount: number;
  removedTabCount: number;
  removedWindowIds: readonly string[];
  updatedWindowIds: readonly string[];
}

export interface MergeSavedWindowsResult {
  destinationWindow: SavedWindow;
  mergedSourceWindowIds: readonly string[];
}

export interface SavedTabSelectionReference {
  expectedTab: SavedWindow['tabs'][number];
  expectedWindowUpdatedAt: string;
  tabOrder: number;
  windowId: string;
}

export interface RemoveSelectedSavedTabsResult {
  removedTabCount: number;
  removedWindowIds: readonly string[];
}

export interface MoveSelectedSavedTabsResult {
  createdWindow: SavedWindow;
  movedTabCount: number;
  removedSourceWindowIds: readonly string[];
}

export interface SortSavedWindowsResult {
  sortedWindowIds: readonly string[];
}

interface SavedTabEntry {
  active: boolean;
  pinned: boolean;
  savedAt: string;
  tabOrder: number;
  url: string;
  windowId: string;
  windowIndex: number;
}

interface SavedWindowTransform<T> {
  result: T;
  windows: SavedWindow[];
}

function getSavedAt(savedWindow: SavedWindow, tab: SavedWindow['tabs'][number]): string {
  return tab.savedAt ?? savedWindow.createdAt;
}

function compareNewestFirst(left: SavedTabEntry, right: SavedTabEntry): number {
  const timestampDifference = Date.parse(right.savedAt) - Date.parse(left.savedAt);
  if (timestampDifference !== 0) {
    return timestampDifference;
  }
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }
  if (left.active !== right.active) {
    return left.active ? -1 : 1;
  }
  if (left.windowIndex !== right.windowIndex) {
    return left.windowIndex - right.windowIndex;
  }
  return left.tabOrder - right.tabOrder;
}

function getDuplicateEntries(
  windows: readonly SavedWindow[],
  rules: readonly DedupeRule[],
): { duplicateGroups: SavedWindowDuplicateGroup[]; entries: SavedTabEntry[] } {
  const canonicalize = createTabUrlCanonicalizer(rules);
  const buckets = new Map<string, SavedTabEntry[]>();
  windows.forEach((savedWindow, windowIndex) => {
    savedWindow.tabs.forEach((tab) => {
      const entry: SavedTabEntry = {
        active: tab.active,
        pinned: tab.pinned,
        savedAt: getSavedAt(savedWindow, tab),
        tabOrder: tab.order,
        url: tab.url,
        windowId: savedWindow.id,
        windowIndex,
      };
      const key = canonicalize(tab.url).key;
      const matching = buckets.get(key) ?? [];
      matching.push(entry);
      buckets.set(key, matching);
    });
  });

  const duplicateGroups: SavedWindowDuplicateGroup[] = [];
  const entries: SavedTabEntry[] = [];
  buckets.forEach((matching) => {
    if (matching.length < 2) {
      return;
    }
    const sorted = matching.sort(compareNewestFirst);
    const keepEntry = sorted[0] as SavedTabEntry;
    const removeEntries = sorted.slice(1);
    duplicateGroups.push({
      keepTab: { tabOrder: keepEntry.tabOrder, windowId: keepEntry.windowId },
      removeTabs: removeEntries.map((entry) => ({
        tabOrder: entry.tabOrder,
        windowId: entry.windowId,
      })),
    });
    entries.push(...removeEntries);
  });
  return { duplicateGroups, entries };
}

export function planSavedWindowDeduplication(
  windows: readonly SavedWindow[],
  rules: readonly DedupeRule[],
): SavedWindowDuplicatePlan {
  const duplicateEntries = getDuplicateEntries(windows, rules);
  return {
    duplicateGroups: duplicateEntries.duplicateGroups,
    duplicateGroupCount: duplicateEntries.duplicateGroups.length,
    duplicateTabCount: duplicateEntries.entries.length,
  };
}

export function getSavedWindowMutationTimestamp(
  operationTimestamp: string,
  windows: readonly SavedWindow[],
): string {
  const latestRevision = Math.max(...windows.map((window) => Date.parse(window.updatedAt)));
  return new Date(Math.max(Date.parse(operationTimestamp), latestRevision + 1)).toISOString();
}

function assertValidSavedWindow(savedWindow: SavedWindow): SavedWindow {
  const parsed = parseSavedWindow(savedWindow);
  if (!parsed) {
    throw new Error('The saved-window operation produced an invalid snapshot.');
  }
  return parsed;
}

function assertValidTabSortOptions(options: TabSortOptions): void {
  if (
    (options.criterion !== 'title' && options.criterion !== 'url') ||
    (options.direction !== 'asc' && options.direction !== 'desc')
  ) {
    throw new Error('Choose a valid saved-tab sort order.');
  }
}

function getSortableSavedTabs(savedWindow: SavedWindow): SortableTab[] {
  const groupIds = new Map(savedWindow.groups.map((group, index) => [group.key, index + 1]));
  return savedWindow.tabs.map((tab) => ({
    agentAssociated: false,
    groupId: tab.groupKey ? (groupIds.get(tab.groupKey) ?? null) : null,
    id: tab.order,
    index: tab.order,
    pinned: tab.pinned,
    title: tab.title,
    url: tab.url,
  }));
}

export function isSavedWindowTabOrderSorted(
  savedWindow: SavedWindow,
  options: TabSortOptions,
): boolean {
  assertValidTabSortOptions(options);
  const validatedWindow = assertValidSavedWindow(savedWindow);
  return isTabOrderSorted(getSortableSavedTabs(validatedWindow), options);
}

export function sortSavedWindows(
  windows: readonly SavedWindow[],
  requestedWindowIds: readonly string[] | null,
  options: TabSortOptions,
  operationTimestamp: string,
): SavedWindowTransform<SortSavedWindowsResult> {
  assertValidTabSortOptions(options);
  const validatedWindows = windows.map(assertValidSavedWindow);
  const windowsById = new Map<string, SavedWindow>();
  validatedWindows.forEach((savedWindow) => {
    if (windowsById.has(savedWindow.id)) {
      throw new Error('The saved-window collection contains duplicate IDs.');
    }
    windowsById.set(savedWindow.id, savedWindow);
  });

  const targetWindowIds = requestedWindowIds
    ? [...new Set(requestedWindowIds)]
    : validatedWindows.map((savedWindow) => savedWindow.id);
  if (requestedWindowIds && targetWindowIds.length === 0) {
    throw new Error('Select at least one saved window to sort.');
  }
  targetWindowIds.forEach((savedWindowId) => {
    if (typeof savedWindowId !== 'string' || !savedWindowId || !windowsById.has(savedWindowId)) {
      throw new Error('A selected saved window no longer exists.');
    }
  });

  const targetIds = new Set(targetWindowIds);
  const sortedWindowIds: string[] = [];
  const nextWindows = validatedWindows.map((savedWindow) => {
    if (!targetIds.has(savedWindow.id)) {
      return cloneSavedWindow(savedWindow);
    }

    const sortableTabs = getSortableSavedTabs(savedWindow);
    if (isTabOrderSorted(sortableTabs, options)) {
      return cloneSavedWindow(savedWindow);
    }
    const tabByOriginalOrder = new Map(savedWindow.tabs.map((tab) => [tab.order, tab]));
    const tabs = planTabSort(sortableTabs, options).map((plannedTab, order) => {
      const tab = tabByOriginalOrder.get(plannedTab.id);
      if (!tab) {
        throw new Error('The saved-window sort plan referenced a missing tab.');
      }
      return { ...tab, order };
    });
    const sortedWindow = assertValidSavedWindow({
      ...cloneSavedWindow(savedWindow),
      tabs,
      updatedAt: getSavedWindowMutationTimestamp(operationTimestamp, [savedWindow]),
    });
    sortedWindowIds.push(savedWindow.id);
    return sortedWindow;
  });

  return {
    result: { sortedWindowIds },
    windows: nextWindows,
  };
}

function savedTabsMatch(
  left: SavedWindow['tabs'][number],
  right: SavedWindow['tabs'][number],
): boolean {
  return (
    left.active === right.active &&
    left.groupKey === right.groupKey &&
    left.order === right.order &&
    left.pinned === right.pinned &&
    left.savedAt === right.savedAt &&
    left.title === right.title &&
    left.url === right.url
  );
}

interface SelectedSavedTabEntry {
  savedWindow: SavedWindow;
  tab: SavedWindow['tabs'][number];
  windowIndex: number;
}

function resolveSelectedSavedTabs(
  windows: readonly SavedWindow[],
  references: readonly SavedTabSelectionReference[],
): SelectedSavedTabEntry[] {
  if (references.length === 0) {
    throw new Error('Select at least one saved tab.');
  }

  const windowsById = new Map(
    windows.map((savedWindow, windowIndex) => [savedWindow.id, { savedWindow, windowIndex }]),
  );
  const referenceByLocation = new Map<string, SavedTabSelectionReference>();
  references.forEach((reference) => {
    const location = JSON.stringify([reference.windowId, reference.tabOrder]);
    const existing = referenceByLocation.get(location);
    if (existing) {
      if (
        existing.expectedWindowUpdatedAt !== reference.expectedWindowUpdatedAt ||
        !savedTabsMatch(existing.expectedTab, reference.expectedTab)
      ) {
        throw new Error('The selected saved tabs changed. Review the selection and try again.');
      }
      return;
    }
    referenceByLocation.set(location, reference);
  });

  const selected = [...referenceByLocation.values()].map((reference) => {
    const source = windowsById.get(reference.windowId);
    const tab = source?.savedWindow.tabs[reference.tabOrder];
    if (
      !source ||
      source.savedWindow.updatedAt !== reference.expectedWindowUpdatedAt ||
      !tab ||
      tab.order !== reference.tabOrder ||
      !savedTabsMatch(tab, reference.expectedTab)
    ) {
      throw new Error('The selected saved tabs changed. Review the selection and try again.');
    }
    return { ...source, tab };
  });

  return selected.sort(
    (left, right) => left.windowIndex - right.windowIndex || left.tab.order - right.tab.order,
  );
}

function rebuildSavedWindowAfterTabRemoval(
  savedWindow: SavedWindow,
  removedOrders: ReadonlySet<number>,
  operationTimestamp: string,
): SavedWindow | null {
  const retainedTabs = savedWindow.tabs.filter((tab) => !removedOrders.has(tab.order));
  if (retainedTabs.length === 0) {
    return null;
  }
  const retainedActiveOrder = retainedTabs.find((tab) => tab.active)?.order;
  const activeOrder = retainedActiveOrder ?? retainedTabs[0]?.order;
  const tabs = retainedTabs.map((tab, order) => ({
    ...tab,
    active: tab.order === activeOrder,
    order,
    savedAt: getSavedAt(savedWindow, tab),
  }));
  const retainedGroupKeys = new Set(
    tabs.flatMap((tab) => (tab.groupKey === undefined ? [] : [tab.groupKey])),
  );
  return assertValidSavedWindow({
    ...cloneSavedWindow(savedWindow),
    groups: savedWindow.groups
      .filter((group) => retainedGroupKeys.has(group.key))
      .map((group) => ({ ...group })),
    tabs,
    updatedAt: getSavedWindowMutationTimestamp(operationTimestamp, [savedWindow]),
  });
}

export function removeSelectedSavedTabs(
  windows: readonly SavedWindow[],
  references: readonly SavedTabSelectionReference[],
  operationTimestamp: string,
): SavedWindowTransform<RemoveSelectedSavedTabsResult> {
  const selected = resolveSelectedSavedTabs(windows, references);
  const removedOrdersByWindowId = new Map<string, Set<number>>();
  selected.forEach(({ savedWindow, tab }) => {
    const orders = removedOrdersByWindowId.get(savedWindow.id) ?? new Set<number>();
    orders.add(tab.order);
    removedOrdersByWindowId.set(savedWindow.id, orders);
  });

  const removedWindowIds: string[] = [];
  const nextWindows = windows.flatMap((savedWindow) => {
    const removedOrders = removedOrdersByWindowId.get(savedWindow.id);
    if (!removedOrders) {
      return [cloneSavedWindow(savedWindow)];
    }
    const updated = rebuildSavedWindowAfterTabRemoval(
      savedWindow,
      removedOrders,
      operationTimestamp,
    );
    if (!updated) {
      removedWindowIds.push(savedWindow.id);
      return [];
    }
    return [updated];
  });

  return {
    result: {
      removedTabCount: selected.length,
      removedWindowIds,
    },
    windows: nextWindows,
  };
}

export function moveSelectedSavedTabsToNewWindow(
  windows: readonly SavedWindow[],
  references: readonly SavedTabSelectionReference[],
  name: string,
  newWindowId: string,
  operationTimestamp: string,
): SavedWindowTransform<MoveSelectedSavedTabsResult> {
  const normalizedName = normalizeSavedWindowName(name);
  if (windows.some((savedWindow) => savedWindow.id === newWindowId)) {
    throw new Error('The new saved-window ID is already in use.');
  }
  const selected = resolveSelectedSavedTabs(windows, references);
  const removedOrdersByWindowId = new Map<string, Set<number>>();
  selected.forEach(({ savedWindow, tab }) => {
    const orders = removedOrdersByWindowId.get(savedWindow.id) ?? new Set<number>();
    orders.add(tab.order);
    removedOrdersByWindowId.set(savedWindow.id, orders);
  });

  const activeEntry = (selected.find(({ tab }) => tab.active) ??
    selected[0]) as SelectedSavedTabEntry;
  const usedGroupKeys = new Set<string>();
  const groupKeyBySource = new Map<string, string>();
  const groups: SavedWindow['groups'] = [];
  selected.forEach(({ savedWindow, tab }) => {
    if (!tab.groupKey) {
      return;
    }
    const sourceKey = JSON.stringify([savedWindow.id, tab.groupKey]);
    if (groupKeyBySource.has(sourceKey)) {
      return;
    }
    const group = savedWindow.groups.find((candidate) => candidate.key === tab.groupKey);
    if (!group) {
      throw new Error('A selected saved tab has invalid group metadata.');
    }
    const key = allocateGroupKey(group.key, usedGroupKeys);
    groupKeyBySource.set(sourceKey, key);
    groups.push({ ...group, key });
  });

  const movedTabs = selected.map(({ savedWindow, tab }) => {
    const movedTab = {
      ...tab,
      active: savedWindow.id === activeEntry.savedWindow.id && tab.order === activeEntry.tab.order,
      savedAt: getSavedAt(savedWindow, tab),
    };
    if (tab.groupKey) {
      const destinationGroupKey = groupKeyBySource.get(
        JSON.stringify([savedWindow.id, tab.groupKey]),
      );
      if (!destinationGroupKey) {
        throw new Error('A selected saved tab has invalid group metadata.');
      }
      movedTab.groupKey = destinationGroupKey;
    }
    return movedTab;
  });
  const orderedTabs = [
    ...movedTabs.filter((tab) => tab.pinned),
    ...movedTabs.filter((tab) => !tab.pinned),
  ].map((tab, order) => ({ ...tab, order }));
  const createdWindow = assertValidSavedWindow({
    createdAt: operationTimestamp,
    groups,
    id: newWindowId,
    name: normalizedName,
    tabs: orderedTabs,
    updatedAt: operationTimestamp,
  });

  const removedSourceWindowIds: string[] = [];
  const retainedSources = windows.flatMap((savedWindow) => {
    const removedOrders = removedOrdersByWindowId.get(savedWindow.id);
    if (!removedOrders) {
      return [cloneSavedWindow(savedWindow)];
    }
    const updated = rebuildSavedWindowAfterTabRemoval(
      savedWindow,
      removedOrders,
      operationTimestamp,
    );
    if (!updated) {
      removedSourceWindowIds.push(savedWindow.id);
      return [];
    }
    return [updated];
  });

  return {
    result: {
      createdWindow: cloneSavedWindow(createdWindow),
      movedTabCount: selected.length,
      removedSourceWindowIds,
    },
    windows: [createdWindow, ...retainedSources],
  };
}

export function deduplicateSavedWindows(
  windows: readonly SavedWindow[],
  rules: readonly DedupeRule[],
  operationTimestamp: string,
): SavedWindowTransform<DeduplicateSavedWindowsResult> {
  const duplicateEntries = getDuplicateEntries(windows, rules);
  const removedOrdersByWindowId = new Map<string, Set<number>>();
  duplicateEntries.entries.forEach((entry) => {
    const orders = removedOrdersByWindowId.get(entry.windowId) ?? new Set<number>();
    orders.add(entry.tabOrder);
    removedOrdersByWindowId.set(entry.windowId, orders);
  });

  const removedWindowIds: string[] = [];
  const updatedWindowIds: string[] = [];
  const nextWindows = windows.flatMap((savedWindow) => {
    const removedOrders = removedOrdersByWindowId.get(savedWindow.id);
    if (!removedOrders || removedOrders.size === 0) {
      return [cloneSavedWindow(savedWindow)];
    }

    const updated = rebuildSavedWindowAfterTabRemoval(
      savedWindow,
      removedOrders,
      operationTimestamp,
    );
    if (!updated) {
      removedWindowIds.push(savedWindow.id);
      return [];
    }
    updatedWindowIds.push(savedWindow.id);
    return [updated];
  });

  return {
    result: {
      duplicateGroupCount: duplicateEntries.duplicateGroups.length,
      removedTabCount: duplicateEntries.entries.length,
      removedWindowIds,
      updatedWindowIds,
    },
    windows: nextWindows,
  };
}

function allocateGroupKey(preferredKey: string, usedKeys: Set<string>): string {
  if (!usedKeys.has(preferredKey)) {
    usedKeys.add(preferredKey);
    return preferredKey;
  }
  let suffix = 2;
  while (usedKeys.has(`${preferredKey}-${suffix}`)) {
    suffix += 1;
  }
  const key = `${preferredKey}-${suffix}`;
  usedKeys.add(key);
  return key;
}

export function mergeSavedWindows(
  windows: readonly SavedWindow[],
  requestedWindowIds: readonly string[],
  name: string,
  operationTimestamp: string,
): SavedWindowTransform<MergeSavedWindowsResult> {
  const normalizedName = normalizeSavedWindowName(name);
  const savedWindowIds = [...new Set(requestedWindowIds)];
  if (savedWindowIds.length < 2) {
    throw new Error('Select at least two saved windows to merge.');
  }
  const windowsById = new Map(windows.map((savedWindow) => [savedWindow.id, savedWindow]));
  const selectedWindows = savedWindowIds.map((savedWindowId) => {
    const savedWindow = windowsById.get(savedWindowId);
    if (!savedWindow) {
      throw new Error('A selected saved window no longer exists.');
    }
    return savedWindow;
  });
  const destination = selectedWindows[0] as SavedWindow;
  const usedGroupKeys = new Set(destination.groups.map((group) => group.key));
  const groups = destination.groups.map((group) => ({ ...group }));
  const tabsByWindow = selectedWindows.map((savedWindow, windowIndex) => {
    const groupKeys = new Map<string, string>();
    if (windowIndex === 0) {
      savedWindow.groups.forEach((group) => groupKeys.set(group.key, group.key));
    } else {
      savedWindow.groups.forEach((group) => {
        const key = allocateGroupKey(group.key, usedGroupKeys);
        groupKeys.set(group.key, key);
        groups.push({ ...group, key });
      });
    }
    return savedWindow.tabs.map((tab) => {
      const mergedTab = {
        ...tab,
        active: windowIndex === 0 && tab.active,
        savedAt: getSavedAt(savedWindow, tab),
      };
      if (tab.groupKey) {
        const mergedGroupKey = groupKeys.get(tab.groupKey);
        if (mergedGroupKey) {
          mergedTab.groupKey = mergedGroupKey;
        }
      }
      return mergedTab;
    });
  });
  const combinedTabs = tabsByWindow.flat();
  const orderedTabs = [
    ...combinedTabs.filter((tab) => tab.pinned),
    ...combinedTabs.filter((tab) => !tab.pinned),
  ].map((tab, order) => ({ ...tab, order }));
  if (!orderedTabs.some((tab) => tab.active) && orderedTabs[0]) {
    orderedTabs[0] = { ...orderedTabs[0], active: true };
  }

  const destinationWindow = assertValidSavedWindow({
    ...cloneSavedWindow(destination),
    groups,
    name: normalizedName,
    tabs: orderedTabs,
    updatedAt: getSavedWindowMutationTimestamp(operationTimestamp, selectedWindows),
  });
  const sourceIds = new Set(savedWindowIds.slice(1));
  const nextWindows = windows.flatMap((savedWindow) => {
    if (savedWindow.id === destination.id) {
      return [destinationWindow];
    }
    return sourceIds.has(savedWindow.id) ? [] : [cloneSavedWindow(savedWindow)];
  });

  return {
    result: {
      destinationWindow: cloneSavedWindow(destinationWindow),
      mergedSourceWindowIds: savedWindowIds.slice(1),
    },
    windows: nextWindows,
  };
}
