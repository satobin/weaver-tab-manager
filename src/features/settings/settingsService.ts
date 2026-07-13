import {
  type DedupeRule,
  cloneDedupeRules,
  DEFAULT_DEDUPLICATION_RULES,
  orderBuiltInDedupeRulesFirst,
  parseDedupeRules,
} from '../deduplication/deduplication';

export const SETTINGS_STORAGE_KEY = 'weaver.settings.v1';
const SETTINGS_SCHEMA_VERSION = 1;
const SETTINGS_WRITE_LOCK = 'weaver.settings.write';

export type ColorMode = 'system' | 'light' | 'dark';

export interface WeaverSettings {
  advancedDuplicateMatchingEnabled: boolean;
  colorMode: ColorMode;
  deduplicationRules: DedupeRule[];
  preserveGroupsDuringSort: boolean;
  showTabUrls: boolean;
  schemaVersion: 1;
}

export const DEFAULT_SETTINGS: WeaverSettings = Object.freeze({
  advancedDuplicateMatchingEnabled: false,
  colorMode: 'system',
  deduplicationRules: cloneDedupeRules(DEFAULT_DEDUPLICATION_RULES),
  preserveGroupsDuringSort: true,
  showTabUrls: false,
  schemaVersion: SETTINGS_SCHEMA_VERSION,
});

function createDefaultSettings(): WeaverSettings {
  return {
    ...DEFAULT_SETTINGS,
    deduplicationRules: cloneDedupeRules(DEFAULT_SETTINGS.deduplicationRules),
  };
}

function validateRulesForStorage(rules: readonly DedupeRule[]): DedupeRule[] {
  const parsed = parseDedupeRules(rules);
  if (!parsed || parsed.length !== rules.length) {
    throw new Error('One or more duplicate rules are invalid.');
  }
  return parsed;
}

function rulesMatch(first: readonly DedupeRule[], second: readonly DedupeRule[]): boolean {
  return (
    first.length === second.length &&
    first.every((rule, index) => {
      const comparison = second[index];
      return (
        comparison !== undefined &&
        rule.comparisonMode === comparison.comparisonMode &&
        rule.enabled === comparison.enabled &&
        rule.glob === comparison.glob &&
        rule.id === comparison.id &&
        rule.pathSegmentCount === comparison.pathSegmentCount
      );
    })
  );
}

type StorageChanges = Record<string, chrome.storage.StorageChange>;

interface StorageChangedEvent {
  addListener: (listener: (changes: StorageChanges, areaName: string) => void) => void;
  removeListener: (listener: (changes: StorageChanges, areaName: string) => void) => void;
}

export interface SettingsChromeApi {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
    onChanged: StorageChangedEvent;
  };
}

export interface SettingsService {
  load: () => Promise<WeaverSettings>;
  setAdvancedDuplicateMatchingEnabled: (value: boolean) => Promise<WeaverSettings>;
  setColorMode: (value: ColorMode) => Promise<WeaverSettings>;
  setDeduplicationRules: (rules: readonly DedupeRule[]) => Promise<WeaverSettings>;
  setPreserveGroupsDuringSort: (value: boolean) => Promise<WeaverSettings>;
  setShowTabUrls: (value: boolean) => Promise<WeaverSettings>;
  subscribe: (listener: (settings: WeaverSettings) => void) => () => void;
}

export interface SettingsEnvironment {
  withWriteLock?: (<T>(operation: () => Promise<T>) => Promise<T>) | undefined;
}

function withBrowserWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return operation();
  }
  return navigator.locks
    .request<Promise<T>>(SETTINGS_WRITE_LOCK, operation)
    .then((result) => result);
}

const DEFAULT_ENVIRONMENT: SettingsEnvironment = {
  withWriteLock: withBrowserWriteLock,
};

