import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ActiveWindowsDataSource } from '../features/active-windows/useActiveWindows';
import { type DedupeRule } from '../features/deduplication/deduplication';
import {
  type ColorMode,
  DEFAULT_SETTINGS,
  type SettingsService,
} from '../features/settings/settingsService';
import {
  createActiveWindowsSnapshot,
  createManagedTab,
  createManagedWindow,
} from '../test/activeWindowsFixtures';
import { SettingsPage } from './SettingsPage';

function createActiveWindowsDataSource(agentAssociatedTabId?: number): ActiveWindowsDataSource {
  return {
    loadSnapshot: vi.fn(() =>
      Promise.resolve(
        createActiveWindowsSnapshot({
          windows: [
            createManagedWindow({
              tabs: [
                createManagedTab({
                  active: true,
                  agentAssociated: agentAssociatedTabId === 101,
                  agentDedupeProtected: agentAssociatedTabId === 101,
                  id: 101,
                  title: 'Quarterly plan',
                  url: 'https://docs.google.com/document/d/doc-id/edit?tab=t.0',
                }),
              ],
            }),
            createManagedWindow({
              focused: false,
              id: 2,
              isCurrent: false,
              label: 'Window 1',
              tabs: [
                createManagedTab({
                  active: true,
                  agentAssociated: agentAssociatedTabId === 201,
                  agentDedupeProtected: agentAssociatedTabId === 201,
                  id: 201,
                  title: 'Quarterly plan copy',
                  url: 'https://docs.google.com/document/d/doc-id/preview#heading=one',
                  windowId: 2,
                }),
              ],
            }),
          ],
        }),
      ),
    ),
    subscribe: vi.fn(() => () => undefined),
  };
}

function createService(advancedDuplicateMatchingEnabled = true): SettingsService {
  const createSettings = (overrides: Partial<typeof DEFAULT_SETTINGS> = {}) => ({
    ...DEFAULT_SETTINGS,
    advancedDuplicateMatchingEnabled,
    ...overrides,
  });
  return {
    load: vi.fn(() => Promise.resolve(createSettings())),
    setAdvancedDuplicateMatchingEnabled: vi.fn((enabled: boolean) =>
      Promise.resolve(createSettings({ advancedDuplicateMatchingEnabled: enabled })),
    ),
    setColorMode: vi.fn((colorMode: ColorMode) => Promise.resolve(createSettings({ colorMode }))),
    setDeduplicationRules: vi.fn((rules: readonly DedupeRule[]) =>
      Promise.resolve(createSettings({ deduplicationRules: [...rules] })),
    ),
    setShowTabUrls: vi.fn((value: boolean) =>
      Promise.resolve(createSettings({ showTabUrls: value })),
    ),
    subscribe: vi.fn(() => () => undefined),
  };
}

