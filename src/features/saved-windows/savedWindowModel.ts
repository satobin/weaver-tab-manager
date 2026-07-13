import { type TabGroupColor } from '../active-windows/model';

export const SAVED_WINDOWS_SCHEMA_VERSION = 1;

interface SavedTabGroup {
  collapsed: boolean;
  color: TabGroupColor;
  key: string;
  title: string;
}

interface SavedTab {
  active: boolean;
  groupKey?: string;
  order: number;
  pinned: boolean;
  title: string;
  url: string;
}

export interface SavedWindow {
  createdAt: string;
  groups: SavedTabGroup[];
  id: string;
  name: string;
  tabs: SavedTab[];
  updatedAt: string;
}

export interface SavedWindowsCollection {
  schemaVersion: 1;
  windows: SavedWindow[];
}

interface SalvagedSavedWindowsCollection {
  collection: SavedWindowsCollection;
  invalidRecordCount: number;
}

interface CaptureWarning {
  message: string;
  tabId: number | null;
}

interface CaptureSavedWindowResult {
  savedWindow: SavedWindow;
  warnings: CaptureWarning[];
}

interface SavedWindowRestoreGroupPlan {
  group: SavedTabGroup;
  tabOrders: number[];
}

interface SavedWindowRestorePlan {
  activeTabOrder: number;
  groups: SavedWindowRestoreGroupPlan[];
  tabs: SavedTab[];
}

const TAB_GROUP_COLORS = new Set<TabGroupColor>([
  'blue',
  'cyan',
  'green',
  'grey',
  'orange',
  'pink',
  'purple',
  'red',
  'yellow',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function normalizeSavedWindowName(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error('Enter a name for this saved window.');
  }
  if (normalized.length > 120) {
    throw new Error('Keep the saved window name under 120 characters.');
  }
  return normalized;
}

function parseSavedGroup(value: unknown): SavedTabGroup | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.key !== 'string' ||
    !value.key.trim() ||
    typeof value.title !== 'string' ||
    typeof value.color !== 'string' ||
    !TAB_GROUP_COLORS.has(value.color as TabGroupColor) ||
    typeof value.collapsed !== 'boolean'
  ) {
    return null;
  }
  return {
    collapsed: value.collapsed,
    color: value.color as TabGroupColor,
    key: value.key.trim(),
    title: value.title,
  };
}

function parseSavedTab(value: unknown): SavedTab | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !Number.isInteger(value.order) ||
    (value.order as number) < 0 ||
    typeof value.url !== 'string' ||
    !value.url ||
    typeof value.title !== 'string' ||
    typeof value.pinned !== 'boolean' ||
    typeof value.active !== 'boolean' ||
    (value.groupKey !== undefined && (typeof value.groupKey !== 'string' || !value.groupKey.trim()))
  ) {
    return null;
  }

  const tab: SavedTab = {
    active: value.active,
    order: value.order as number,
    pinned: value.pinned,
    title: value.title,
    url: value.url,
  };
  if (typeof value.groupKey === 'string') {
    tab.groupKey = value.groupKey.trim();
  }
  return tab;
}

export function parseSavedWindow(value: unknown): SavedWindow | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    typeof value.name !== 'string' ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
    !Array.isArray(value.tabs) ||
    !Array.isArray(value.groups)
  ) {
    return null;
  }

  let name: string;
  try {
    name = normalizeSavedWindowName(value.name);
  } catch {
    return null;
  }

  const groups = value.groups.map(parseSavedGroup);
  const tabs = value.tabs.map(parseSavedTab);
  if (groups.some((group) => group === null) || tabs.some((tab) => tab === null)) {
    return null;
  }
  const validGroups = groups as SavedTabGroup[];
  const validTabs = (tabs as SavedTab[]).sort((left, right) => left.order - right.order);
  if (validTabs.length === 0 || validTabs.some((tab, index) => tab.order !== index)) {
    return null;
  }
  if (validTabs.filter((tab) => tab.active).length !== 1) {
    return null;
  }

  let foundUnpinned = false;
  for (const tab of validTabs) {
    if (tab.pinned && foundUnpinned) {
      return null;
    }
    if (!tab.pinned) {
      foundUnpinned = true;
    }
    if (tab.pinned && tab.groupKey) {
      return null;
    }
  }

  const groupKeys = new Set<string>();
  for (const group of validGroups) {
    if (groupKeys.has(group.key)) {
      return null;
    }
    groupKeys.add(group.key);
  }
  if (validTabs.some((tab) => tab.groupKey && !groupKeys.has(tab.groupKey))) {
    return null;
  }
  if (validGroups.some((group) => !validTabs.some((tab) => tab.groupKey === group.key))) {
    return null;
  }

  const closedGroupRuns = new Set<string>();
  let previousGroupKey: string | undefined;
  for (const tab of validTabs) {
    if (tab.groupKey !== previousGroupKey) {
      if (previousGroupKey) {
        closedGroupRuns.add(previousGroupKey);
      }
      if (tab.groupKey && closedGroupRuns.has(tab.groupKey)) {
        return null;
      }
      previousGroupKey = tab.groupKey;
    }
  }

  return {
    createdAt: value.createdAt,
    groups: validGroups.map((group) => ({ ...group })),
    id: value.id.trim(),
    name,
    tabs: validTabs.map((tab) => ({ ...tab })),
    updatedAt: value.updatedAt,
  };
}