export function parseSettings(value: unknown): WeaverSettings {
  if (!value || typeof value !== 'object') {
    return createDefaultSettings();
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    return createDefaultSettings();
  }

  const parsedDeduplicationRules = parseDedupeRules(candidate.deduplicationRules);
  const deduplicationRules = parsedDeduplicationRules
    ? orderBuiltInDedupeRulesFirst(parsedDeduplicationRules)
    : cloneDedupeRules(DEFAULT_SETTINGS.deduplicationRules);
  const colorMode =
    candidate.colorMode === 'light' ||
    candidate.colorMode === 'dark' ||
    candidate.colorMode === 'system'
      ? candidate.colorMode
      : DEFAULT_SETTINGS.colorMode;

  return {
    advancedDuplicateMatchingEnabled:
      typeof candidate.advancedDuplicateMatchingEnabled === 'boolean'
        ? candidate.advancedDuplicateMatchingEnabled
        : DEFAULT_SETTINGS.advancedDuplicateMatchingEnabled,
    colorMode,
    deduplicationRules,
    preserveGroupsDuringSort:
      typeof candidate.preserveGroupsDuringSort === 'boolean'
        ? candidate.preserveGroupsDuringSort
        : DEFAULT_SETTINGS.preserveGroupsDuringSort,
    showTabUrls:
      typeof candidate.showTabUrls === 'boolean'
        ? candidate.showTabUrls
        : DEFAULT_SETTINGS.showTabUrls,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
  };
}

export function createChromeSettingsService(
  api: SettingsChromeApi = chrome,
  environment: SettingsEnvironment = DEFAULT_ENVIRONMENT,
): SettingsService {
  const load = async () => {
    const stored = await api.storage.local.get(SETTINGS_STORAGE_KEY);
    return parseSettings(stored[SETTINGS_STORAGE_KEY]);
  };
  let mutationQueue: Promise<void> = Promise.resolve();
  const updateSettings = (
    update: (current: WeaverSettings) => WeaverSettings,
  ): Promise<WeaverSettings> => {
    const withWriteLock = environment.withWriteLock ?? withBrowserWriteLock;
    const operation = mutationQueue.then(() =>
      withWriteLock(async () => {
        const current = await load();
        const next = update(current);
        if (next !== current) {
          await api.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
        }
        return next;
      }),
    );
    mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  return {
    load,

    setAdvancedDuplicateMatchingEnabled(value) {
      return updateSettings((current) =>
        current.advancedDuplicateMatchingEnabled === value
          ? current
          : { ...current, advancedDuplicateMatchingEnabled: value },
      );
    },

    setColorMode(value) {
      return updateSettings((current) =>
        current.colorMode === value ? current : { ...current, colorMode: value },
      );
    },

    setDeduplicationRules(rules) {
      return updateSettings((current) => {
        const validatedRules = validateRulesForStorage(rules);
        return rulesMatch(current.deduplicationRules, validatedRules)
          ? current
          : { ...current, deduplicationRules: validatedRules };
      });
    },

    setPreserveGroupsDuringSort(value) {
      return updateSettings((current) =>
        current.preserveGroupsDuringSort === value
          ? current
          : { ...current, preserveGroupsDuringSort: value },
      );
    },

    setShowTabUrls(value) {
      return updateSettings((current) =>
        current.showTabUrls === value ? current : { ...current, showTabUrls: value },
      );
    },

    subscribe(listener) {
      const handleChange = (changes: StorageChanges, areaName: string) => {
        const change = changes[SETTINGS_STORAGE_KEY];
        if (areaName === 'local' && change) {
          listener(parseSettings(change.newValue));
        }
      };
      api.storage.onChanged.addListener(handleChange);
      return () => api.storage.onChanged.removeListener(handleChange);
    },
  };
}

export function createSettingsService(): SettingsService {
  if (typeof chrome !== 'undefined' && chrome.storage?.local && chrome.storage.onChanged) {
    return createChromeSettingsService();
  }

  let settings = createDefaultSettings();
  const listeners = new Set<(nextSettings: WeaverSettings) => void>();
  return {
    load: () => Promise.resolve(settings),
    setAdvancedDuplicateMatchingEnabled: (value) => {
      settings = { ...settings, advancedDuplicateMatchingEnabled: value };
      listeners.forEach((listener) => listener(settings));
      return Promise.resolve(settings);
    },
    setColorMode: (value) => {
      settings = { ...settings, colorMode: value };
      listeners.forEach((listener) => listener(settings));
      return Promise.resolve(settings);
    },
    setDeduplicationRules: (rules) => {
      settings = { ...settings, deduplicationRules: validateRulesForStorage(rules) };
      listeners.forEach((listener) => listener(settings));
      return Promise.resolve(settings);
    },
    setPreserveGroupsDuringSort: (value) => {
      settings = { ...settings, preserveGroupsDuringSort: value };
      listeners.forEach((listener) => listener(settings));
      return Promise.resolve(settings);
    },
    setShowTabUrls: (value) => {
      settings = { ...settings, showTabUrls: value };
      listeners.forEach((listener) => listener(settings));
      return Promise.resolve(settings);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
