import {
  applyRestoredTabMetadata,
  createRestoredTabMetadataService,
  type RestoredTabMetadataChromeApi,
  type RestoredTabMetadataRegistration,
  type RestoredTabMetadataService,
} from '../../platform/chrome/restoredTabMetadata';
import {
  captureSavedWindow,
  cloneSavedWindow,
  createSavedWindowRecovery,
  normalizeSavedWindowName,
  planSavedWindowRestore,
  SAVED_WINDOWS_SCHEMA_VERSION,
  salvageSavedWindowsCollection,
  type SavedWindow,
  type SavedWindowsCollection,
} from './savedWindowModel';

export const SAVED_WINDOWS_STORAGE_KEY = 'weaver.savedWindows.v1';
export const SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY = 'weaver.savedWindows.cleanupNotice.v1';
const SAVED_WINDOWS_WRITE_LOCK = 'weaver.savedWindows.write';
const SAVED_WINDOWS_RESTORE_LOCK_PREFIX = 'weaver.savedWindows.restore:';

type StorageChanges = Record<string, chrome.storage.StorageChange>;

interface ChromeEvent<TArgs extends unknown[]> {
  addListener: (listener: (...args: TArgs) => void) => void;
  removeListener: (listener: (...args: TArgs) => void) => void;
}

export interface SavedWindowsChromeApi extends RestoredTabMetadataChromeApi {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
    onChanged: ChromeEvent<[changes: StorageChanges, areaName: string]>;
  };
  tabGroups: {
    query: (queryInfo: chrome.tabGroups.QueryInfo) => Promise<chrome.tabGroups.TabGroup[]>;
    update: (
      groupId: number,
      updateProperties: chrome.tabGroups.UpdateProperties,
    ) => Promise<chrome.tabGroups.TabGroup | undefined>;
  };
  tabs: {
    create: (createProperties: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>;
    discard: (tabId?: number) => Promise<chrome.tabs.Tab | undefined>;
    group: (options: chrome.tabs.GroupOptions) => Promise<number>;
    query: (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
    remove: (tabIds: number[]) => Promise<void>;
    update: (
      tabId: number,
      updateProperties: chrome.tabs.UpdateProperties,
    ) => Promise<chrome.tabs.Tab | undefined>;
  };
  windows: {
    create: (createData?: chrome.windows.CreateData) => Promise<chrome.windows.Window | undefined>;
    get: (
      windowId: number,
      queryOptions?: chrome.windows.QueryOptions,
    ) => Promise<chrome.windows.Window>;
    remove: (windowId: number) => Promise<void>;
    update: (
      windowId: number,
      updateInfo: chrome.windows.UpdateInfo,
    ) => Promise<chrome.windows.Window>;
  };
}

export interface SaveWindowResult {
  savedWindow: SavedWindow;
  sourceWindowClosed: boolean;
  warnings: string[];
}

interface SavedTabRestoreFailure {
  message: string;
  order: number;
  title: string;
  url: string;
}

export interface RestoreSavedWindowResult {
  destinationWindowId: number;
  failures: SavedTabRestoreFailure[];
  restoredTabCount: number;
  savedWindowRemoved: boolean;
  suspendedTabCount: number;
  warnings: string[];
}

export interface SavedWindowsService {
  deleteWindow: (savedWindowId: string) => Promise<void>;
  dismissCleanupNotice?: (() => Promise<void>) | undefined;
  keepWindow: (savedWindow: SavedWindow) => Promise<SavedWindow>;
  load: () => Promise<SavedWindow[]>;
  loadCleanupNotice?: (() => Promise<string | null>) | undefined;
  openTab: (url: string) => Promise<number>;
  renameWindow: (savedWindowId: string, name: string) => Promise<SavedWindow>;
  restoreWindow: (savedWindowId: string) => Promise<RestoreSavedWindowResult>;
  saveWindow: (
    sourceWindowId: number,
    name: string,
    closeSource: boolean,
  ) => Promise<SaveWindowResult>;
  subscribe: (listener: () => void) => () => void;
}

export interface SavedWindowsEnvironment {
  createId: () => string;
  now: () => string;
  withRestoreLock?:
    | (<T>(savedWindowId: string, operation: () => Promise<T>) => Promise<T>)
    | undefined;
  withWriteLock?: (<T>(operation: () => Promise<T>) => Promise<T>) | undefined;
}

function withBrowserWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return operation();
  }
  return navigator.locks
    .request<Promise<T>>(SAVED_WINDOWS_WRITE_LOCK, operation)
    .then((result) => result);
}

