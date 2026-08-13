import {
  applyRestoredTabMetadata,
  createRestoredTabMetadataService,
  type RestoredTabMetadataChromeApi,
  type RestoredTabMetadataRegistration,
  type RestoredTabMetadataService,
} from '../../platform/chrome/restoredTabMetadata';
import { getRestoredGroupTitleWithProvenance } from '../active-windows/agentTabAssociation';
import { type TabSortOptions } from '../active-windows/tabSort';
import { type DedupeRule } from '../deduplication/deduplication';
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
import {
  deduplicateSavedWindows,
  getSavedWindowMutationTimestamp,
  mergeSavedWindows,
  moveSelectedSavedTabsToNewWindow,
  removeSelectedSavedTabs,
  sortSavedWindows,
  type DeduplicateSavedWindowsResult,
  type MergeSavedWindowsResult,
  type MoveSelectedSavedTabsResult,
  type RemoveSelectedSavedTabsResult,
  type SavedTabSelectionReference,
  type SortSavedWindowsResult,
} from './savedWindowOperations';

export const SAVED_WINDOWS_STORAGE_KEY = 'weaver.savedWindows.v1';
export const SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY = 'weaver.savedWindows.cleanupNotice.v1';
const SAVED_WINDOWS_WRITE_LOCK = 'weaver.savedWindows.write';
const SAVED_WINDOWS_RESTORE_LOCK_PREFIX = 'weaver.savedWindows.restore:';
const SAVED_WINDOWS_COLLECTION_OPERATION_LOCK = 'weaver.savedWindows.collection-operation';

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
    update: (
      windowId: number,
      updateInfo: chrome.windows.UpdateInfo,
    ) => Promise<chrome.windows.Window>;
  };
}

export interface SourceWindowCloseBatchResult {
  errorMessage: string | null;
}

export interface SourceWindowCloseFinishResult {
  completion: Promise<SourceWindowCloseBatchResult> | null;
  errorMessage: string | null;
  status: 'close-requested' | 'partial' | 'targets-closed';
}

export interface FastSourceWindowCloseOperation {
  anchorTabId: number;
  batchCompletion: Promise<SourceWindowCloseBatchResult>;
  cancelFinalization: () => void;
  finish: () => Promise<SourceWindowCloseFinishResult>;
  nonAnchorTabIds: readonly number[];
  targetTabIds: readonly number[];
  windowId: number;
}

export interface SaveWindowResult {
  savedWindow: SavedWindow;
  sourceWindowClose: FastSourceWindowCloseOperation | null;
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
  warnings: string[];
}

export interface OpenSavedTabInput {
  pinned: boolean;
  url: string;
}

export interface SavedWindowsMutationUndo {
  afterWindows: readonly SavedWindow[];
  beforeWindows: readonly SavedWindow[];
}

export class SavedWindowsMutationConflictError extends Error {
  constructor() {
    super(
      'Saved Windows changed after this action, so Weaver did not overwrite the newer changes.',
    );
    this.name = 'SavedWindowsMutationConflictError';
  }
}

export interface DeduplicateSavedTabsResult extends DeduplicateSavedWindowsResult {
  undo: SavedWindowsMutationUndo | null;
}

export interface MergeSavedWindowsServiceResult extends MergeSavedWindowsResult {
  undo: SavedWindowsMutationUndo;
}

export interface RemoveSelectedSavedTabsServiceResult extends RemoveSelectedSavedTabsResult {
  undo: SavedWindowsMutationUndo;
}

export interface MoveSelectedSavedTabsServiceResult extends MoveSelectedSavedTabsResult {
  undo: SavedWindowsMutationUndo;
}

export interface SortSavedWindowsServiceResult extends SortSavedWindowsResult {
  undo: SavedWindowsMutationUndo | null;
}

