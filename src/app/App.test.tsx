import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { type ActiveWindowsService } from '../features/active-windows/chromeActiveWindowsService';
import { type SavedWindow } from '../features/saved-windows/savedWindowModel';
import { type SavedWindowsService } from '../features/saved-windows/savedWindowsService';
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
import { App } from './App';
import { APP_ROUTES } from './routes';

function createService(windowCount = 1): ActiveWindowsService {
  const snapshot =
    windowCount === 1
      ? createActiveWindowsSnapshot()
      : createActiveWindowsSnapshot({
          windows: Array.from({ length: windowCount }, (_, index) =>
            createManagedWindow({
              focused: index === 0,
              id: index + 1,
              isCurrent: index === 0,
              label: `Window ${index + 1}`,
              tabs: [
                createManagedTab({
                  active: true,
                  id: 101 + index,
                  windowId: index + 1,
                }),
              ],
            }),
          ),
        });
  const windowCountListeners = new Set<() => void>();
  return {
    closeDuplicateTabs: () =>
      Promise.resolve({
        closedTabIds: [],
        closedTabs: [],
        failures: [],
        skippedAgentAssociatedTabIds: [],
        skippedChangedTabIds: [],
        skippedPinnedTabIds: [],
      }),
    closeTabs: () => Promise.resolve({ closedTabIds: [], failures: [] }),
    closeWindow: () => Promise.resolve(),
    focusTab: () => Promise.resolve(),
    focusWindow: () => Promise.resolve(),
    loadSnapshot: vi.fn(() => Promise.resolve(snapshot)),
    loadWindowCount: vi.fn(() => Promise.resolve(windowCount)),
    mergeWindows: () =>
      Promise.resolve({
        destinationWindowId: 1,
        failures: [],
        mergedSourceWindowIds: [],
        movedTabIds: [],
        warnings: [],
      }),
    moveTab: (tabId, destinationWindowId, destinationIndex) =>
      Promise.resolve({
        destinationIndex,
        destinationWindowId,
        movedTabId: tabId,
        warnings: [],
      }),
    moveTabGroup: (_groupId, destinationWindowId) =>
      Promise.resolve({
        destinationWindowId,
        failures: [],
        movedTabIds: [],
        warnings: [],
      }),
    moveTabsToNewWindow: () =>
      Promise.resolve({
        destinationWindowId: null,
        failures: [],
        movedTabIds: [],
        warnings: [],
      }),
    pinTab: () => Promise.resolve(),
    restoreTabs: (tabs) =>
      Promise.resolve({
        failures: [],
        restoredOriginalTabIds: tabs.map((tab) => tab.originalTabId),
        restoredTabIds: tabs.map((_, index) => 901 + index),
        warnings: [],
      }),
    sortAllWindows: () => Promise.resolve({ failures: [], sortedWindowIds: [], warnings: [] }),
    sortWindow: () => Promise.resolve({ failures: [], sortedWindowIds: [], warnings: [] }),
    subscribe: () => () => undefined,
    subscribeWindowCount: vi.fn((listener: () => void) => {
      windowCountListeners.add(listener);
      return () => windowCountListeners.delete(listener);
    }),
    suspendTabs: () => Promise.resolve({ affectedTabIds: [], failures: [] }),
    unpinTab: () => Promise.resolve(),
    unsuspendTabs: () => Promise.resolve({ affectedTabIds: [], failures: [] }),
  };
}

function createSavedWindow(id: string): SavedWindow {
  return {
    createdAt: '2026-07-12T00:00:00.000Z',
    groups: [],
    id,
    name: `Saved ${id}`,
    tabs: [
      {
        active: true,
        order: 0,
        pinned: false,
        title: 'Saved tab',
        url: 'https://example.com/',
      },
    ],
    updatedAt: '2026-07-12T00:00:00.000Z',
  };
}

