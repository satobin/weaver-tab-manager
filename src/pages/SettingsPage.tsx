import { useMemo } from 'react';

import { createChromeActiveWindowsService } from '../features/active-windows/chromeActiveWindowsService';
import {
  type ActiveWindowsDataSource,
  useActiveWindows,
} from '../features/active-windows/useActiveWindows';
import { DedupeRuleEditor } from '../features/deduplication/DedupeRuleEditor';
import { AppearanceControl } from '../features/settings/AppearanceControl';
import { KeyboardShortcutsSetting } from '../features/settings/KeyboardShortcutsSetting';
import { SettingSwitch } from '../features/settings/SettingSwitch';
import { SETTINGS_FOCUS_TARGETS } from '../features/settings/settingsFocusTargets';
import { createSettingsService, type SettingsService } from '../features/settings/settingsService';
import { useSettings } from '../features/settings/useSettings';

interface SettingsPageProps {
  activeWindowsService?: ActiveWindowsDataSource | undefined;
  service?: SettingsService | undefined;
}

export function SettingsPage({
  activeWindowsService: providedActiveWindowsService,
  service: providedService,
}: SettingsPageProps) {
  const activeWindowsService = useMemo(
    () => providedActiveWindowsService ?? createChromeActiveWindowsService(),
    [providedActiveWindowsService],
  );
  const service = useMemo(() => providedService ?? createSettingsService(), [providedService]);
  const {
    errorMessage: previewErrorMessage,
    snapshot,
    status: previewStatus,
  } = useActiveWindows(activeWindowsService);
  const {
    errorMessage,
    isLoading,
    savingSettings,
    setAdvancedDuplicateMatchingEnabled,
    setColorMode,
    setDeduplicationRules,
    setShowTabUrls,
    settings,
  } = useSettings(service);
  const preview = useMemo(() => {
    const currentWindow =
      snapshot?.windows.find((window) => window.isCurrent) ??
      snapshot?.windows.find((window) => window.focused);
    return {
      errorMessage: previewErrorMessage,
      isLoading: previewStatus === 'loading',
      keeperPreference: {
        tabId: currentWindow?.tabs.find((tab) => tab.active)?.id,
        windowId: currentWindow?.id,
      },
      tabs:
        snapshot?.windows.flatMap((window) =>
          window.tabs.map((tab) => ({
            agentAssociated: tab.agentAssociated,
            agentDedupeProtected: tab.agentDedupeProtected,
            id: tab.id,
            index: tab.index,
            pinned: tab.pinned,
            title: tab.title,
            url: tab.url,
            windowId: tab.windowId,
            windowLabel: window.label,
          })),
        ) ?? [],
    };
  }, [previewErrorMessage, previewStatus, snapshot]);

  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <h2 id="settings-heading" className="sr-only">
        Weaver settings
      </h2>

      <div className="settings-layout">
        <section
          className="settings-group appearance-settings-group"
          id={SETTINGS_FOCUS_TARGETS.appearance}
          aria-labelledby="settings-appearance-heading"
          aria-describedby="settings-appearance-description"
          tabIndex={-1}
        >
          <div>
            <h3 id="settings-appearance-heading">Appearance</h3>
            <p id="settings-appearance-description">
              Choose a color scheme. System default follows your device appearance.
            </p>
          </div>
          <AppearanceControl
            disabled={isLoading || savingSettings.has('colorMode')}
            onChange={(colorMode) => void setColorMode(colorMode)}
            presentation="segmented"
            value={settings.colorMode}
          />
        </section>

        <KeyboardShortcutsSetting />

        <section
          className="settings-group"
          id={SETTINGS_FOCUS_TARGETS.showTabUrls}
          aria-labelledby="settings-show-tab-urls-heading"
          aria-describedby="settings-show-tab-urls-description"
          tabIndex={-1}
        >
          <div>
            <h3 id="settings-show-tab-urls-heading">Show tab URLs</h3>
            <p id="settings-show-tab-urls-description">
              Show URLs below tab titles in Active Windows. Turn this off for denser cards.
            </p>
          </div>
          <SettingSwitch
            checked={settings.showTabUrls}
            disabled={isLoading || savingSettings.has('showTabUrls')}
            label="Show tab URLs"
            onChange={(checked) => void setShowTabUrls(checked)}
          />
        </section>
      </div>

      {errorMessage ? (
        <div className="settings-error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled={settings.advancedDuplicateMatchingEnabled}
        advancedDuplicateMatchingToggleDisabled={
          isLoading || savingSettings.has('advancedDuplicateMatchingEnabled')
        }
        disabled={isLoading || savingSettings.has('deduplicationRules')}
        focusTargetsReady={!isLoading}
        onAdvancedDuplicateMatchingEnabledChange={setAdvancedDuplicateMatchingEnabled}
        onSave={setDeduplicationRules}
        preview={preview}
        rules={settings.deduplicationRules}
      />
    </section>
  );
}
