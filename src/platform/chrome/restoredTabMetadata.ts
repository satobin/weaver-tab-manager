export const RESTORED_TAB_METADATA_STORAGE_KEY = 'weaver.restoredTabMetadata.v1';
export const RESTORED_TAB_TITLE_SETTLE_DELAY_MS = 5_000;
export const RESTORED_TAB_TITLE_MAX_SETTLE_MS = 30_000;

const RESTORED_TAB_METADATA_SCHEMA_VERSION = 1;
const RESTORED_TAB_METADATA_WRITE_LOCK = 'weaver.restoredTabMetadata.write';

interface ChromeEvent<TArgs extends unknown[]> {
  addListener: (listener: (...args: TArgs) => void) => void;
  removeListener: (listener: (...args: TArgs) => void) => void;
}

type StorageChanges = Record<string, chrome.storage.StorageChange>;

export interface RestoredTabMetadata {
  title: string;
  url: string;
}

export interface RestoredTabMetadataRegistration extends RestoredTabMetadata {
  tabId: number;
}

interface StoredRestoredTabMetadata extends RestoredTabMetadata {
  baselineTitle?: string;
  candidateSince?: number;
  candidateTitle?: string;
  settlingStartedAt?: number;
}

interface RestoredTabMetadataCollection {
  schemaVersion: 1;
  tabs: Record<string, StoredRestoredTabMetadata>;
}

export interface RestoredTabMetadataChromeApi {
  storage?:
    | {
        onChanged?: ChromeEvent<[changes: StorageChanges, areaName: string]> | undefined;
        session?:
          | {
              get: (key: string) => Promise<Record<string, unknown>>;
              remove: (key: string) => Promise<void>;
              set: (items: Record<string, unknown>) => Promise<void>;
            }
          | undefined;
      }
    | undefined;
}

interface ResolveRestoredTabMetadataOptions {
  pruneMissing?: boolean;
}

export interface RestoredTabMetadataService {
  register: (entries: readonly RestoredTabMetadataRegistration[]) => Promise<void>;
  remove: (tabIds: readonly number[]) => Promise<void>;
  resolve: (
    tabs: readonly chrome.tabs.Tab[],
    options?: ResolveRestoredTabMetadataOptions,
  ) => Promise<ReadonlyMap<number, RestoredTabMetadata>>;
  subscribe: (listener: () => void) => () => void;
}

export interface RestoredTabMetadataTracker {
  isTracked: (tabId: number) => Promise<boolean>;
  replace: (removedTabId: number, replacementTab: chrome.tabs.Tab) => Promise<boolean>;
}

interface RestoredTabMetadataEnvironment {
  now: () => number;
  withWriteLock: <T>(operation: () => Promise<T>) => Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseMetadata(value: unknown): StoredRestoredTabMetadata | null {
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.url !== 'string') {
    return null;
  }
  const title = value.title.trim();
  const url = value.url.trim();
  if (!title || !url) {
    return null;
  }

  const metadata: StoredRestoredTabMetadata = { title, url };
  const baselineTitle = typeof value.baselineTitle === 'string' ? value.baselineTitle.trim() : '';
  const candidateTitle =
    typeof value.candidateTitle === 'string' ? value.candidateTitle.trim() : '';
  const candidateSince = value.candidateSince;
  const settlingStartedAt = value.settlingStartedAt;
  if (
    candidateTitle &&
    typeof candidateSince === 'number' &&
    Number.isFinite(candidateSince) &&
    candidateSince >= 0 &&
    typeof settlingStartedAt === 'number' &&
    Number.isFinite(settlingStartedAt) &&
    settlingStartedAt >= 0 &&
    candidateSince >= settlingStartedAt
  ) {
    // Older v1 records may predate baselineTitle. Treat their current candidate as the
    // baseline so an upgrade retains the saved title conservatively instead of settling early.
    metadata.baselineTitle = baselineTitle || candidateTitle;
    metadata.candidateSince = candidateSince;
    metadata.candidateTitle = candidateTitle;
    metadata.settlingStartedAt = settlingStartedAt;
  }
  return metadata;
}

