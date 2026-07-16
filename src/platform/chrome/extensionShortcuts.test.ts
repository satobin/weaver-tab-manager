import { describe, expect, it, vi } from 'vitest';

import {
  formatCommandShortcut,
  getCommandShortcutState,
  getShortcutSettingsUrls,
  getSuggestedOpenManagerShortcut,
  openExtensionShortcutSettings,
  type ShortcutSettingsTabsApi,
} from './extensionShortcuts';

function createTabsApi() {
  const create = vi.fn<(_properties: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>>(
    () => Promise.resolve({ id: 91 } as chrome.tabs.Tab),
  );
  return { api: { create } as ShortcutSettingsTabsApi, create };
}

describe('extension shortcuts', () => {
  it('formats shortcuts for display and chooses the platform suggestion', () => {
    expect(formatCommandShortcut('Command+Shift+1')).toBe('⌘⇧1');
    expect(formatCommandShortcut('Ctrl+Shift+1')).toBe('Ctrl+Shift+1');
    expect(getSuggestedOpenManagerShortcut('MacIntel')).toBe('⌘⇧1');
    expect(getSuggestedOpenManagerShortcut('Win32')).toBe('Ctrl+Shift+1');
  });

  it('distinguishes assigned, unassigned, and missing commands', () => {
    const commands = [
      { name: '_execute_action', shortcut: '' },
      { name: 'open-manager', shortcut: 'Command+Shift+1' },
    ];

    expect(getCommandShortcutState(commands, 'open-manager')).toEqual({
      display: '⌘⇧1',
      status: 'assigned',
    });
    expect(getCommandShortcutState(commands, '_execute_action')).toEqual({
      status: 'unassigned',
    });
    expect(getCommandShortcutState(commands, 'missing-command')).toEqual({ status: 'missing' });
  });

  it('uses the native Edge page before the Chromium fallback', () => {
    expect(getShortcutSettingsUrls('Chrome/138.0.0.0 Edg/138.0.0.0')).toEqual([
      'edge://extensions/shortcuts',
      'chrome://extensions/shortcuts',
    ]);
    expect(getShortcutSettingsUrls('Chrome/138.0.0.0')).toEqual(['chrome://extensions/shortcuts']);
  });

  it('falls back when Edge rejects its native shortcut page', async () => {
    const { api, create } = createTabsApi();
    create.mockRejectedValueOnce(new Error('URL blocked'));

    await expect(
      openExtensionShortcutSettings(api, 'Chrome/138.0.0.0 Edg/138.0.0.0'),
    ).resolves.toEqual({ ok: true, openedUrl: 'chrome://extensions/shortcuts' });
    expect(create).toHaveBeenNthCalledWith(1, { url: 'edge://extensions/shortcuts' });
    expect(create).toHaveBeenNthCalledWith(2, { url: 'chrome://extensions/shortcuts' });
  });

  it('returns a browser-specific manual address when navigation fails', async () => {
    const { api, create } = createTabsApi();
    const failure = new Error('URL blocked');
    create.mockRejectedValue(failure);

    await expect(openExtensionShortcutSettings(api, 'Chrome/138.0.0.0')).resolves.toEqual({
      cause: failure,
      manualUrl: 'chrome://extensions/shortcuts',
      ok: false,
    });
  });
});
