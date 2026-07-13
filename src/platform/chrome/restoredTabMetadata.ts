export const RESTORED_TAB_METADATA_STORAGE_KEY = 'weaver.restoredTabMetadata.v1';

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

interface RestoredTabMetadataCollection {
  schemaVersion: 1;
  tabs: Record<string, RestoredTabMetadata>;
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

interface RestoredTabMetadataEnvironment {
  withWriteLock: <T>(operation: () => Promise<T>) => Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseMetadata(value: unknown): RestoredTabMetadata | null {
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.url !== 'string') {
    return null;
  }
  const title = value.title.trim();
  const url = value.url.trim();
  return title && url ? { title, url } : null;
}

function parseCollection(value: unknown): RestoredTabMetadataCollection {
  if (
    !isRecord(value) ||
    value.schemaVersion !== RESTORED_TAB_METADATA_SCHEMA_VERSION ||
    !isRecord(value.tabs)
  ) {
    return { schemaVersion: RESTORED_TAB_METADATA_SCHEMA_VERSION, tabs: {} };
  }

  const tabs: Record<string, RestoredTabMetadata> = {};
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

function hasTrustworthyTitle(tab: chrome.tabs.Tab, observedUrl: string): boolean {
  const title = tab.title?.trim() ?? '';
  if (!title) {
    return false;
  }
  const normalizedTitle = title.toLowerCase();
  if (
    normalizedTitle === 'untitled' ||
    normalizedTitle === 'untitled tab' ||
    normalizedTitle === 'new tab'
  ) {
    return false;
  }
  return tab.status === 'complete' || title !== observedUrl;
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
  const observedUrl = observedTabUrl(tab);
  return {
    ...tab,
    title: hasTrustworthyTitle(tab, observedUrl) ? tab.title : metadata.title,
    url: metadata.url,
  };
}

export function createRestoredTabMetadataService(
  api: RestoredTabMetadataChromeApi = chrome,
  environment: RestoredTabMetadataEnvironment = DEFAULT_ENVIRONMENT,
): RestoredTabMetadataService {
  const storage = api.storage?.session;
  let writeQueue: Promise<void> = Promise.resolve();

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
        const collection = await load();
        const output = await mutation(collection);
        if (output.changed) {
          await write(collection);
        }
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
          if (current?.title === title && current.url === url) {
            return;
          }
          collection.tabs[key] = { title, url };
          changed = true;
        });
        return { changed, result: undefined };
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
          if (observedUrl === metadata.url && hasTrustworthyTitle(tab, observedUrl)) {
            delete collection.tabs[key];
            changed = true;
            return;
          }
          resolved.set(tabId, { ...metadata });
        });
        return { changed, result: resolved };
      });
    },

    subscribe(listener) {
      const onChanged = api.storage?.onChanged;
      if (!onChanged) {
        return () => undefined;
      }
      const handleChange = (changes: StorageChanges, areaName: string) => {
        if (areaName === 'session' && changes[RESTORED_TAB_METADATA_STORAGE_KEY]) {
          listener();
        }
      };
      onChanged.addListener(handleChange);
      return () => onChanged.removeListener(handleChange);
    },
  };
}