function withBrowserRestoreLock<T>(savedWindowId: string, operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return operation();
  }
  return navigator.locks
    .request<Promise<T>>(`${SAVED_WINDOWS_RESTORE_LOCK_PREFIX}${savedWindowId}`, operation)
    .then((result) => result);
}

const DEFAULT_ENVIRONMENT: SavedWindowsEnvironment = {
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  withRestoreLock: withBrowserRestoreLock,
  withWriteLock: withBrowserWriteLock,
};

interface SavedWindowsCleanupNotice {
  discardedRecordCount: number;
  schemaVersion: 1;
}

function parseCleanupNotice(value: unknown): SavedWindowsCleanupNotice | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('discardedRecordCount' in value) ||
    !Number.isInteger(value.discardedRecordCount) ||
    (value.discardedRecordCount as number) < 1
  ) {
    return null;
  }

  return {
    discardedRecordCount: value.discardedRecordCount as number,
    schemaVersion: 1,
  };
}

function formatCleanupNotice(notice: SavedWindowsCleanupNotice | null): string | null {
  if (!notice) {
    return null;
  }
  const records = `${notice.discardedRecordCount} invalid saved-window ${notice.discardedRecordCount === 1 ? 'record' : 'records'}`;
  return `Weaver discarded ${records} and kept every valid saved window.`;
}

function describeChromeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'The browser rejected the operation.';
}

function cloneSavedWindows(windows: readonly SavedWindow[]): SavedWindow[] {
  return windows.map(cloneSavedWindow);
}

function createCollection(windows: readonly SavedWindow[]): SavedWindowsCollection {
  return {
    schemaVersion: SAVED_WINDOWS_SCHEMA_VERSION,
    windows: cloneSavedWindows(windows),
  };
}

function getTabId(tab: chrome.tabs.Tab): number | null {
  return tab.id === undefined ? null : tab.id;
}