export interface SavedWindowsService {
  deduplicateTabs: (rules: readonly DedupeRule[]) => Promise<DeduplicateSavedTabsResult>;
  deleteWindow: (savedWindowId: string) => Promise<void>;
  dismissCleanupNotice?: (() => Promise<void>) | undefined;
  keepWindow: (savedWindow: SavedWindow) => Promise<SavedWindow>;
  load: () => Promise<SavedWindow[]>;
  loadCount?: (() => Promise<number>) | undefined;
  loadCleanupNotice?: (() => Promise<string | null>) | undefined;
  mergeWindows: (
    savedWindowIds: readonly string[],
    name: string,
  ) => Promise<MergeSavedWindowsServiceResult>;
  moveSelectedTabsToNewWindow: (
    tabs: readonly SavedTabSelectionReference[],
    name: string,
  ) => Promise<MoveSelectedSavedTabsServiceResult>;
  openTab: (tab: OpenSavedTabInput) => Promise<number>;
  removeSelectedTabs: (
    tabs: readonly SavedTabSelectionReference[],
  ) => Promise<RemoveSelectedSavedTabsServiceResult>;
  renameWindow: (savedWindowId: string, name: string) => Promise<SavedWindow>;
  restoreWindow: (savedWindowId: string) => Promise<RestoreSavedWindowResult>;
  saveWindow: (
    sourceWindowId: number,
    name: string,
    closeSource: boolean,
  ) => Promise<SaveWindowResult>;
  sortAllWindows: (options: TabSortOptions) => Promise<SortSavedWindowsServiceResult>;
  sortWindow: (
    savedWindowId: string,
    options: TabSortOptions,
  ) => Promise<SortSavedWindowsServiceResult>;
  subscribe: (listener: () => void) => () => void;
  subscribeCount?: ((listener: () => void) => () => void) | undefined;
  undoMutation: (undo: SavedWindowsMutationUndo) => Promise<void>;
}

export interface SavedWindowsEnvironment {
  createId: () => string;
  now: () => string;
  withCollectionOperationLock?: (<T>(operation: () => Promise<T>) => Promise<T>) | undefined;
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

function withBrowserCollectionOperationLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return operation();
  }
  return navigator.locks
    .request<Promise<T>>(SAVED_WINDOWS_COLLECTION_OPERATION_LOCK, operation)
    .then((result) => result);
}