function createSavedService(windowCount: number): SavedWindowsService {
  const windows = Array.from({ length: windowCount }, (_, index) =>
    createSavedWindow(`saved-${index + 1}`),
  );
  const countListeners = new Set<() => void>();
  return {
    deduplicateTabs: vi.fn(() =>
      Promise.resolve({
        duplicateGroupCount: 0,
        removedTabCount: 0,
        removedWindowIds: [],
        undo: null,
        updatedWindowIds: [],
      }),
    ),
    deleteWindow: vi.fn(() => Promise.resolve()),
    keepWindow: vi.fn((savedWindow: SavedWindow) => Promise.resolve(savedWindow)),
    load: vi.fn(() => Promise.resolve(windows)),
    loadCount: vi.fn(() => Promise.resolve(windows.length)),
    mergeWindows: vi.fn(() => Promise.reject(new Error('Not used'))),
    moveSelectedTabsToNewWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    openTab: vi.fn(() => Promise.resolve(42)),
    removeSelectedTabs: vi.fn(() => Promise.reject(new Error('Not used'))),
    renameWindow: vi.fn((_savedWindowId: string, name: string) =>
      Promise.resolve({ ...windows[0]!, name }),
    ),
    restoreWindow: vi.fn(() =>
      Promise.resolve({
        destinationWindowId: 9,
        failures: [],
        restoredTabCount: 1,
        savedWindowRemoved: true,
        warnings: [],
      }),
    ),
    saveWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    sortAllWindows: vi.fn(() => Promise.resolve({ sortedWindowIds: [], undo: null })),
    sortWindow: vi.fn(() => Promise.resolve({ sortedWindowIds: [], undo: null })),
    subscribe: vi.fn(() => () => undefined),
    subscribeCount: vi.fn((listener: () => void) => {
      countListeners.add(listener);
      return () => countListeners.delete(listener);
    }),
    undoMutation: vi.fn(() => Promise.resolve()),
  };
}

