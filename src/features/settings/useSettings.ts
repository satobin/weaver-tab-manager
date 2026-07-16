import { useCallback, useEffect, useRef, useState } from 'react';

import { type DedupeRule } from '../deduplication/deduplication';
import {
  type ColorMode,
  DEFAULT_SETTINGS,
  type SettingsService,
  type WeaverSettings,
} from './settingsService';

type SettingsSaveTarget =
  | 'advancedDuplicateMatchingEnabled'
  | 'colorMode'
  | 'deduplicationRules'
  | 'preserveGroupsDuringSort'
  | 'showTabUrls';

export interface SettingsState {
  errorMessage: string | null;
  isLoading: boolean;
  isSaving: boolean;
  savingSettings: ReadonlySet<SettingsSaveTarget>;
  setAdvancedDuplicateMatchingEnabled: (value: boolean) => Promise<boolean>;
  setColorMode: (value: ColorMode) => Promise<boolean>;
  setDeduplicationRules: (rules: readonly DedupeRule[]) => Promise<boolean>;
  setPreserveGroupsDuringSort: (value: boolean) => Promise<boolean>;
  setShowTabUrls: (value: boolean) => Promise<boolean>;
  settings: WeaverSettings;
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'The browser could not save this setting.';
}

export function useSettings(service: SettingsService): SettingsState {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState<ReadonlySet<SettingsSaveTarget>>(
    () => new Set(),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const settingsRef = useRef<WeaverSettings>(DEFAULT_SETTINGS);
  const savingSettingsRef = useRef<ReadonlySet<SettingsSaveTarget>>(new Set());
  const applySettings = useCallback((nextSettings: WeaverSettings) => {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
  }, []);
  const saveSetting = useCallback(
    async (
      target: SettingsSaveTarget,
      persist: () => Promise<WeaverSettings>,
    ): Promise<boolean> => {
      if (savingSettingsRef.current.has(target)) {
        return false;
      }
      const pending = new Set(savingSettingsRef.current);
      pending.add(target);
      savingSettingsRef.current = pending;
      setSavingSettings(pending);
      setErrorMessage(null);
      try {
        applySettings(await persist());
        return true;
      } catch (error) {
        setErrorMessage(describeError(error));
        return false;
      } finally {
        const remaining = new Set(savingSettingsRef.current);
        remaining.delete(target);
        savingSettingsRef.current = remaining;
        setSavingSettings(remaining);
      }
    },
    [applySettings],
  );

  useEffect(() => {
    let active = true;
    const unsubscribe = service.subscribe((nextSettings) => {
      if (active) {
        applySettings(nextSettings);
        setErrorMessage(null);
      }
    });

    void service
      .load()
      .then((nextSettings) => {
        if (active) {
          applySettings(nextSettings);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(describeError(error));
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applySettings, service]);

  const setPreserveGroupsDuringSort = useCallback(
    async (value: boolean) => {
      if (settingsRef.current.preserveGroupsDuringSort === value) {
        return true;
      }
      return saveSetting('preserveGroupsDuringSort', () =>
        service.setPreserveGroupsDuringSort(value),
      );
    },
    [saveSetting, service],
  );

  const setColorMode = useCallback(
    async (value: ColorMode) => {
      if (settingsRef.current.colorMode === value) {
        return true;
      }
      return saveSetting('colorMode', () => service.setColorMode(value));
    },
    [saveSetting, service],
  );

  const setShowTabUrls = useCallback(
    async (value: boolean) => {
      if (settingsRef.current.showTabUrls === value) {
        return true;
      }
      return saveSetting('showTabUrls', () => service.setShowTabUrls(value));
    },
    [saveSetting, service],
  );

  const setDeduplicationRules = useCallback(
    async (rules: readonly DedupeRule[]) => {
      return saveSetting('deduplicationRules', () => service.setDeduplicationRules(rules));
    },
    [saveSetting, service],
  );

  const setAdvancedDuplicateMatchingEnabled = useCallback(
    async (value: boolean) => {
      if (settingsRef.current.advancedDuplicateMatchingEnabled === value) {
        return true;
      }
      return saveSetting('advancedDuplicateMatchingEnabled', () =>
        service.setAdvancedDuplicateMatchingEnabled(value),
      );
    },
    [saveSetting, service],
  );

  return {
    errorMessage,
    isLoading,
    isSaving: savingSettings.size > 0,
    savingSettings,
    setAdvancedDuplicateMatchingEnabled,
    setColorMode,
    setDeduplicationRules,
    setPreserveGroupsDuringSort,
    setShowTabUrls,
    settings,
  };
}