export function salvageSavedWindowsCollection(value: unknown): SalvagedSavedWindowsCollection {
  if (value === undefined) {
    return {
      collection: { schemaVersion: SAVED_WINDOWS_SCHEMA_VERSION, windows: [] },
      invalidRecordCount: 0,
    };
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== SAVED_WINDOWS_SCHEMA_VERSION ||
    !Array.isArray(value.windows)
  ) {
    return {
      collection: { schemaVersion: SAVED_WINDOWS_SCHEMA_VERSION, windows: [] },
      invalidRecordCount: 1,
    };
  }

  const windows: SavedWindow[] = [];
  let invalidRecordCount = 0;
  const seenIds = new Set<string>();
  value.windows.forEach((record) => {
    const parsed = parseSavedWindow(record);
    if (!parsed) {
      invalidRecordCount += 1;
      return;
    }
    if (seenIds.has(parsed.id)) {
      invalidRecordCount += 1;
      return;
    }
    seenIds.add(parsed.id);
    windows.push(parsed);
  });

  return {
    collection: { schemaVersion: SAVED_WINDOWS_SCHEMA_VERSION, windows },
    invalidRecordCount,
  };
}

export function cloneSavedWindow(savedWindow: SavedWindow): SavedWindow {
  return {
    ...savedWindow,
    groups: savedWindow.groups.map((group) => ({ ...group })),
    tabs: savedWindow.tabs.map((tab) => ({ ...tab })),
  };
}

export function createSavedWindowRecovery(
  savedWindow: SavedWindow,
  failedTabOrders: ReadonlySet<number>,
  updatedAt: string,
): SavedWindow {
  const retainedTabs = [...savedWindow.tabs]
    .sort((left, right) => left.order - right.order)
    .filter((tab) => failedTabOrders.has(tab.order));
  if (retainedTabs.length === 0) {
    throw new Error('A recovery snapshot requires at least one failed tab.');
  }

  const retainedActiveOrder = retainedTabs.find((tab) => tab.active)?.order;
  const activeOrder = retainedActiveOrder ?? retainedTabs[0]?.order;
  const tabs = retainedTabs.map((tab, order) => ({
    ...tab,
    active: tab.order === activeOrder,
    order,
  }));
  const retainedGroupKeys = new Set(
    tabs.flatMap((tab) => (tab.groupKey === undefined ? [] : [tab.groupKey])),
  );

  return {
    ...cloneSavedWindow(savedWindow),
    groups: savedWindow.groups
      .filter((group) => retainedGroupKeys.has(group.key))
      .map((group) => ({ ...group })),
    tabs,
    updatedAt,
  };
}

export function captureSavedWindow(
  sourceWindow: chrome.windows.Window,
  sourceGroups: readonly chrome.tabGroups.TabGroup[],
  name: string,
  id: string,
  timestamp: string,
): CaptureSavedWindowResult {
  if (sourceWindow.incognito) {
    throw new Error('Incognito windows cannot be saved.');
  }
  if (sourceWindow.type !== undefined && sourceWindow.type !== 'normal') {
    throw new Error('Only normal browser windows can be saved.');
  }
  if (!id.trim() || !isIsoTimestamp(timestamp)) {
    throw new Error('Could not create a valid saved window identity.');
  }

  const normalizedName = normalizeSavedWindowName(name);
  const groupMetadata = new Map(sourceGroups.map((group) => [group.id, group]));
  const localGroupKeys = new Map<number, string>();
  const groups: SavedTabGroup[] = [];
  const tabs: SavedTab[] = [];
  const warnings: CaptureWarning[] = [];
  let activeCaptured = false;

  [...(sourceWindow.tabs ?? [])]
    .sort((left, right) => left.index - right.index)
    .forEach((tab) => {
      const url = tab.url ?? tab.pendingUrl ?? '';
      if (!url) {
        warnings.push({
          message: 'A tab without an available URL was skipped.',
          tabId: tab.id ?? null,
        });
        return;
      }

      let groupKey: string | undefined;
      if (tab.groupId >= 0 && !tab.pinned) {
        const metadata = groupMetadata.get(tab.groupId);
        if (metadata) {
          groupKey = localGroupKeys.get(tab.groupId);
          if (!groupKey) {
            groupKey = `group-${groups.length + 1}`;
            localGroupKeys.set(tab.groupId, groupKey);
            groups.push({
              collapsed: metadata.collapsed,
              color: metadata.color,
              key: groupKey,
              title: metadata.title?.trim() ?? '',
            });
          }
        } else {
          warnings.push({
            message: 'A tab group was unavailable; its tab was saved without a group.',
            tabId: tab.id ?? null,
          });
        }
      }

      const savedTab: SavedTab = {
        active: tab.active && !activeCaptured,
        order: tabs.length,
        pinned: tab.pinned,
        title: tab.title?.trim() || url,
        url,
      };
      if (groupKey) {
        savedTab.groupKey = groupKey;
      }
      if (savedTab.active) {
        activeCaptured = true;
      }
      tabs.push(savedTab);
    });

  if (tabs.length === 0) {
    throw new Error('This window has no tabs with restorable URLs.');
  }
  if (!activeCaptured && tabs[0]) {
    tabs[0] = { ...tabs[0], active: true };
  }

  return {
    savedWindow: {
      createdAt: timestamp,
      groups,
      id: id.trim(),
      name: normalizedName,
      tabs,
      updatedAt: timestamp,
    },
    warnings,
  };
}

export function planSavedWindowRestore(savedWindow: SavedWindow): SavedWindowRestorePlan {
  const tabs = [...savedWindow.tabs]
    .sort((left, right) => left.order - right.order)
    .map((tab) => ({ ...tab }));
  const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
  if (!activeTab) {
    throw new Error('The saved window has no tabs to restore.');
  }

  return {
    activeTabOrder: activeTab.order,
    groups: savedWindow.groups.map((group) => ({
      group: { ...group },
      tabOrders: tabs.flatMap((tab) => (tab.groupKey === group.key ? [tab.order] : [])),
    })),
    tabs,
  };
}