function createSettingsService() {
  let settings = DEFAULT_SETTINGS;
  const listeners = new Set<(nextSettings: typeof settings) => void>();
  const notify = () => listeners.forEach((listener) => listener(settings));
  const setColorMode = vi.fn((colorMode: ColorMode) => {
    settings = { ...settings, colorMode };
    notify();
    return Promise.resolve(settings);
  });
  const service: SettingsService = {
    load: () => Promise.resolve(settings),
    setAdvancedDuplicateMatchingEnabled: (advancedDuplicateMatchingEnabled) => {
      settings = { ...settings, advancedDuplicateMatchingEnabled };
      notify();
      return Promise.resolve(settings);
    },
    setColorMode,
    setDeduplicationRules: (deduplicationRules) => {
      settings = { ...settings, deduplicationRules: [...deduplicationRules] };
      notify();
      return Promise.resolve(settings);
    },
    setShowTabUrls: (showTabUrls) => {
      settings = { ...settings, showTabUrls };
      notify();
      return Promise.resolve(settings);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { service, setColorMode };
}

describe('App', () => {
  it('renders active windows by default', async () => {
    render(<App activeWindowsService={createService()} />);

    expect(
      await screen.findByRole('heading', { name: 'Active Windows', level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Window 1' })).toBeInTheDocument();
  });

  it('keeps active-window totals in the shared top bar without a manual refresh control', async () => {
    render(<App activeWindowsService={createService()} />);
    const heading = await screen.findByRole('heading', { name: 'Active Windows', level: 1 });
    const topbar = heading.closest('header') as HTMLElement;

    expect(await within(topbar).findByText('1 window · 1 tab')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh windows' })).not.toBeInTheDocument();
  });

  it('shows active and saved window counts in the sidebar', async () => {
    window.location.hash = APP_ROUTES.about;
    const activeWindowsService = createService(2);
    const savedWindowsService = createSavedService(3);
    render(
      <App activeWindowsService={activeWindowsService} savedWindowsService={savedWindowsService} />,
    );

    const activeWindowsLink = await screen.findByRole('link', { name: 'Active Windows: 2' });
    const savedWindowsLink = await screen.findByRole('link', { name: 'Saved Windows: 3' });
    expect(within(activeWindowsLink).getByText('2')).toHaveClass('nav-count');
    expect(within(savedWindowsLink).getByText('3')).toHaveClass('nav-count');
    expect(activeWindowsService.loadWindowCount).toHaveBeenCalledOnce();
    expect(activeWindowsService.loadSnapshot).not.toHaveBeenCalled();
    expect(savedWindowsService.loadCount).toHaveBeenCalledOnce();
    expect(savedWindowsService.load).not.toHaveBeenCalled();
  });

  it('loads full search sources only when the command palette opens', async () => {
    window.location.hash = APP_ROUTES.about;
    const activeWindowsService = createService(2);
    const savedWindowsService = createSavedService(3);
    render(
      <App activeWindowsService={activeWindowsService} savedWindowsService={savedWindowsService} />,
    );

    const trigger = await screen.findByRole('button', { name: 'Search Weaver' });
    expect(trigger).toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K');
    expect(activeWindowsService.loadSnapshot).not.toHaveBeenCalled();
    expect(savedWindowsService.load).not.toHaveBeenCalled();

    trigger.focus();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });

    const dialog = await screen.findByRole('dialog', { name: 'Search Weaver' });
    expect(within(dialog).getByRole('combobox', { name: 'Search Weaver' })).toHaveFocus();
    expect(activeWindowsService.loadSnapshot).toHaveBeenCalledOnce();
    expect(savedWindowsService.load).toHaveBeenCalledOnce();

    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog', { name: 'Search Weaver' })).not.toBeInTheDocument();
  });

  it('moves focus to safe page targets for command-palette navigation', async () => {
    window.location.hash = APP_ROUTES.windows;
    const user = userEvent.setup();
    render(
      <App activeWindowsService={createService()} savedWindowsService={createSavedService(1)} />,
    );
    await screen.findByRole('heading', { name: 'Active Windows', level: 1 });

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Search Weaver' });
    await user.click(within(dialog).getByRole('option', { name: /^Merge windows\./u }));

    const mergeActions = await screen.findByRole('group', { name: 'Merge windows' });
    await waitFor(() => expect(mergeActions).toHaveFocus());
    expect(window.location.hash).toBe(APP_ROUTES.windows);

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    const reopenedDialog = await screen.findByRole('dialog', { name: 'Search Weaver' });
    await user.click(within(reopenedDialog).getByRole('option', { name: /^About Weaver\./u }));

    const aboutHeading = await screen.findByRole('heading', { name: 'About Weaver', level: 1 });
    await waitFor(() => expect(aboutHeading).toHaveFocus());
    expect(window.location.hash).toBe(APP_ROUTES.about);
  });

  it('uses the empty-query Saved Windows shortcut and focuses its page title', async () => {
    window.location.hash = APP_ROUTES.windows;
    render(
      <App activeWindowsService={createService()} savedWindowsService={createSavedService(1)} />,
    );
    await screen.findByRole('heading', { name: 'Active Windows', level: 1 });

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Search Weaver' });
    const input = within(dialog).getByRole('combobox', { name: 'Search Weaver' });
    expect(input).toHaveValue('');
    expect(within(dialog).getByRole('option', { name: /^Saved Windows\./u })).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+6 Control+6',
    );

    fireEvent.keyDown(input, { key: '6', metaKey: true });

    const savedWindowsHeading = await screen.findByRole('heading', {
      name: 'Saved Windows',
      level: 1,
    });
    expect(window.location.hash).toBe(APP_ROUTES.savedWindows);
    expect(savedWindowsHeading.tagName).toBe('H1');
    expect(savedWindowsHeading).toHaveAttribute('tabindex', '-1');
    expect(savedWindowsHeading).toHaveClass('programmatic-focus-target');
    await waitFor(() => expect(savedWindowsHeading).toHaveFocus());
  });

  it('closes the command palette without clearing Active Windows selection', async () => {
    window.location.hash = APP_ROUTES.windows;
    const user = userEvent.setup();
    render(
      <App activeWindowsService={createService()} savedWindowsService={createSavedService(1)} />,
    );

    const selectTab = await screen.findByRole('checkbox', { name: 'Select Example tab' });
    await user.click(selectTab);
    expect(selectTab).toBeChecked();

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await screen.findByRole('dialog', { name: 'Search Weaver' });
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Search Weaver' })).not.toBeInTheDocument();
    expect(selectTab).toBeChecked();
  });

  it('uses the Saved Windows page load for its sidebar count', async () => {
    window.location.hash = APP_ROUTES.savedWindows;
    const savedWindowsService = createSavedService(2);
    render(
      <App activeWindowsService={createService()} savedWindowsService={savedWindowsService} />,
    );

    await screen.findByRole('link', { name: 'Saved Windows: 2' });
    expect(savedWindowsService.load).toHaveBeenCalledOnce();
    expect(savedWindowsService.subscribe).toHaveBeenCalledOnce();
    expect(savedWindowsService.loadCount).not.toHaveBeenCalled();
    expect(savedWindowsService.subscribeCount).not.toHaveBeenCalled();
  });

  it('hands the saved-window count between the page and its lightweight navigation source', async () => {
    window.location.hash = APP_ROUTES.savedWindows;
    const savedWindowsService = createSavedService(2);
    const countListeners = new Set<() => void>();
    let navigationCount = 3;
    savedWindowsService.loadCount = vi.fn(() => Promise.resolve(navigationCount));
    savedWindowsService.subscribeCount = vi.fn((listener: () => void) => {
      countListeners.add(listener);
      return () => countListeners.delete(listener);
    });
    render(
      <App activeWindowsService={createService()} savedWindowsService={savedWindowsService} />,
    );

    await screen.findByRole('link', { name: 'Saved Windows: 2' });
    expect(countListeners.size).toBe(0);

    window.location.hash = APP_ROUTES.about;
    fireEvent(window, new HashChangeEvent('hashchange'));
    await screen.findByRole('link', { name: 'Saved Windows: 3' });
    expect(countListeners.size).toBe(1);

    navigationCount = 4;
    act(() => countListeners.forEach((listener) => listener()));
    await screen.findByRole('link', { name: 'Saved Windows: 4' });

    window.location.hash = APP_ROUTES.savedWindows;
    fireEvent(window, new HashChangeEvent('hashchange'));
    await screen.findByRole('link', { name: 'Saved Windows: 2' });
    expect(countListeners.size).toBe(0);
    expect(savedWindowsService.load).toHaveBeenCalledTimes(2);

    navigationCount = 6;
    let resolveNavigationCount: ((count: number) => void) | undefined;
    vi.mocked(savedWindowsService.loadCount).mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolveNavigationCount = resolve;
        }),
    );
    window.location.hash = APP_ROUTES.about;
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(screen.getByRole('link', { name: 'Saved Windows' })).toBeInTheDocument();
    await waitFor(() => expect(savedWindowsService.loadCount).toHaveBeenCalledTimes(3));
    act(() => resolveNavigationCount?.(6));
    await screen.findByRole('link', { name: 'Saved Windows: 6' });
  });

  it('omits the saved-window badge when there are no saved windows', async () => {
    window.location.hash = APP_ROUTES.about;
    render(
      <App activeWindowsService={createService(2)} savedWindowsService={createSavedService(0)} />,
    );

    const activeWindowsLink = await screen.findByRole('link', { name: 'Active Windows: 2' });
    const savedWindowsLink = await screen.findByRole('link', { name: 'Saved Windows' });
    expect(within(activeWindowsLink).getByText('2')).toHaveClass('nav-count');
    expect(savedWindowsLink.querySelector('.nav-count')).not.toBeInTheDocument();
  });

  it('places Close duplicate tabs before Merge windows in the shared top bar', async () => {
    const { container } = render(<App activeWindowsService={createService()} />);
    const removeDuplicates = await screen.findByRole('button', {
      name: 'Close duplicate tabs: 0 tabs',
    });
    const topbar = removeDuplicates.closest('header') as HTMLElement;
    const merge = await within(topbar).findByRole('button', { name: 'Merge windows' });
    const appearance = within(topbar).getByRole('button', {
      name: 'Color scheme: System default',
    });

    expect(removeDuplicates).toHaveClass('topbar-remove-duplicates-button');
    expect(merge).toHaveClass('topbar-merge-button');
    expect(appearance).toHaveClass('appearance-trigger');
    expect(
      removeDuplicates.compareDocumentPosition(merge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(merge.compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
    const toolbar = within(container.querySelector('.active-windows-toolbar') as HTMLElement);
    expect(toolbar.queryByRole('button', { name: 'Merge windows' })).not.toBeInTheDocument();
    expect(
      toolbar.queryByRole('button', { name: 'Close duplicate tabs: 0 tabs' }),
    ).not.toBeInTheDocument();
  });

  it('renders each route from the hash', async () => {
    window.location.hash = APP_ROUTES.savedWindows;
    const { container } = render(<App activeWindowsService={createService()} />);
    const heading = await screen.findByRole('heading', { name: 'Saved Windows', level: 1 });
    expect(heading).toBeInTheDocument();
    const topbar = heading.closest('header') as HTMLElement;
    expect(await screen.findByText('No saved windows')).toBeInTheDocument();
    expect(await within(topbar).findByText('0 saved windows · 0 tabs')).toBeInTheDocument();
    expect(
      await within(topbar).findByRole('button', {
        name: 'Remove duplicate tabs from Saved Windows: 0 tabs',
      }),
    ).toBeDisabled();
    expect(within(topbar).getByRole('button', { name: 'Merge saved windows' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Refresh saved windows' })).not.toBeInTheDocument();
    expect(container.querySelector('.saved-windows-toolbar')).not.toBeInTheDocument();
  });

  it('updates the page after hash navigation', async () => {
    render(<App activeWindowsService={createService()} />);
    await screen.findByRole('heading', { name: 'Window 1' });
    window.location.hash = APP_ROUTES.about;
    fireEvent(window, new HashChangeEvent('hashchange'));

    expect(screen.getByRole('heading', { name: 'About Weaver', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Weaver', level: 2 })).toBeInTheDocument();
  });

  it('marks the current navigation item', async () => {
    window.location.hash = APP_ROUTES.settings;
    render(<App activeWindowsService={createService()} />);

    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('keeps a current-mode appearance menu in the shared top bar and persists changes', async () => {
    const user = userEvent.setup();
    const settings = createSettingsService();
    window.location.hash = APP_ROUTES.about;
    render(<App activeWindowsService={createService()} settingsService={settings.service} />);
    const appearance = await screen.findByRole('button', {
      name: 'Color scheme: System default',
    });

    await waitFor(() => expect(appearance).toBeEnabled());
    await user.click(appearance);
    let menu = screen.getByRole('menu', { name: 'Color scheme' });
    const system = within(menu).getByRole('menuitemradio', { name: 'System default' });
    expect(system).toHaveAttribute('aria-checked', 'true');
    await user.click(system);
    expect(settings.setColorMode).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu', { name: 'Color scheme' })).not.toBeInTheDocument();

    await user.click(appearance);
    menu = screen.getByRole('menu', { name: 'Color scheme' });
    const dark = within(menu).getByRole('menuitemradio', { name: 'Dark' });
    await user.click(dark);

    expect(settings.setColorMode).toHaveBeenCalledWith('dark');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Color scheme: Dark' })).toBeEnabled(),
    );
    expect(screen.queryByRole('menu', { name: 'Color scheme' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'About Weaver', level: 1 })).toBeInTheDocument();
  });

  it('keeps the Settings selector and top-bar appearance icon synchronized', async () => {
    const user = userEvent.setup();
    const settings = createSettingsService();
    window.location.hash = APP_ROUTES.settings;
    render(<App activeWindowsService={createService()} settingsService={settings.service} />);

    const selector = await screen.findByRole('radiogroup', { name: 'Color scheme' });
    const system = within(selector).getByRole('radio', { name: 'System' });
    const dark = within(selector).getByRole('radio', { name: 'Dark' });
    await waitFor(() => expect(system).toBeEnabled());
    expect(system).toBeChecked();

    await user.click(dark);
    await waitFor(() => expect(dark).toBeChecked());
    expect(screen.getByRole('button', { name: 'Color scheme: Dark' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Color scheme: Dark' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    await waitFor(() =>
      expect(within(selector).getByRole('radio', { name: 'Light' })).toBeChecked(),
    );
    expect(screen.getByRole('button', { name: 'Color scheme: Light' })).toBeInTheDocument();
  });

  it('explains local processing and external data collection in About', async () => {
    window.location.hash = APP_ROUTES.about;
    const { container } = render(<App activeWindowsService={createService()} />);

    expect(await screen.findByRole('heading', { name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getByText('Your tabs stay on this device.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Reads open-tab details' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Saves locally in your browser' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'No external data collection' })).toBeVisible();
    const reviewLink = screen.getByRole('link', { name: 'please leave a review' });
    expect(reviewLink).toHaveAttribute(
      'href',
      'https://chromewebstore.google.com/detail/weaver-window-tab-manager/lchcjicakojjacjpleolmjcjlppaeobn',
    );
    expect(reviewLink).toHaveAttribute('target', '_blank');
    const issuesLink = screen.getByRole('link', { name: 'open a GitHub issue' });
    expect(issuesLink).toHaveAttribute(
      'href',
      'https://github.com/satobin/weaver-tab-manager/issues',
    );
    expect(issuesLink).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'weavertabmanager@gmail.com' })).toHaveAttribute(
      'href',
      'mailto:weavertabmanager@gmail.com',
    );
    const facts = container.querySelector('.about-facts');
    const community = container.querySelector('.about-community');
    expect(facts).not.toBeNull();
    expect(facts?.nextElementSibling).toBe(community);
    const communityParagraphs = community?.querySelectorAll('p');
    expect(communityParagraphs).toHaveLength(3);
    expect(communityParagraphs?.[0]).toHaveTextContent(
      'If you enjoy this extension, please leave a review.',
    );
    expect(communityParagraphs?.[1]).toHaveTextContent(
      'For issues or feature requests, please open a GitHub issue.',
    );
    expect(communityParagraphs?.[2]).toHaveTextContent(
      'For other questions, email weavertabmanager@gmail.com.',
    );
    expect(
      screen.getByText(/saved windows, settings, and custom rules stay in your browser/i),
    ).toBeVisible();
    expect(screen.getByText(/does not send your tab list.*off your device/i)).toBeVisible();
    expect(screen.queryByText(/Chrome may retrieve a site's icon/i)).not.toBeInTheDocument();
    expect(container.querySelectorAll('.about-privacy-item')).toHaveLength(3);
  });
});