const DEFAULT_ENVIRONMENT: SavedWindowsEnvironment = {
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  withCollectionOperationLock: withBrowserCollectionOperationLock,
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

function savedWindowCollectionsMatch(
  first: readonly SavedWindow[],
  second: readonly SavedWindow[],
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
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

interface SourceTabCloseTarget {
  id: number;
  url: string;
}

function getTabCloseIdentityUrl(tab: chrome.tabs.Tab): string | null {
  return tab.pendingUrl || tab.url || null;
}

function pluralizeForMessage(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function getSourceTabCloseTargets(tabs: readonly chrome.tabs.Tab[]): SourceTabCloseTarget[] {
  return tabs.flatMap((tab) => {
    const id = getTabId(tab);
    const url = getTabCloseIdentityUrl(tab);
    return id === null || url === null ? [] : [{ id, url }];
  });
}

export function createChromeSavedWindowsService(
  api: SavedWindowsChromeApi = chrome,
  environment: SavedWindowsEnvironment = DEFAULT_ENVIRONMENT,
  restoredTabMetadataService: RestoredTabMetadataService = createRestoredTabMetadataService(api),
): SavedWindowsService {
  let collectionOperationQueue: Promise<void> = Promise.resolve();
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

  const runWithCollectionOperationLock = <T>(operation: () => Promise<T>): Promise<T> => {
    const withCollectionOperationLock =
      environment.withCollectionOperationLock ?? withBrowserCollectionOperationLock;
    const result = collectionOperationQueue.then(() => withCollectionOperationLock(operation));
    collectionOperationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    async deduplicateTabs(rules) {
      return runWithCollectionOperationLock(() =>
        mutateCollection(async (collection) => {
          const beforeWindows = cloneSavedWindows(collection.windows);
          const transformed = deduplicateSavedWindows(collection.windows, rules, environment.now());
          if (transformed.result.removedTabCount === 0) {
            return { ...transformed.result, undo: null };
          }
          await writeCollection(transformed.windows);
          return {
            ...transformed.result,
            undo: {
              afterWindows: cloneSavedWindows(transformed.windows),
              beforeWindows,
            },
          };
        }),
      );
    },

    async dismissCleanupNotice() {
      await api.storage.local.set({ [SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY]: null });
    },

    async deleteWindow(savedWindowId) {
      await runWithCollectionOperationLock(() =>
        mutateCollection(async (collection) => {
          const index = collection.windows.findIndex((window) => window.id === savedWindowId);
          if (index < 0) {
            throw new Error('That saved window no longer exists.');
          }
          const nextWindows = collection.windows.filter((window) => window.id !== savedWindowId);
          await writeCollection(nextWindows);
        }),
      );
    },

    async load() {
      const collection = await loadCollection();
      return cloneSavedWindows(collection.windows);
    },

    async loadCount() {
      const collection = await loadCollection();
      return collection.windows.length;
    },

    async loadCleanupNotice() {
      const stored = await api.storage.local.get(SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY);
      return formatCleanupNotice(
        parseCleanupNotice(stored[SAVED_WINDOWS_CLEANUP_NOTICE_STORAGE_KEY]),
      );
    },

    async mergeWindows(savedWindowIds, name) {
      return runWithCollectionOperationLock(() =>
        mutateCollection(async (collection) => {
          const beforeWindows = cloneSavedWindows(collection.windows);
          const transformed = mergeSavedWindows(
            collection.windows,
            savedWindowIds,
            name,
            environment.now(),
          );
          await writeCollection(transformed.windows);
          return {
            ...transformed.result,
            undo: {
              afterWindows: cloneSavedWindows(transformed.windows),
              beforeWindows,
            },
          };
        }),
      );
    },

    async moveSelectedTabsToNewWindow(tabs, name) {
      return runWithCollectionOperationLock(() =>
        mutateCollection(async (collection) => {
          const beforeWindows = cloneSavedWindows(collection.windows);
          const transformed = moveSelectedSavedTabsToNewWindow(
            collection.windows,
            tabs,
            name,
            environment.createId(),
            environment.now(),
          );
          await writeCollection(transformed.windows);
          return {
            ...transformed.result,
            undo: {
              afterWindows: cloneSavedWindows(transformed.windows),
              beforeWindows,
            },
          };
        }),
      );
    },

    async keepWindow(savedWindow) {
      return runWithCollectionOperationLock(() =>
        mutateCollection(async (collection) => {
          const existing = collection.windows.find((window) => window.id === savedWindow.id);
          if (existing) {
            return cloneSavedWindow(existing);
          }
          const keptWindow = cloneSavedWindow(savedWindow);
          await writeCollection([keptWindow, ...collection.windows]);
          return cloneSavedWindow(keptWindow);
        }),
      );
    },

    async openTab({ pinned, url }) {
      const createdTab = await api.tabs.create({ active: true, pinned, url });
      const tabId = getTabId(createdTab);
      if (tabId === null) {
        throw new Error('The browser created a tab without an ID.');
      }
      return tabId;
    },

    async removeSelectedTabs(tabs) {
      return runWithCollectionOperationLock(() =>
        mutateCollection(async (collection) => {
          const beforeWindows = cloneSavedWindows(collection.windows);
          const transformed = removeSelectedSavedTabs(collection.windows, tabs, environment.now());
          await writeCollection(transformed.windows);
          return {
            ...transformed.result,
            undo: {
              afterWindows: cloneSavedWindows(transformed.windows),
              beforeWindows,
            },
          };
        }),
      );
    },

    async renameWindow(savedWindowId, name) {
      const normalizedName = normalizeSavedWindowName(name);
      return runWithCollectionOperationLock(() =>
        mutateCollection(async (collection) => {
          const index = collection.windows.findIndex((window) => window.id === savedWindowId);
          const existing = collection.windows[index];
          if (index < 0 || !existing) {
            throw new Error('That saved window no longer exists.');
          }
          const updated: SavedWindow = {
            ...cloneSavedWindow(existing),
            name: normalizedName,
            updatedAt: getSavedWindowMutationTimestamp(environment.now(), [existing]),
          };
          const nextWindows = [...collection.windows];
          nextWindows[index] = updated;
          await writeCollection(nextWindows);
          return cloneSavedWindow(updated);
        }),
      );
    },

    async restoreWindow(savedWindowId) {
      return runWithRestoreLock(savedWindowId, () =>
        runWithCollectionOperationLock(async () => {
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
                `Restored tab titles and URLs could not be retained while pages load: ${describeChromeError(error)}`,
              );
            }
          }

          const preferredActiveTabId = restoredTabIdsByOrder.get(plan.activeTabOrder);
          const activeCandidates = [
            ...(preferredActiveTabId === undefined ? [] : [preferredActiveTabId]),
            ...[...restoredTabIdsByOrder.values()].filter(
              (tabId) => tabId !== preferredActiveTabId,
            ),
          ];
          let activeTabId: number | undefined;
          let activeSelectionError: unknown;
          for (const candidateTabId of activeCandidates) {
            try {
              await api.tabs.update(candidateTabId, { active: true });
              activeTabId = candidateTabId;
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
            warnings.push(
              'The intended active tab could not be selected; another tab was focused.',
            );
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
                title: getRestoredGroupTitleWithProvenance(groupPlan.group),
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
            warnings.push(
              `The restored window could not be focused: ${describeChromeError(error)}`,
            );
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
                  getSavedWindowMutationTimestamp(environment.now(), [latestSavedWindow]),
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
            warnings,
          };
        }),
      );
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
            tabs: sourceWindow.tabs.map((tab) => {
              const resolvedTab = applyRestoredTabMetadata(tab, restoredMetadata);
              // The metadata resolver already verified this pending destination. Clear it only on
              // the capture copy so captureSavedWindow keeps the recovered page title.
              return tab.id !== undefined && restoredMetadata.has(tab.id)
                ? { ...resolvedTab, pendingUrl: undefined }
                : resolvedTab;
            }),
          }
        : sourceWindow;
      const capture = captureSavedWindow(
        resolvedSourceWindow,
        sourceGroups,
        name,
        environment.createId(),
        environment.now(),
      );
      const sourceTabCloseTargets = getSourceTabCloseTargets(sourceTabs);

      await runWithCollectionOperationLock(() =>
        mutateCollection(async (collection) => {
          if (collection.windows.some((window) => window.id === capture.savedWindow.id)) {
            throw new Error('Could not create a unique saved window ID. Try again.');
          }
          await writeCollection([capture.savedWindow, ...collection.windows]);
        }),
      );

      const warnings = capture.warnings.map((warning) => warning.message);
      let sourceWindowClose: FastSourceWindowCloseOperation | null = null;
      if (closeSource) {
        try {
          const liveSourceTabs = await api.tabs.query({ windowId: sourceWindowId });
          const capturedTargetsById = new Map(
            sourceTabCloseTargets.map((target) => [target.id, target] as const),
          );
          const eligibleTabs = liveSourceTabs.filter((tab) => {
            const id = getTabId(tab);
            const capturedTarget = id === null ? undefined : capturedTargetsById.get(id);
            return (
              capturedTarget !== undefined &&
              tab.windowId === sourceWindowId &&
              getTabCloseIdentityUrl(tab) === capturedTarget.url
            );
          });

          if (
            sourceTabCloseTargets.length !== sourceTabs.length ||
            eligibleTabs.length !== sourceTabCloseTargets.length ||
            liveSourceTabs.length !== sourceTabCloseTargets.length
          ) {
            warnings.push(
              'Weaver could not safely verify every tab in the original window, so no tabs were closed.',
            );
          } else {
            const anchorTab =
              eligibleTabs.find((tab) => tab.active) ?? eligibleTabs[eligibleTabs.length - 1];
            const anchorTabId = anchorTab ? getTabId(anchorTab) : null;
            if (anchorTabId === null || !anchorTab) {
              warnings.push(
                'Your browser did not return a safe tab to close last, so Weaver left the original window open.',
              );
            } else {
              const anchorUrl = getTabCloseIdentityUrl(anchorTab);
              if (anchorUrl === null) {
                warnings.push(
                  'Your browser did not return a stable tab to close last, so Weaver left the original window open.',
                );
                return {
                  savedWindow: capture.savedWindow,
                  sourceWindowClose,
                  warnings,
                };
              }
              const targetTabIds = eligibleTabs.flatMap((tab) => {
                const id = getTabId(tab);
                return id === null ? [] : [id];
              });
              const nonAnchorTabIds = targetTabIds.filter((tabId) => tabId !== anchorTabId);
              let batchCompletion: Promise<SourceWindowCloseBatchResult>;
              try {
                const batchRequest =
                  nonAnchorTabIds.length > 0
                    ? api.tabs.remove([...nonAnchorTabIds])
                    : Promise.resolve();
                batchCompletion = batchRequest.then(
                  () => ({ errorMessage: null }),
                  (error: unknown) => ({ errorMessage: describeChromeError(error) }),
                );
              } catch (error) {
                batchCompletion = Promise.resolve({
                  errorMessage: describeChromeError(error),
                });
              }

              let finalizationCancelled = false;
              let finishPromise: Promise<SourceWindowCloseFinishResult> | null = null;
              const finish = () => {
                if (finishPromise) {
                  return finishPromise;
                }
                finishPromise = (async (): Promise<SourceWindowCloseFinishResult> => {
                  if (finalizationCancelled) {
                    return {
                      completion: null,
                      errorMessage:
                        'Automatic final-tab closing stopped after the operation timed out.',
                      status: 'partial',
                    };
                  }
                  let allTabs: chrome.tabs.Tab[];
                  try {
                    allTabs = await api.tabs.query({});
                  } catch (error) {
                    return {
                      completion: null,
                      errorMessage: `The remaining tabs could not be verified: ${describeChromeError(error)}`,
                      status: 'partial',
                    };
                  }

                  const remainingNonAnchorIds = new Set(
                    allTabs
                      .filter((tab) => {
                        const id = getTabId(tab);
                        return id !== null && nonAnchorTabIds.includes(id);
                      })
                      .flatMap((tab) => {
                        const id = getTabId(tab);
                        return id === null ? [] : [id];
                      }),
                  );
                  if (remainingNonAnchorIds.size > 0) {
                    return {
                      completion: null,
                      errorMessage: `${pluralizeForMessage(remainingNonAnchorIds.size, 'tab')} ${remainingNonAnchorIds.size === 1 ? 'still needs' : 'still need'} attention before the original window can close.`,
                      status: 'partial',
                    };
                  }

                  const currentAnchor = allTabs.find((tab) => tab.id === anchorTabId);
                  if (!currentAnchor) {
                    return { completion: null, errorMessage: null, status: 'targets-closed' };
                  }
                  if (currentAnchor.windowId !== sourceWindowId) {
                    return {
                      completion: null,
                      errorMessage:
                        'The final saved tab moved to another window, so Weaver left it open.',
                      status: 'partial',
                    };
                  }

                  const finalSourceTabs = allTabs.filter((tab) => tab.windowId === sourceWindowId);
                  const finalAnchor = finalSourceTabs[0];
                  if (finalSourceTabs.length !== 1 || finalAnchor?.id !== anchorTabId) {
                    return {
                      completion: null,
                      errorMessage:
                        'The original window gained or replaced a tab while it was closing, so Weaver left the remaining tabs open.',
                      status: 'partial',
                    };
                  }
                  if (getTabCloseIdentityUrl(finalAnchor) !== anchorUrl) {
                    return {
                      completion: null,
                      errorMessage:
                        'The final saved tab navigated while the window was closing, so Weaver left it open.',
                      status: 'partial',
                    };
                  }

                  if (finalizationCancelled) {
                    return {
                      completion: null,
                      errorMessage:
                        'Automatic final-tab closing stopped after the operation timed out.',
                      status: 'partial',
                    };
                  }

                  try {
                    const completion = api.tabs.remove([anchorTabId]).then(
                      () => ({ errorMessage: null }),
                      (error: unknown) => ({ errorMessage: describeChromeError(error) }),
                    );
                    return { completion, errorMessage: null, status: 'close-requested' };
                  } catch (error) {
                    return {
                      completion: null,
                      errorMessage: `The final saved tab could not be closed: ${describeChromeError(error)}`,
                      status: 'partial',
                    };
                  }
                })();
                return finishPromise;
              };

              sourceWindowClose = {
                anchorTabId,
                batchCompletion,
                cancelFinalization: () => {
                  finalizationCancelled = true;
                },
                finish,
                nonAnchorTabIds,
                targetTabIds,
                windowId: sourceWindowId,
              };
            }
          }
        } catch (error) {
          warnings.push(
            `Weaver could not prepare the original window's tabs for closing: ${describeChromeError(error)}`,
          );
        }
      }

      return {
        savedWindow: cloneSavedWindow(capture.savedWindow),
        sourceWindowClose,
        warnings,
      };
    },

    async sortAllWindows(options) {
      return runWithCollectionOperationLock(() =>
        mutateCollection(async (collection) => {
          const beforeWindows = cloneSavedWindows(collection.windows);
          const transformed = sortSavedWindows(
            collection.windows,
            null,
            options,
            environment.now(),
          );
          if (transformed.result.sortedWindowIds.length === 0) {
            return { ...transformed.result, undo: null };
          }
          await writeCollection(transformed.windows);
          return {
            ...transformed.result,
            undo: {
              afterWindows: cloneSavedWindows(transformed.windows),
              beforeWindows,
            },
          };
        }),
      );
    },

    async sortWindow(savedWindowId, options) {
      return runWithCollectionOperationLock(() =>
        mutateCollection(async (collection) => {
          const beforeWindows = cloneSavedWindows(collection.windows);
          const transformed = sortSavedWindows(
            collection.windows,
            [savedWindowId],
            options,
            environment.now(),
          );
          if (transformed.result.sortedWindowIds.length === 0) {
            return { ...transformed.result, undo: null };
          }
          await writeCollection(transformed.windows);
          return {
            ...transformed.result,
            undo: {
              afterWindows: cloneSavedWindows(transformed.windows),
              beforeWindows,
            },
          };
        }),
      );
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

    subscribeCount(listener) {
      const handleChange = (changes: StorageChanges, areaName: string) => {
        if (areaName === 'local' && changes[SAVED_WINDOWS_STORAGE_KEY]) {
          listener();
        }
      };
      api.storage.onChanged.addListener(handleChange);
      return () => api.storage.onChanged.removeListener(handleChange);
    },

    async undoMutation(undo) {
      await runWithCollectionOperationLock(() =>
        mutateCollection(async (collection) => {
          if (!savedWindowCollectionsMatch(collection.windows, undo.afterWindows)) {
            throw new SavedWindowsMutationConflictError();
          }
          await writeCollection(undo.beforeWindows);
        }),
      );
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
    deduplicateTabs(rules) {
      return Promise.resolve().then(() => {
        const beforeWindows = cloneSavedWindows(windows);
        const transformed = deduplicateSavedWindows(windows, rules, new Date().toISOString());
        windows = transformed.windows;
        if (transformed.result.removedTabCount > 0) {
          notify();
        }
        return {
          ...transformed.result,
          undo:
            transformed.result.removedTabCount > 0
              ? {
                  afterWindows: cloneSavedWindows(windows),
                  beforeWindows,
                }
              : null,
        };
      });
    },
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
    loadCount: () => Promise.resolve(windows.length),
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
    mergeWindows(savedWindowIds, name) {
      return Promise.resolve().then(() => {
        const beforeWindows = cloneSavedWindows(windows);
        const transformed = mergeSavedWindows(
          windows,
          savedWindowIds,
          name,
          new Date().toISOString(),
        );
        windows = transformed.windows;
        notify();
        return {
          ...transformed.result,
          undo: {
            afterWindows: cloneSavedWindows(windows),
            beforeWindows,
          },
        };
      });
    },
    moveSelectedTabsToNewWindow(tabs, name) {
      return Promise.resolve().then(() => {
        const beforeWindows = cloneSavedWindows(windows);
        const transformed = moveSelectedSavedTabsToNewWindow(
          windows,
          tabs,
          name,
          crypto.randomUUID(),
          new Date().toISOString(),
        );
        windows = transformed.windows;
        notify();
        return {
          ...transformed.result,
          undo: {
            afterWindows: cloneSavedWindows(windows),
            beforeWindows,
          },
        };
      });
    },
    openTab: () => Promise.reject(new Error('Browser extension APIs are unavailable.')),
    removeSelectedTabs(tabs) {
      return Promise.resolve().then(() => {
        const beforeWindows = cloneSavedWindows(windows);
        const transformed = removeSelectedSavedTabs(windows, tabs, new Date().toISOString());
        windows = transformed.windows;
        notify();
        return {
          ...transformed.result,
          undo: {
            afterWindows: cloneSavedWindows(windows),
            beforeWindows,
          },
        };
      });
    },
    renameWindow(savedWindowId, name) {
      return Promise.resolve().then(() => {
        const existing = windows.find((window) => window.id === savedWindowId);
        if (!existing) {
          throw new Error('That saved window no longer exists.');
        }
        const updated = {
          ...cloneSavedWindow(existing),
          name: normalizeSavedWindowName(name),
          updatedAt: getSavedWindowMutationTimestamp(new Date().toISOString(), [existing]),
        };
        windows = windows.map((window) => (window.id === savedWindowId ? updated : window));
        notify();
        return cloneSavedWindow(updated);
      });
    },
    restoreWindow: () => Promise.reject(new Error('Browser extension APIs are unavailable.')),
    saveWindow: () => Promise.reject(new Error('Browser extension APIs are unavailable.')),
    sortAllWindows(options) {
      return Promise.resolve().then(() => {
        const beforeWindows = cloneSavedWindows(windows);
        const transformed = sortSavedWindows(windows, null, options, new Date().toISOString());
        if (transformed.result.sortedWindowIds.length === 0) {
          return { ...transformed.result, undo: null };
        }
        windows = transformed.windows;
        notify();
        return {
          ...transformed.result,
          undo: {
            afterWindows: cloneSavedWindows(windows),
            beforeWindows,
          },
        };
      });
    },
    sortWindow(savedWindowId, options) {
      return Promise.resolve().then(() => {
        const beforeWindows = cloneSavedWindows(windows);
        const transformed = sortSavedWindows(
          windows,
          [savedWindowId],
          options,
          new Date().toISOString(),
        );
        if (transformed.result.sortedWindowIds.length === 0) {
          return { ...transformed.result, undo: null };
        }
        windows = transformed.windows;
        notify();
        return {
          ...transformed.result,
          undo: {
            afterWindows: cloneSavedWindows(windows),
            beforeWindows,
          },
        };
      });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeCount: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    undoMutation(undo) {
      return Promise.resolve().then(() => {
        if (!savedWindowCollectionsMatch(windows, undo.afterWindows)) {
          throw new SavedWindowsMutationConflictError();
        }
        windows = cloneSavedWindows(undo.beforeWindows);
        notify();
      });
    },
  };
}