function parseCollection(value: unknown): RestoredTabMetadataCollection {
  if (
    !isRecord(value) ||
    value.schemaVersion !== RESTORED_TAB_METADATA_SCHEMA_VERSION ||
    !isRecord(value.tabs)
  ) {
    return { schemaVersion: RESTORED_TAB_METADATA_SCHEMA_VERSION, tabs: {} };
  }

  const tabs: Record<string, StoredRestoredTabMetadata> = {};
  Object.entries(value.tabs).forEach(([tabId, candidate]) => {
    if (!Number.isInteger(Number(tabId)) || Number(tabId) < 0) {
      return;
    }
    const metadata = parseMetadata(candidate);
    if (metadata) {
      tabs[tabId] = metadata;
    }
  });
  return { schemaVersion: RESTORED_TAB_METADATA_SCHEMA_VERSION, tabs };
}

function observedTabUrl(tab: chrome.tabs.Tab): string {
  return tab.pendingUrl?.trim() || tab.url?.trim() || '';
}

function observedTabTitle(tab: chrome.tabs.Tab, observedUrl: string): string | null {
  const title = tab.title?.trim() ?? '';
  if (!title) {
    return null;
  }
  const normalizedTitle = title.toLowerCase();
  if (
    normalizedTitle === 'untitled' ||
    normalizedTitle === 'untitled tab' ||
    normalizedTitle === 'new tab' ||
    title === observedUrl
  ) {
    return null;
  }
  return title;
}

function clearSettlingState(metadata: StoredRestoredTabMetadata): boolean {
  if (
    metadata.baselineTitle === undefined &&
    metadata.candidateSince === undefined &&
    metadata.candidateTitle === undefined &&
    metadata.settlingStartedAt === undefined
  ) {
    return false;
  }
  delete metadata.baselineTitle;
  delete metadata.candidateSince;
  delete metadata.candidateTitle;
  delete metadata.settlingStartedAt;
  return true;
}

async function withBrowserWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return operation();
  }
  return navigator.locks
    .request<Promise<T>>(RESTORED_TAB_METADATA_WRITE_LOCK, operation)
    .then((result) => result);
}

const DEFAULT_ENVIRONMENT: RestoredTabMetadataEnvironment = {
  now: Date.now,
  withWriteLock: withBrowserWriteLock,
};

export function applyRestoredTabMetadata(
  tab: chrome.tabs.Tab,
  metadataByTabId: ReadonlyMap<number, RestoredTabMetadata>,
): chrome.tabs.Tab {
  if (tab.id === undefined) {
    return tab;
  }
  const metadata = metadataByTabId.get(tab.id);
  if (!metadata) {
    return tab;
  }
  return {
    ...tab,
    title: metadata.title,
    url: metadata.url,
  };
}

