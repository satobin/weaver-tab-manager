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
    setPreserveGroupsDuringSort,
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
            id: tab.id,
            index: tab.index,
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

      <div className="settings-layout appearance-settings-layout">
        <div className="settings-group appearance-settings-group">
          <div>
            <h3>Appearance</h3>
            <p>Choose a color scheme. System default follows your device appearance.</p>
          </div>
          <AppearanceControl
            disabled={isLoading || savingSettings.has('colorMode')}
            onChange={(colorMode) => void setColorMode(colorMode)}
            presentation="segmented"
            value={settings.colorMode}
          />
        </div>

        <KeyboardShortcutsSetting />
      </div>

      <section
        className="settings-rule-section behavior-settings-section"
        aria-labelledby="tab-behavior-heading"
      >
        <header className="settings-rule-heading behavior-settings-heading">
          <div>
            <h3 id="tab-behavior-heading">Tab behavior</h3>
            <p>Choose how tabs appear and how browser tab groups behave when sorting.</p>
          </div>
        </header>

        <div className="behavior-settings-list">
          <div className="settings-group behavior-settings-row">
            <div>
              <h4>Show tab URLs</h4>
              <p>Show URLs below tab titles in Active Windows. Turn this off for denser cards.</p>
            </div>
            <SettingSwitch
              checked={settings.showTabUrls}
              disabled={isLoading || savingSettings.has('showTabUrls')}
              label="Show tab URLs"
              onChange={(checked) => void setShowTabUrls(checked)}
            />
          </div>

          <div className="settings-group behavior-settings-row">
            <div>
              <h4>Preserve groups when sorting</h4>
              <p>
                Keep each browser tab group together. Turning this off removes group membership
                during a sort.
              </p>
            </div>
            <SettingSwitch
              checked={settings.preserveGroupsDuringSort}
              disabled={isLoading || savingSettings.has('preserveGroupsDuringSort')}
              label="Preserve groups when sorting"
              onChange={(checked) => void setPreserveGroupsDuringSort(checked)}
            />
          </div>
        </div>
      </section>

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
        onAdvancedDuplicateMatchingEnabledChange={setAdvancedDuplicateMatchingEnabled}
        onSave={setDeduplicationRules}
        preview={preview}
        rules={settings.deduplicationRules}
      />
    </section>
  );
}
