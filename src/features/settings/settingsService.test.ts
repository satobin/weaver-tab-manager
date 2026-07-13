import { describe, expect, it, vi } from 'vitest';

import { type DedupeRule } from '../deduplication/deduplication';
import {
  createChromeSettingsService,
  DEFAULT_SETTINGS,
  parseSettings,
  SETTINGS_STORAGE_KEY,
  type SettingsChromeApi,
} from './settingsService';

function createApi(initialValue?: unknown) {
  const listeners = new Set<
    (changes: Record<string, chrome.storage.StorageChange>, area: string) => void
  >();
  const values: Record<string, unknown> = {};
  if (initialValue !== undefined) {
    values[SETTINGS_STORAGE_KEY] = initialValue;
  }

  const api: SettingsChromeApi = {
    storage: {
      local: {
        get: vi.fn((key: string) => Promise.resolve({ [key]: values[key] })),
        set: vi.fn((items: Record<string, unknown>) => {
          Object.assign(values, items);
          return Promise.resolve();
        }),
      },
      onChanged: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
    },
  };

  return {
    api,
    emit: (value: unknown, area = 'local') => {
      listeners.forEach((listener) =>
        listener({ [SETTINGS_STORAGE_KEY]: { newValue: value } }, area),
      );
    },
    listenerCount: () => listeners.size,
  };
}

describe('settingsService', () => {
  it('starts with conservative public defaults', () => {
    expect(DEFAULT_SETTINGS.advancedDuplicateMatchingEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.deduplicationRules).toHaveLength(6);
    expect(DEFAULT_SETTINGS.deduplicationRules.every((rule) => !rule.enabled)).toBe(true);
    expect(
      DEFAULT_SETTINGS.deduplicationRules.some((rule) => !rule.id.startsWith('builtin-')),
    ).toBe(false);
    expect(DEFAULT_SETTINGS.showTabUrls).toBe(false);
  });

  it('uses clean defaults for missing, malformed, or pre-public settings data', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ schemaVersion: 1, preserveGroupsDuringSort: 'no' })).toEqual({
      ...DEFAULT_SETTINGS,
      preserveGroupsDuringSort: DEFAULT_SETTINGS.preserveGroupsDuringSort,
    });
    expect(
      parseSettings({
        deduplicationRules: [
          {
            comparisonMode: 'full-path',
            enabled: true,
            glob: 'retired-internal.example/*',
            id: 'default-retired-internal',
          },
        ],
        duplicateMatchingEnabled: true,
        schemaVersion: 4,
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it('parses the single current settings shape', () => {
    const customRule: DedupeRule = {
      comparisonMode: 'full-path',
      enabled: true,
      glob: 'app.example.com/*',
      id: 'custom-example',
    };

    expect(
      parseSettings({
        advancedDuplicateMatchingEnabled: true,
        colorMode: 'dark',
        deduplicationRules: [customRule],
        preserveGroupsDuringSort: false,
        schemaVersion: 1,
        showTabUrls: true,
      }),
    ).toEqual({
      advancedDuplicateMatchingEnabled: true,
      colorMode: 'dark',
      deduplicationRules: [customRule],
      preserveGroupsDuringSort: false,
      schemaVersion: 1,
      showTabUrls: true,
    });
  });

  it('loads and writes the current local settings record', async () => {
    const { api } = createApi({ schemaVersion: 1, preserveGroupsDuringSort: false });
    const service = createChromeSettingsService(api);

    await expect(service.load()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      preserveGroupsDuringSort: false,
    });
    await expect(service.setPreserveGroupsDuringSort(true)).resolves.toEqual(DEFAULT_SETTINGS);
    expect(api.storage.local.set).toHaveBeenCalledWith({
      [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS,
    });
  });

  it('subscribes only to local changes and cleans up', () => {
    const fake = createApi();
    const service = createChromeSettingsService(fake.api);
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    const changed = { ...DEFAULT_SETTINGS, preserveGroupsDuringSort: false };

    fake.emit(changed, 'sync');
    expect(listener).not.toHaveBeenCalled();
    fake.emit(changed);
    expect(listener).toHaveBeenCalledWith(changed);

    unsubscribe();
    expect(fake.listenerCount()).toBe(0);
  });

  it('persists an exact-only rule list and rejects invalid writes', async () => {
    const { api } = createApi(DEFAULT_SETTINGS);
    const service = createChromeSettingsService(api);

    await expect(service.setDeduplicationRules([])).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      deduplicationRules: [],
    });
    await expect(
      service.setDeduplicationRules([
        {
          comparisonMode: 'path-prefix',
          enabled: true,
          glob: 'example.com/*',
          id: 'invalid',
          pathSegmentCount: 0,
        },
      ]),
    ).rejects.toThrow('One or more duplicate rules are invalid.');
  });

  it('persists appearance, URL visibility, and the advanced matching switch independently', async () => {
    const { api } = createApi(DEFAULT_SETTINGS);
    const service = createChromeSettingsService(api);

    await expect(service.setColorMode('dark')).resolves.toMatchObject({ colorMode: 'dark' });
    await expect(service.setShowTabUrls(true)).resolves.toMatchObject({
      colorMode: 'dark',
      showTabUrls: true,
    });
    await expect(service.setAdvancedDuplicateMatchingEnabled(true)).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      advancedDuplicateMatchingEnabled: true,
      colorMode: 'dark',
      showTabUrls: true,
    });
  });

  it('serializes overlapping changes and skips an equivalent write', async () => {
    const { api } = createApi(DEFAULT_SETTINGS);
    const service = createChromeSettingsService(api);

    await Promise.all([service.setColorMode('dark'), service.setShowTabUrls(true)]);

    await expect(service.load()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      colorMode: 'dark',
      showTabUrls: true,
    });
    expect(api.storage.local.set).toHaveBeenCalledTimes(2);

    await service.setColorMode('dark');
    expect(api.storage.local.set).toHaveBeenCalledTimes(2);
  });

  it('serializes writes across independent settings service instances', async () => {
    const { api } = createApi(DEFAULT_SETTINGS);
    let lockQueue: Promise<void> = Promise.resolve();
    let lockCalls = 0;
    const withWriteLock = <T>(operation: () => Promise<T>): Promise<T> => {
      lockCalls += 1;
      const result = lockQueue.then(operation);
      lockQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    const firstService = createChromeSettingsService(api, { withWriteLock });
    const secondService = createChromeSettingsService(api, { withWriteLock });

    await Promise.all([firstService.setColorMode('dark'), secondService.setShowTabUrls(true)]);

    await expect(firstService.load()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      colorMode: 'dark',
      showTabUrls: true,
    });
    expect(lockCalls).toBe(2);
  });
});