export function createChromeSavedWindowsService(
  api: SavedWindowsChromeApi = chrome,
  environment: SavedWindowsEnvironment = DEFAULT_ENVIRONMENT,
  restoredTabMetadataService: RestoredTabMetadataService = createRestoredTabMetadataService(api),
): SavedWindowsService {
  let writeQueue: Promise<void> = Promise.resolve();
  const restoreQueues = new Map<string, Promise<void>>();

  const writeCollection = async (windows: readonly SavedWindow[]) => {
    await api.storage.local.set({
      [SAVED_WINDOWS_STORAGE_KEY]: createCollection(windows),
    });
  };

  const loadCollectionUnlocked = async (): Promise<SavedWindowsCollection> => {
    const stored = await api.storage.local.get(SAVED_WINDOWS_STORAGE_KEY);
    const salvaged = salvageSavedWindowsCollection(stored[SAVED_WINDOWS_STORAGE_KEY]);
    if (salvaged.invalidRecordCount === 0) {
      return salvaged.collection;
    }

    const noticeStorage = await api.storage.local.get(SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY);
    const existingNotice = parseCleanupNotice(
      noticeStorage[SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY],
    );
    await api.storage.local.set({
      [SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY]: {
        discardedRecordCount:
          (existingNotice?.discardedRecordCount ?? 0) + salvaged.invalidRecordCount,
        schemaVersion: 1,
      },
      [SAVED_WINDOWS_STORAGE_KEY]: salvaged.collection,
    });
    return salvaged.collection;
  };

  const runWithWriteLock = <T>(operation: () => Promise<T>): Promise<T> => {
    const withWriteLock = environment.withWriteLock ?? withBrowserWriteLock;
    const result = writeQueue.then(() => withWriteLock(operation));
    writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const loadCollection = (): Promise<SavedWindowsCollection> =>
    runWithWriteLock(loadCollectionUnlocked);

  const mutateCollection = <T>(
    mutation: (collection: SavedWindowsCollection) => Promise<T> | T,
  ): Promise<T> => runWithWriteLock(async () => mutation(await loadCollectionUnlocked()));

  const runWithRestoreLock = <T>(
    savedWindowId: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const previous = restoreQueues.get(savedWindowId) ?? Promise.resolve();
    const withRestoreLock = environment.withRestoreLock ?? withBrowserRestoreLock;
    const result = previous.then(() => withRestoreLock(savedWindowId, operation));
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    restoreQueues.set(savedWindowId, tail);
    void tail.then(() => {
      if (restoreQueues.get(savedWindowId) === tail) {
        restoreQueues.delete(savedWindowId);
      }
    });
    return result;
  };

  return {
    async dismissCleanupNotice() {
      await api.storage.local.set({ [SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY]: null });
    },

    async deleteWindow(savedWindowId) {
      await mutateCollection(async (collection) => {
        const index = collection.windows.findIndex((window) => window.id === savedWindowId);
        if (index < 0) {
          throw new Error('That saved window no longer exists.');
        }
        const nextWindows = collection.windows.filter((window) => window.id !== savedWindowId);
        await writeCollection(nextWindows);
      });
    },

    async load() {
      const collection = await loadCollection();
      return cloneSavedWindows(collection.windows);
    },

    async loadCleanupNotice() {
      const stored = await api.storage.local.get(SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY);
      return formatCleanupNotice(
        parseCleanupNotice(stored[SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY]),
      );
    },

    async keepWindow(savedWindow) {
      return mutateCollection(async (collection) => {
        const existing = collection.windows.find((window) => window.id === savedWindow.id);
        if (existing) {
          return cloneSavedWindow(existing);
        }
        const keptWindow = cloneSavedWindow(savedWindow);
        await writeCollection([keptWindow, ...collection.windows]);
        return cloneSavedWindow(keptWindow);
      });
    },

    async openTab(url) {
      const createdTab = await api.tabs.create({ active: true, url });
      const tabId = getTabId(createdTab);
      if (tabId === null) {
        throw new Error('The browser created a tab without an ID.');
      }
      return tabId;
    },

    async renameWindow(savedWindowId, name) {
      const normalizedName = normalizeSavedWindowName(name);
      return mutateCollection(async (collection) => {
        const index = collection.windows.findIndex((window) => window.id === savedWindowId);
        const existing = collection.windows[index];
        if (index < 0 || !existing) {
          throw new Error('That saved window no longer exists.');
        }
        const updated: SavedWindow = {
          ...cloneSavedWindow(existing),
          name: normalizedName,
          updatedAt: environment.now(),
        };
        const nextWindows = [...collection.windows];
        nextWindows[index] = updated;
        await writeCollection(nextWindows);
        return cloneSavedWindow(updated);
      });
    },

    async restoreWindow(savedWindowId) {
      return runWithRestoreLock(savedWindowId, async () => {
        const collection = await loadCollection();
        const savedWindow = collection.windows.find((window) => window.id === savedWindowId);
        if (!savedWindow) {
          throw new Error('That saved window no longer exists.');
        }
        const plan = planSavedWindowRestore(savedWindow);
        const destination = await api.windows.create({ focused: false });
        if (destination?.id === undefined) {
          throw new Error('The browser did not create the destination window.');
        }

        const destinationWindowId = destination.id;
        const restoredTabIdsByOrder = new Map<number, number>();
        const restoredMetadataRegistrations: RestoredTabMetadataRegistration[] = [];
        const suspendedTabIds = new Set<number>();
        const failures: SavedTabRestoreFailure[] = [];
        const warnings: string[] = [];
        let placeholderTabIds = (destination.tabs ?? [])
          .map(getTabId)
          .filter((tabId): tabId is number => tabId !== null);
        if (!destination.tabs) {
          try {
            placeholderTabIds = (await api.tabs.query({ windowId: destinationWindowId }))
              .map(getTabId)
              .filter((tabId): tabId is number => tabId !== null);
          } catch (error) {
            warnings.push(
              `The temporary new tab could not be identified: ${describeChromeError(error)}`,
            );
          }
        }

        for (const tab of plan.tabs) {
          try {
            const createdTab = await api.tabs.create({
              active: false,
              index: tab.order,
              pinned: tab.pinned,
              url: tab.url,
              windowId: destinationWindowId,
            });
            const tabId = getTabId(createdTab);
            if (tabId === null) {
              throw new Error('The browser created a tab without an ID.');
            }
            restoredTabIdsByOrder.set(tab.order, tabId);
            restoredMetadataRegistrations.push({ tabId, title: tab.title, url: tab.url });
            if (tab.order !== plan.activeTabOrder) {
              try {
                const discardedTab = await api.tabs.discard(tabId);
                if (!discardedTab?.discarded) {
                  throw new Error('The browser did not suspend the tab.');
                }
                suspendedTabIds.add(tabId);
              } catch (error) {
                warnings.push(
                  `"${tab.title}" could not be suspended: ${describeChromeError(error)}`,
                );
              }
            }
          } catch (error) {
            failures.push({
              message: describeChromeError(error),
              order: tab.order,
              title: tab.title,
              url: tab.url,
            });
          }
        }

        if (restoredMetadataRegistrations.length > 0) {
          try {
            await restoredTabMetadataService.register(restoredMetadataRegistrations);
          } catch (error) {
            warnings.push(
              `Restored tab titles and URLs could not be retained while suspended: ${describeChromeError(error)}`,
            );
          }
        }

        const preferredActiveTabId = restoredTabIdsByOrder.get(plan.activeTabOrder);
        const activeCandidates = [
          ...(preferredActiveTabId === undefined ? [] : [preferredActiveTabId]),
          ...[...restoredTabIdsByOrder.values()].filter((tabId) => tabId !== preferredActiveTabId),
        ];
        let activeTabId: number | undefined;
        let activeSelectionError: unknown;
        for (const candidateTabId of activeCandidates) {
          try {
            await api.tabs.update(candidateTabId, { active: true });
            activeTabId = candidateTabId;
            suspendedTabIds.delete(candidateTabId);
            break;
          } catch (error) {
            activeSelectionError = error;
          }
        }

        if (activeCandidates.length > 0 && activeTabId === undefined) {
          warnings.push(
            `The active tab could not be selected: ${describeChromeError(activeSelectionError)}`,
          );
        } else if (
          preferredActiveTabId !== undefined &&
          activeTabId !== undefined &&
          activeTabId !== preferredActiveTabId
        ) {
          warnings.push('The intended active tab could not be selected; another tab was focused.');
        }

        if (activeTabId !== undefined) {
          for (const tab of plan.tabs) {
            const tabId = restoredTabIdsByOrder.get(tab.order);
            if (tabId === undefined || tabId === activeTabId || suspendedTabIds.has(tabId)) {
              continue;
            }
            try {
              const discardedTab = await api.tabs.discard(tabId);
              if (!discardedTab?.discarded) {
                throw new Error('The browser did not suspend the tab.');
              }
              suspendedTabIds.add(tabId);
            } catch (error) {
              warnings.push(`"${tab.title}" could not be suspended: ${describeChromeError(error)}`);
            }
          }
        }

        if (activeTabId !== undefined && placeholderTabIds.length > 0) {
          try {
            await api.tabs.remove(placeholderTabIds);
          } catch (error) {
            warnings.push(
              `The temporary new tab could not be removed: ${describeChromeError(error)}`,
            );
          }
        }

        for (const groupPlan of plan.groups) {
          const tabIds = groupPlan.tabOrders.flatMap((order) => {
            const tabId = restoredTabIdsByOrder.get(order);
            return tabId === undefined ? [] : [tabId];
          });
          const [firstTabId, ...remainingTabIds] = tabIds;
          if (firstTabId === undefined) {
            continue;
          }
          try {
            const groupId = await api.tabs.group({
              createProperties: { windowId: destinationWindowId },
              tabIds: [firstTabId, ...remainingTabIds],
            });
            await api.tabGroups.update(groupId, {
              collapsed: groupPlan.group.collapsed,
              color: groupPlan.group.color,
              title: groupPlan.group.title,
            });
          } catch (error) {
            warnings.push(
              `The ${groupPlan.group.title || 'untitled'} tab group could not be restored: ${describeChromeError(error)}`,
            );
          }
        }

        try {
          await api.windows.update(destinationWindowId, { focused: true });
        } catch (error) {
          warnings.push(`The restored window could not be focused: ${describeChromeError(error)}`);
        }

        let savedWindowRemoved = false;
        if (failures.length === 0 || restoredTabIdsByOrder.size > 0) {
          try {
            await mutateCollection(async (latestCollection) => {
              const index = latestCollection.windows.findIndex(
                (window) => window.id === savedWindowId,
              );
              const latestSavedWindow = latestCollection.windows[index];
              if (index < 0 || !latestSavedWindow) {
                return;
              }
              if (failures.length === 0) {
                await writeCollection(
                  latestCollection.windows.filter((window) => window.id !== savedWindowId),
                );
                return;
              }

              const recovery = createSavedWindowRecovery(
                latestSavedWindow,
                new Set(failures.map((failure) => failure.order)),
                environment.now(),
              );
              const nextWindows = [...latestCollection.windows];
              nextWindows[index] = recovery;
              await writeCollection(nextWindows);
            });
            savedWindowRemoved = failures.length === 0;
          } catch (error) {
            warnings.push(
              failures.length === 0
                ? `The window was restored, but its saved copy could not be removed: ${describeChromeError(error)}`
                : `The restored tabs could not be removed from the saved recovery copy: ${describeChromeError(error)}`,
            );
          }
        }

        return {
          destinationWindowId,
          failures,
          restoredTabCount: restoredTabIdsByOrder.size,
          savedWindowRemoved,
          suspendedTabCount: suspendedTabIds.size,
          warnings,
        };
      });
    },

    async saveWindow(sourceWindowId, name, closeSource) {
      const [sourceWindow, sourceGroups] = await Promise.all([
        api.windows.get(sourceWindowId, { populate: true }),
        api.tabGroups.query({ windowId: sourceWindowId }),
      ]);
      const sourceTabs = sourceWindow.tabs ?? [];
      const restoredMetadata = await restoredTabMetadataService.resolve(sourceTabs, {
        pruneMissing: false,
      });
      const resolvedSourceWindow = sourceWindow.tabs
        ? {
            ...sourceWindow,
            tabs: sourceWindow.tabs.map((tab) => applyRestoredTabMetadata(tab, restoredMetadata)),
          }
        : sourceWindow;
      const capture = captureSavedWindow(
        resolvedSourceWindow,
        sourceGroups,
        name,
        environment.createId(),
        environment.now(),
      );

      await mutateCollection(async (collection) => {
        if (collection.windows.some((window) => window.id === capture.savedWindow.id)) {
          throw new Error('Could not create a unique saved window ID. Try again.');
        }
        await writeCollection([capture.savedWindow, ...collection.windows]);
      });

      const warnings = capture.warnings.map((warning) => warning.message);
      let sourceWindowClosed = false;
      if (closeSource) {
        try {
          await api.windows.remove(sourceWindowId);
          sourceWindowClosed = true;
        } catch (error) {
          warnings.push(
            `The window was saved, but its source could not be closed: ${describeChromeError(error)}`,
          );
        }
      }

      return {
        savedWindow: cloneSavedWindow(capture.savedWindow),
        sourceWindowClosed,
        warnings,
      };
    },

    subscribe(listener) {
      const handleChange = (changes: StorageChanges, areaName: string) => {
        if (
          areaName === 'local' &&
          (changes[SAVED_WINDOWS_STORAGE_KEY] || changes[SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY])
        ) {
          listener();
        }
      };
      api.storage.onChanged.addListener(handleChange);
      return () => api.storage.onChanged.removeListener(handleChange);
    },
  };
}

export function createSavedWindowsService(): SavedWindowsService {
  if (
    typeof chrome !== 'undefined' &&
    chrome.storage?.local &&
    chrome.storage.onChanged &&
    chrome.windows &&
    chrome.tabs &&
    chrome.tabGroups
  ) {
    return createChromeSavedWindowsService();
  }

  let windows: SavedWindow[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    deleteWindow(savedWindowId) {
      return Promise.resolve().then(() => {
        if (!windows.some((window) => window.id === savedWindowId)) {
          throw new Error('That saved window no longer exists.');
        }
        windows = windows.filter((window) => window.id !== savedWindowId);
        notify();
      });
    },
    load: () => Promise.resolve(cloneSavedWindows(windows)),
    keepWindow(savedWindow) {
      return Promise.resolve().then(() => {
        const existing = windows.find((window) => window.id === savedWindow.id);
        if (existing) {
          return cloneSavedWindow(existing);
        }
        const keptWindow = cloneSavedWindow(savedWindow);
        windows = [keptWindow, ...windows];
        notify();
        return cloneSavedWindow(keptWindow);
      });
    },
    openTab: () => Promise.reject(new Error('Browser extension APIs are unavailable.')),
    renameWindow(savedWindowId, name) {
      return Promise.resolve().then(() => {
        const existing = windows.find((window) => window.id === savedWindowId);
        if (!existing) {
          throw new Error('That saved window no longer exists.');
        }
        const updated = {
          ...cloneSavedWindow(existing),
          name: normalizeSavedWindowName(name),
          updatedAt: new Date().toISOString(),
        };
        windows = windows.map((window) => (window.id === savedWindowId ? updated : window));
        notify();
        return cloneSavedWindow(updated);
      });
    },
    restoreWindow: () => Promise.reject(new Error('Browser extension APIs are unavailable.')),
    saveWindow: () => Promise.reject(new Error('Browser extension APIs are unavailable.')),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