export function createRestoredTabMetadataService(
  api: RestoredTabMetadataChromeApi = chrome,
  environment: RestoredTabMetadataEnvironment = DEFAULT_ENVIRONMENT,
): RestoredTabMetadataService & RestoredTabMetadataTracker {
  const storage = api.storage?.session;
  const subscribers = new Set<() => void>();
  let writeQueue: Promise<void> = Promise.resolve();
  let trackedTabIds: ReadonlySet<number> | null = null;
  let trackedTabIdsLoad: Promise<ReadonlySet<number>> | null = null;
  let trackedTabIdsRevision = 0;
  let trackingCacheEnabled = false;
  let listeningForStorageChanges = false;

  const load = async (): Promise<RestoredTabMetadataCollection> => {
    if (!storage) {
      return { schemaVersion: RESTORED_TAB_METADATA_SCHEMA_VERSION, tabs: {} };
    }
    const stored = await storage.get(RESTORED_TAB_METADATA_STORAGE_KEY);
    return parseCollection(stored[RESTORED_TAB_METADATA_STORAGE_KEY]);
  };

  const write = async (collection: RestoredTabMetadataCollection): Promise<void> => {
    if (!storage) {
      return;
    }
    if (Object.keys(collection.tabs).length === 0) {
      await storage.remove(RESTORED_TAB_METADATA_STORAGE_KEY);
      return;
    }
    await storage.set({ [RESTORED_TAB_METADATA_STORAGE_KEY]: collection });
  };

  const tabIdsFromCollection = (collection: RestoredTabMetadataCollection): ReadonlySet<number> =>
    new Set(Object.keys(collection.tabs).map(Number));

  const rememberTrackedTabIds = (
    collection: RestoredTabMetadataCollection,
    expectedRevision: number,
  ) => {
    if (trackedTabIdsRevision === expectedRevision) {
      trackedTabIds = tabIdsFromCollection(collection);
    }
  };

  const loadTrackedTabIds = (): Promise<ReadonlySet<number>> => {
    if (trackedTabIds) {
      return Promise.resolve(trackedTabIds);
    }
    if (trackedTabIdsLoad) {
      return trackedTabIdsLoad;
    }

    const pendingLoad = (async () => {
      while (true) {
        const pendingWrites = writeQueue;
        await pendingWrites;
        if (pendingWrites !== writeQueue) {
          continue;
        }
        if (trackedTabIds) {
          return trackedTabIds;
        }
        const revision = trackedTabIdsRevision;
        const collection = await load();
        // Never cache a negative lookup from before a local mutation or external storage change.
        if (pendingWrites !== writeQueue || revision !== trackedTabIdsRevision) {
          continue;
        }
        const tabIds = tabIdsFromCollection(collection);
        trackedTabIds = tabIds;
        return tabIds;
      }
    })();
    trackedTabIdsLoad = pendingLoad;
    const clearPendingLoad = () => {
      if (trackedTabIdsLoad === pendingLoad) {
        trackedTabIdsLoad = null;
      }
    };
    void pendingLoad.then(clearPendingLoad, clearPendingLoad);
    return pendingLoad;
  };

  const onChanged = api.storage?.onChanged;
  const handleStorageChange = (changes: StorageChanges, areaName: string) => {
    if (areaName !== 'session' || !changes[RESTORED_TAB_METADATA_STORAGE_KEY]) {
      return;
    }
    trackedTabIdsRevision += 1;
    trackedTabIds = null;
    subscribers.forEach((listener) => {
      try {
        listener();
      } catch {
        // Keep notifying independent subscribers after one consumer fails.
      }
    });
  };
  const syncStorageChangeListener = () => {
    if (!onChanged) {
      return;
    }
    const shouldListen = trackingCacheEnabled || subscribers.size > 0;
    if (shouldListen && !listeningForStorageChanges) {
      onChanged.addListener(handleStorageChange);
      listeningForStorageChanges = true;
    } else if (!shouldListen && listeningForStorageChanges) {
      onChanged.removeListener(handleStorageChange);
      listeningForStorageChanges = false;
    }
  };

  const mutate = <T>(
    mutation: (
      collection: RestoredTabMetadataCollection,
    ) => Promise<{ changed: boolean; result: T }> | { changed: boolean; result: T },
  ): Promise<T> => {
    if (!storage) {
      return Promise.resolve(mutation({ schemaVersion: 1, tabs: {} })).then(
        (output) => output.result,
      );
    }
    const operation = writeQueue.then(() =>
      environment.withWriteLock(async () => {
        const trackedTabIdsRevisionAtLoad = trackedTabIdsRevision;
        const collection = await load();
        const output = await mutation(collection);
        if (output.changed) {
          await write(collection);
        }
        rememberTrackedTabIds(collection, trackedTabIdsRevisionAtLoad);
        return output.result;
      }),
    );
    writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  return {
    async isTracked(tabId) {
      if (!Number.isInteger(tabId) || tabId < 0) {
        return false;
      }
      if (!trackingCacheEnabled) {
        trackingCacheEnabled = true;
        trackedTabIds = null;
      }
      syncStorageChangeListener();
      return (await loadTrackedTabIds()).has(tabId);
    },

    async register(entries) {
      const normalizedEntries = entries.flatMap((entry) => {
        const title = entry.title.trim();
        const url = entry.url.trim();
        return Number.isInteger(entry.tabId) && entry.tabId >= 0 && title && url
          ? [{ tabId: entry.tabId, title, url }]
          : [];
      });
      if (normalizedEntries.length === 0) {
        return;
      }
      await mutate((collection) => {
        let changed = false;
        normalizedEntries.forEach(({ tabId, title, url }) => {
          const key = String(tabId);
          const current = collection.tabs[key];
          if (
            current?.title === title &&
            current.url === url &&
            current.baselineTitle === undefined &&
            current.candidateSince === undefined &&
            current.candidateTitle === undefined &&
            current.settlingStartedAt === undefined
          ) {
            return;
          }
          collection.tabs[key] = { title, url };
          changed = true;
        });
        return { changed, result: undefined };
      });
    },

    async replace(removedTabId, replacementTab) {
      if (!Number.isInteger(removedTabId) || removedTabId < 0) {
        return false;
      }
      const replacementTabId = replacementTab.id;
      return mutate((collection) => {
        const removedKey = String(removedTabId);
        const metadata = collection.tabs[removedKey];
        if (!metadata) {
          return { changed: false, result: false };
        }

        delete collection.tabs[removedKey];
        const replacementUrl = observedTabUrl(replacementTab);
        const canTransfer =
          replacementTabId !== undefined &&
          Number.isInteger(replacementTabId) &&
          replacementTabId >= 0 &&
          replacementTabId !== removedTabId &&
          replacementUrl === metadata.url;
        if (canTransfer) {
          collection.tabs[String(replacementTabId)] = {
            title: metadata.title,
            url: metadata.url,
          };
        }
        return { changed: true, result: canTransfer };
      });
    },

    async remove(tabIds) {
      const keys = new Set(tabIds.filter(Number.isInteger).map(String));
      if (keys.size === 0) {
        return;
      }
      await mutate((collection) => {
        let changed = false;
        keys.forEach((key) => {
          if (collection.tabs[key]) {
            delete collection.tabs[key];
            changed = true;
          }
        });
        return { changed, result: undefined };
      });
    },

    resolve(tabs, options = {}) {
      const pruneMissing = options.pruneMissing ?? true;
      const tabsById = new Map(
        tabs.flatMap((tab) => (tab.id === undefined ? [] : [[tab.id, tab] as const])),
      );
      return mutate((collection) => {
        const resolved = new Map<number, RestoredTabMetadata>();
        let changed = false;
        Object.entries(collection.tabs).forEach(([key, metadata]) => {
          const tabId = Number(key);
          const tab = tabsById.get(tabId);
          if (!tab) {
            if (pruneMissing) {
              delete collection.tabs[key];
              changed = true;
            }
            return;
          }

          const observedUrl = observedTabUrl(tab);
          if (observedUrl && observedUrl !== metadata.url) {
            delete collection.tabs[key];
            changed = true;
            return;
          }

          const liveTitle = observedTabTitle(tab, observedUrl);
          // A completed tab can still expose an app-shell title before its document data arrives.
          // Treat the first live title as a baseline; a later title can settle after a quiet period,
          // while the hard deadline covers pages whose first observed title was already final.
          const canSettle =
            observedUrl === metadata.url &&
            tab.active &&
            tab.status === 'complete' &&
            liveTitle !== null;
          if (!canSettle) {
            changed = clearSettlingState(metadata) || changed;
            resolved.set(tabId, { title: metadata.title, url: metadata.url });
            return;
          }

          if (liveTitle === metadata.title) {
            delete collection.tabs[key];
            changed = true;
            return;
          }

          const now = environment.now();
          const hasInvalidClock =
            (metadata.candidateSince !== undefined && metadata.candidateSince > now) ||
            (metadata.settlingStartedAt !== undefined && metadata.settlingStartedAt > now);
          if (
            !hasInvalidClock &&
            metadata.settlingStartedAt !== undefined &&
            now - metadata.settlingStartedAt >= RESTORED_TAB_TITLE_MAX_SETTLE_MS
          ) {
            delete collection.tabs[key];
            changed = true;
            return;
          }
          if (
            metadata.candidateTitle !== liveTitle ||
            metadata.candidateSince === undefined ||
            hasInvalidClock
          ) {
            metadata.candidateTitle = liveTitle;
            metadata.candidateSince = now;
            if (
              metadata.baselineTitle === undefined ||
              metadata.settlingStartedAt === undefined ||
              hasInvalidClock
            ) {
              metadata.baselineTitle = liveTitle;
              metadata.settlingStartedAt = now;
            }
            changed = true;
          } else if (
            metadata.baselineTitle !== liveTitle &&
            now - metadata.candidateSince >= RESTORED_TAB_TITLE_SETTLE_DELAY_MS
          ) {
            delete collection.tabs[key];
            changed = true;
            return;
          }

          resolved.set(tabId, { title: metadata.title, url: metadata.url });
        });
        return { changed, result: resolved };
      });
    },

    subscribe(listener) {
      if (!onChanged) {
        return () => undefined;
      }
      const subscription = () => listener();
      subscribers.add(subscription);
      syncStorageChangeListener();
      return () => {
        subscribers.delete(subscription);
        syncStorageChangeListener();
      };
    },
  };
}