describe('SettingsPage', () => {
  const getCommands = vi.fn(() =>
    Promise.resolve([
      { name: '_execute_action', shortcut: '' },
      { name: 'open-manager', shortcut: 'Ctrl+Shift+1' },
    ]),
  );
  const createTab = vi.fn<(_properties: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>>(
    () => Promise.resolve({ id: 301 } as chrome.tabs.Tab),
  );
  const closeWindow = vi.fn();
  const defaultUserAgent = navigator.userAgent;

  beforeEach(() => {
    getCommands.mockReset();
    getCommands.mockResolvedValue([
      { name: '_execute_action', shortcut: '' },
      { name: 'open-manager', shortcut: 'Ctrl+Shift+1' },
    ]);
    createTab.mockReset();
    createTab.mockResolvedValue({ id: 301 } as chrome.tabs.Tab);
    closeWindow.mockReset();
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: defaultUserAgent,
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        commands: { getAll: getCommands },
        tabs: { create: createTab },
      },
    });
    Object.defineProperty(window, 'close', {
      configurable: true,
      value: closeWindow,
    });
  });

  it('loads and updates the appearance setting', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );
    const selector = screen.getByRole('radiogroup', { name: 'Color scheme' });
    const system = within(selector).getByRole('radio', { name: 'System' });
    const dark = within(selector).getByRole('radio', { name: 'Dark' });

    await waitFor(() => expect(system).toBeEnabled());
    expect(system).toBeChecked();
    await user.click(system);
    expect(service.setColorMode).not.toHaveBeenCalled();

    await user.click(dark);

    expect(service.setColorMode).toHaveBeenCalledWith('dark');
    await waitFor(() => expect(dark).toBeChecked());
  });

  it('lists general settings together with URL visibility below keyboard shortcuts', async () => {
    const { container } = render(
      <SettingsPage
        activeWindowsService={createActiveWindowsDataSource()}
        service={createService()}
      />,
    );

    const appearanceGroup = screen
      .getByRole('heading', { name: 'Appearance', level: 3 })
      .closest('.settings-group');
    const shortcutGroup = screen
      .getByRole('heading', { name: 'Keyboard shortcuts', level: 3 })
      .closest('.settings-group');
    const showUrlsGroup = screen
      .getByRole('heading', { name: 'Show tab URLs', level: 3 })
      .closest('.settings-group');
    const generalSettingsCard = container.querySelector('.settings-layout');

    await waitFor(() => expect(screen.getByRole('radio', { name: 'System' })).toBeEnabled());
    expect(container.querySelectorAll('.settings-layout')).toHaveLength(1);
    expect(Array.from(generalSettingsCard?.children ?? [])).toEqual([
      appearanceGroup,
      shortcutGroup,
      showUrlsGroup,
    ]);
    expect(
      within(showUrlsGroup as HTMLElement).getByText(
        'Show URLs below tab titles in Active Windows. Turn this off for denser cards.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Tab behavior' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('switch', { name: 'Preserve groups when sorting' }),
    ).not.toBeInTheDocument();
  });

  it('lists live keyboard shortcuts as sub-rows below their heading and description', async () => {
    render(
      <SettingsPage
        activeWindowsService={createActiveWindowsDataSource()}
        service={createService()}
      />,
    );

    const shortcutHeading = screen.getByRole('heading', { name: 'Keyboard shortcuts', level: 3 });
    const shortcutGroup = shortcutHeading.closest('.settings-group');
    const shortcutHeader = shortcutHeading.closest('.keyboard-shortcuts-header');
    const shortcutList = shortcutGroup?.querySelector('.keyboard-shortcuts-list');
    const rows = Array.from(shortcutList?.children ?? []);

    expect(shortcutGroup).not.toBeNull();
    expect(shortcutHeader?.nextElementSibling).toBe(shortcutList);
    expect(shortcutList?.parentElement).toBe(shortcutGroup);
    expect(
      within(shortcutHeader as HTMLElement).getByRole('button', { name: 'Edit shortcuts' }),
    ).toBeVisible();
    expect(shortcutList).toHaveAttribute('aria-live', 'polite');
    expect(rows).toHaveLength(2);

    const activateShortcut = within(rows[0] as HTMLElement);
    expect(activateShortcut.getByText('Activate the extension')).toBeVisible();
    expect(activateShortcut.getByText('Opens the Weaver popup.')).toBeVisible();
    expect(await activateShortcut.findByText('Not assigned')).toBeVisible();
    expect(activateShortcut.queryByRole('button')).not.toBeInTheDocument();

    const managerShortcut = within(rows[1] as HTMLElement);
    expect(managerShortcut.getByText('Open Window Manager')).toBeVisible();
    expect(managerShortcut.getByText('Opens the full window and tab manager.')).toBeVisible();
    expect(managerShortcut.getByText('Ctrl+Shift+1')).toBeVisible();
    expect(managerShortcut.getByText('Ctrl+Shift+1').tagName).toBe('KBD');
    expect(managerShortcut.queryByRole('button')).not.toBeInTheDocument();
  });

  it('opens browser shortcut settings without closing Weaver', async () => {
    const user = userEvent.setup();
    render(
      <SettingsPage
        activeWindowsService={createActiveWindowsDataSource()}
        service={createService()}
      />,
    );

    const editButton = screen.getByRole('button', { name: 'Edit shortcuts' });
    expect(editButton).toHaveAccessibleDescription(
      'Opens your browser’s extension shortcut settings in a new tab.',
    );
    await user.click(editButton);

    expect(createTab).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts' });
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it('refreshes displayed shortcuts after returning from the browser settings tab', async () => {
    getCommands
      .mockResolvedValueOnce([
        { name: '_execute_action', shortcut: '' },
        { name: 'open-manager', shortcut: 'Ctrl+Shift+1' },
      ])
      .mockResolvedValueOnce([
        { name: '_execute_action', shortcut: 'Ctrl+Shift+2' },
        { name: 'open-manager', shortcut: 'Ctrl+Shift+9' },
      ]);
    render(
      <SettingsPage
        activeWindowsService={createActiveWindowsDataSource()}
        service={createService()}
      />,
    );

    expect(await screen.findByText('Ctrl+Shift+1')).toBeVisible();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });

    expect(await screen.findByText('Ctrl+Shift+2')).toBeVisible();
    expect(await screen.findByText('Ctrl+Shift+9')).toBeVisible();
  });

  it('shows the manual shortcut address if browser navigation is blocked', async () => {
    const user = userEvent.setup();
    createTab.mockRejectedValue(new Error('URL blocked'));
    render(
      <SettingsPage
        activeWindowsService={createActiveWindowsDataSource()}
        service={createService()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit shortcuts' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t open shortcut settings. Enter chrome://extensions/shortcuts in the address bar.',
    );
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it('marks shortcuts unavailable and disables editing when browser APIs are missing', async () => {
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { commands: {}, tabs: {} },
    });
    render(
      <SettingsPage
        activeWindowsService={createActiveWindowsDataSource()}
        service={createService()}
      />,
    );

    expect(await screen.findAllByText('Unavailable')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Edit shortcuts' })).toBeDisabled();
  });

  it('loads and updates the tab URL visibility preference', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );
    const toggle = screen.getByRole('switch', { name: 'Show tab URLs' });

    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    expect(service.setShowTabUrls).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('keeps duplicate-rule fields stable while saving an unrelated preference', async () => {
    const user = userEvent.setup();
    const service = createService();
    let finishSave: (() => void) | undefined;
    vi.mocked(service.setShowTabUrls).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = () => resolve({ ...DEFAULT_SETTINGS, showTabUrls: true });
        }),
    );
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );
    const toggle = screen.getByRole('switch', { name: 'Show tab URLs' });
    const googlePreset = await screen.findByRole('switch', {
      name: 'Google Docs, Sheets & Slides preset',
    });

    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);
    await waitFor(() => expect(service.setShowTabUrls).toHaveBeenCalledWith(true));

    expect(toggle).toBeDisabled();
    expect(googlePreset).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add custom rule' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'System' })).toBeEnabled();

    await act(async () => {
      finishSave?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toBeChecked();
  });

  it('keeps the previous value and reports a failed save', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.setShowTabUrls).mockRejectedValue(new Error('Storage full'));
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );
    const toggle = screen.getByRole('switch', { name: 'Show tab URLs' });

    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);

    expect(await screen.findByRole('alert')).toHaveTextContent('Storage full');
    expect(toggle).not.toBeChecked();
  });

  it('persists a valid rule draft through the shared settings service', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );
    await user.click(await screen.findByRole('button', { name: 'Add custom rule' }));
    const firstPattern = screen.getByRole('textbox', { name: 'URL pattern' });

    await user.type(firstPattern, 'custom.example.com/*');
    const customRules = screen.getByRole('region', { name: 'Custom rules' });
    await user.click(within(customRules).getByRole('button', { name: 'Save custom rules' }));

    await waitFor(() => expect(service.setDeduplicationRules).toHaveBeenCalledTimes(1));
    expect(service.setDeduplicationRules).toHaveBeenCalledWith([
      ...DEFAULT_SETTINGS.deduplicationRules,
      expect.objectContaining({
        glob: 'custom.example.com/*',
      }),
    ]);
  });

  it('saves presets immediately without consuming an unsaved custom draft', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Add custom rule' }));
    const pattern = screen.getByRole('textbox', { name: 'URL pattern' });
    await user.type(pattern, 'draft.example.com/*');
    await user.click(screen.getByRole('switch', { name: 'Google Docs, Sheets & Slides preset' }));

    await waitFor(() => expect(service.setDeduplicationRules).toHaveBeenCalledTimes(1));
    expect(pattern).toHaveValue('draft.example.com/*');
    expect(screen.getByText('Unsaved custom rule changes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save custom rules' }));
    await waitFor(() => expect(service.setDeduplicationRules).toHaveBeenCalledTimes(2));
    const savedRules = vi.mocked(service.setDeduplicationRules).mock.calls[1]?.[0];
    expect(savedRules?.slice(0, 3).every((rule) => rule.enabled)).toBe(true);
    expect(savedRules).toContainEqual(expect.objectContaining({ glob: 'draft.example.com/*' }));
  });

  it('starts with advanced matching off and expands it without disabling exact matching', async () => {
    const user = userEvent.setup();
    const service = createService(false);
    render(
      <SettingsPage activeWindowsService={createActiveWindowsDataSource()} service={service} />,
    );
    const toggle = await screen.findByRole('switch', { name: 'Advanced duplicate matching' });

    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/Exact full-URL duplicates always match/)).toBeInTheDocument();
    expect(screen.queryByText('Google Docs, Sheets & Slides')).not.toBeInTheDocument();
    await user.click(toggle);

    expect(service.setAdvancedDuplicateMatchingEnabled).toHaveBeenCalledWith(true);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(screen.getByText('Google Docs, Sheets & Slides')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add custom rule' })).toBeInTheDocument();
  });

  it('previews the keeper and closures from open tabs using the current rules', async () => {
    const user = userEvent.setup();
    render(
      <SettingsPage
        activeWindowsService={createActiveWindowsDataSource()}
        service={createService()}
      />,
    );

    expect(await screen.findByText('Google Docs, Sheets & Slides')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Google Docs, Sheets & Slides preset' }));
    await user.click(screen.getByRole('button', { name: /Preview matches/ }));

    const preview = screen.getByRole('region', { name: 'Duplicate match preview' });

    expect(within(preview).getByText('docs.google.com/document/d/doc-id')).toBeInTheDocument();
    expect(within(preview).getByText('Quarterly plan')).toBeInTheDocument();
    expect(within(preview).getByText(/Also closes: Quarterly plan copy/)).toBeInTheDocument();
    expect(within(preview).getByText('Keep open')).toBeInTheDocument();
    expect(within(preview).getByText('Close 1')).toBeInTheDocument();
    expect(within(preview).getByText(/1 match .* 1 tab would close/)).toBeInTheDocument();
  });

  it('shows an agent-associated duplicate as the protected keeper', async () => {
    const user = userEvent.setup();
    render(
      <SettingsPage
        activeWindowsService={createActiveWindowsDataSource(201)}
        service={createService()}
      />,
    );

    expect(await screen.findByText('Google Docs, Sheets & Slides')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Google Docs, Sheets & Slides preset' }));
    const previewButton = screen.getByRole('button', { name: /Preview matches/ });

    expect(previewButton).toHaveTextContent('1 tab would close');
    await user.click(previewButton);
    const preview = screen.getByRole('region', { name: 'Duplicate match preview' });
    expect(within(preview).getByText('Quarterly plan copy')).toBeInTheDocument();
    expect(within(preview).getByText(/Also closes: Quarterly plan$/)).toBeInTheDocument();
    expect(within(preview).getByText('Keep protected')).toBeInTheDocument();
  });
});
