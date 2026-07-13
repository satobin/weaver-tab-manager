import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_ROUTES } from '../app/routes';
import {
  type ActiveWindowsService,
  type RestorableTab,
} from '../features/active-windows/chromeActiveWindowsService';
import { DEFAULT_SETTINGS, type SettingsService } from '../features/settings/settingsService';
import { OPEN_APP_MESSAGE, type OpenAppResponse } from '../shared/messages';
import {
  createActiveWindowsSnapshot,
  createManagedTab,
  createManagedWindow,
} from '../test/activeWindowsFixtures';
import { Popup } from './PopupView';

function renderPopup(service: ActiveWindowsService, settingsService?: SettingsService) {
  return render(<Popup service={service} settingsService={settingsService} />);
}

function createPopupSettingsService(advancedDuplicateMatchingEnabled: boolean): SettingsService {
  const settings = { ...DEFAULT_SETTINGS, advancedDuplicateMatchingEnabled };
  return {
    load: vi.fn(() => Promise.resolve(settings)),
    setAdvancedDuplicateMatchingEnabled: vi.fn(() => Promise.resolve(settings)),
    setColorMode: vi.fn(() => Promise.resolve(settings)),
    setDeduplicationRules: vi.fn(() => Promise.resolve(settings)),
    setPreserveGroupsDuringSort: vi.fn(() => Promise.resolve(settings)),
    setShowTabUrls: vi.fn(() => Promise.resolve(settings)),
    subscribe: vi.fn(() => () => undefined),
  };
}

function createService(): ActiveWindowsService {
  const snapshot = createActiveWindowsSnapshot({
    windows: [
      createManagedWindow({
        tabs: [
          createManagedTab({ active: true, title: 'Quarterly plan' }),
          createManagedTab({
            id: 102,
            index: 1,
            title: 'Issue tracker',
            url: 'https://issues.example.net/WEAVER-42',
          }),
        ],
      }),
    ],
  });
  return {
    closeTabs: vi.fn(() => Promise.resolve({ closedTabIds: [102], failures: [] })),
    closeWindow: vi.fn(() => Promise.resolve()),
    focusTab: vi.fn(() => Promise.resolve()),
    focusWindow: vi.fn(() => Promise.resolve()),
    loadSnapshot: vi.fn(() => Promise.resolve(snapshot)),
    mergeWindows: vi.fn(() =>
      Promise.resolve({
        destinationWindowId: 1,
        failures: [],
        mergedSourceWindowIds: [],
        movedTabIds: [],
        warnings: [],
      }),
    ),
    moveTab: vi.fn((tabId: number, destinationWindowId: number, destinationIndex: number) =>
      Promise.resolve({
        destinationIndex,
        destinationWindowId,
        movedTabId: tabId,
        warnings: [],
      }),
    ),
    moveTabGroup: vi.fn(() =>
      Promise.resolve({
        destinationWindowId: 1,
        failures: [],
        movedTabIds: [],
        warnings: [],
      }),
    ),
    moveTabsToNewWindow: vi.fn(() =>
      Promise.resolve({
        destinationWindowId: null,
        failures: [],
        movedTabIds: [],
        warnings: [],
      }),
    ),
    restoreTabs: vi.fn((tabs: readonly RestorableTab[]) =>
      Promise.resolve({
        failures: [],
        restoredOriginalTabIds: tabs.map((tab) => tab.originalTabId),
        restoredTabIds: tabs.map((_, index) => 901 + index),
        warnings: [],
      }),
    ),
    sortAllWindows: vi.fn(() =>
      Promise.resolve({ failures: [], sortedWindowIds: [], warnings: [] }),
    ),
    sortWindow: vi.fn(() => Promise.resolve({ failures: [], sortedWindowIds: [], warnings: [] })),
    subscribe: vi.fn(() => () => undefined),
    suspendTabs: vi.fn((tabIds: readonly number[]) =>
      Promise.resolve({ affectedTabIds: [...tabIds], failures: [] }),
    ),
    unsuspendTabs: vi.fn((tabIds: readonly number[]) =>
      Promise.resolve({ affectedTabIds: [...tabIds], failures: [] }),
    ),
  };
}

describe('Popup', () => {
  const sendMessage = vi.fn<(_message: unknown) => Promise<OpenAppResponse>>(() =>
    Promise.resolve({ ok: true }),
  );
  const getCommands = vi.fn(() =>
    Promise.resolve([{ name: 'open-manager', shortcut: 'Command+Shift+O' }]),
  );

  beforeEach(() => {
    sendMessage.mockClear();
    getCommands.mockClear();
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { commands: { getAll: getCommands }, runtime: { sendMessage } },
    });
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  it('loads tab and shortcut data without a blocking consent screen', async () => {
    const service = createService();
    renderPopup(service);

    expect(await screen.findByRole('searchbox', { name: 'Search open tabs' })).toBeInTheDocument();
    expect(service.loadSnapshot).toHaveBeenCalled();
    expect(getCommands).toHaveBeenCalled();
  });

  it('groups all current-window actions under one heading', async () => {
    renderPopup(createService());

    const heading = await screen.findByRole('heading', { name: 'Current window', level: 2 });
    const actionSection = heading.closest('.popup-current-window-actions');

    expect(actionSection).not.toBeNull();
    const currentWindowActions = within(actionSection as HTMLElement);
    expect(currentWindowActions.getByRole('group', { name: 'Sort current window' })).toBeVisible();
    expect(
      currentWindowActions.getByRole('button', { name: 'Close duplicate tabs 0' }),
    ).toBeVisible();
    expect(currentWindowActions.getByRole('button', { name: 'Suspend tabs 1' })).toBeVisible();
    expect(currentWindowActions.getByRole('button', { name: 'Unsuspend all 0' })).toBeVisible();
  });

  it('requests the full manager and closes', async () => {
    const user = userEvent.setup();
    renderPopup(createService());

    const openButton = await screen.findByRole('button', { name: 'Open Window Manager' });
    expect(await screen.findByText('⌘⇧O')).toHaveAttribute('title', 'Keyboard shortcut: ⌘⇧O');
    expect(openButton.querySelector('.lucide-external-link')).not.toBeInTheDocument();
    expect(getCommands).toHaveBeenCalledTimes(1);
    await user.click(openButton);

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        type: OPEN_APP_MESSAGE,
        route: APP_ROUTES.windows,
      });
    });
    expect(window.close).toHaveBeenCalled();
  });

  it('stays open and reports when the manager cannot be launched', async () => {
    const user = userEvent.setup();
    sendMessage.mockResolvedValueOnce({
      error: 'Chrome could not open the Window Manager.',
      ok: false,
    });
    renderPopup(createService());

    await user.click(await screen.findByRole('button', { name: 'Open Window Manager' }));

    expect(
      await screen.findByText('Chrome could not open the Window Manager.'),
    ).toBeInTheDocument();
    expect(window.close).not.toHaveBeenCalled();
  });

  it('searches across tabs and focuses a result', async () => {
    const user = userEvent.setup();
    const service = createService();
    renderPopup(service);

    await user.type(
      await screen.findByRole('searchbox', { name: 'Search open tabs' }),
      'WEAVER-42',
    );
    await user.click(await screen.findByTitle('https://issues.example.net/WEAVER-42'));

    expect(service.focusTab).toHaveBeenCalledWith(1, 102);
    expect(window.close).toHaveBeenCalled();
  });

  it('closes a search result and refreshes without closing the popup', async () => {
    const user = userEvent.setup();
    const service = createService();
    renderPopup(service);

    await user.type(await screen.findByRole('searchbox', { name: 'Search open tabs' }), 'Issue');
    await user.click(await screen.findByRole('button', { name: 'Close Issue tracker' }));

    expect(service.closeTabs).toHaveBeenCalledWith([102]);
    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(2));
    expect(window.close).not.toHaveBeenCalled();
  });

  it('sorts the current window with default or customized options without closing', async () => {
    const user = userEvent.setup();
    const service = createService();
    renderPopup(service);

    const sortButton = await screen.findByRole('button', { name: 'Sort current window' });
    await user.click(sortButton);

    await waitFor(() => {
      expect(service.sortWindow).toHaveBeenCalledWith(1, {
        criterion: 'title',
        direction: 'asc',
        preserveGroups: true,
      });
    });
    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: 'Sort current window by: Title' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'URL' }));
    await user.click(screen.getByRole('button', { name: 'Sort current window direction A to Z' }));
    await user.click(sortButton);

    await waitFor(() => {
      expect(service.sortWindow).toHaveBeenLastCalledWith(1, {
        criterion: 'url',
        direction: 'desc',
        preserveGroups: true,
      });
    });
    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(3));
    expect(window.close).not.toHaveBeenCalled();
  });

  it('keeps both quick-action buttons visually stable while an operation is pending', async () => {
    const user = userEvent.setup();
    const service = createService();
    const duplicateUrl = 'https://example.test/same';
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({ active: true, id: 101, url: duplicateUrl }),
              createManagedTab({ id: 102, index: 1, url: duplicateUrl }),
            ],
          }),
        ],
      }),
    );
    let finishSort = () => undefined;
    vi.mocked(service.sortWindow).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSort = () => {
            resolve({ failures: [], sortedWindowIds: [1], warnings: [] });
          };
        }),
    );
    renderPopup(service);

    const sortControls = await screen.findByRole('group', { name: 'Sort current window' });
    const sortButton = screen.getByRole('button', { name: 'Sort current window' });
    const dedupeButton = await screen.findByRole('button', { name: 'Close duplicate tabs 1' });
    await user.click(sortButton);

    expect(sortButton).toHaveTextContent('Sort');
    expect(dedupeButton).toHaveTextContent('Close duplicate tabs');
    expect(sortControls).toHaveAttribute('data-operation-locked', 'true');
    expect(screen.getByRole('button', { name: 'Sort current window by: Title' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Sort current window direction A to Z' }),
    ).toBeDisabled();
    expect(dedupeButton).toHaveAttribute('data-operation-locked', 'true');
    expect(sortButton).toBeDisabled();
    expect(dedupeButton).toBeDisabled();

    finishSort();
    await waitFor(() => expect(sortButton).toHaveAttribute('aria-busy', 'false'));
  });

  it('removes duplicates only from the current window and can undo without a success banner', async () => {
    const user = userEvent.setup();
    const service = createService();
    const duplicateUrl = 'https://example.test/same';
    vi.mocked(service.loadSnapshot)
      .mockResolvedValueOnce(
        createActiveWindowsSnapshot({
          windows: [
            createManagedWindow({
              tabs: [
                createManagedTab({ id: 101, url: duplicateUrl }),
                createManagedTab({ active: true, id: 102, index: 1, url: duplicateUrl }),
              ],
            }),
            createManagedWindow({
              id: 2,
              isCurrent: false,
              label: 'Window 2',
              tabs: [createManagedTab({ id: 201, url: duplicateUrl, windowId: 2 })],
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        createActiveWindowsSnapshot({
          windows: [
            createManagedWindow({
              tabs: [createManagedTab({ active: true, id: 102, url: duplicateUrl })],
            }),
            createManagedWindow({
              id: 2,
              isCurrent: false,
              label: 'Window 2',
              tabs: [createManagedTab({ id: 201, url: duplicateUrl, windowId: 2 })],
            }),
          ],
        }),
      );
    vi.mocked(service.closeTabs).mockResolvedValue({ closedTabIds: [101], failures: [] });
    renderPopup(service);

    await user.click(await screen.findByRole('button', { name: 'Close duplicate tabs 1' }));

    expect(service.closeTabs).toHaveBeenCalledWith([101]);
    expect(await screen.findByRole('button', { name: 'Close duplicate tabs 0' })).toBeDisabled();
    expect(service.loadSnapshot).toHaveBeenCalledTimes(2);
    expect(screen.getByText('1 duplicate tab removed.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() =>
      expect(service.restoreTabs).toHaveBeenCalledWith([
        {
          group: null,
          index: 0,
          originalTabId: 101,
          pinned: false,
          title: 'Example tab',
          url: duplicateUrl,
          windowId: 1,
        },
      ]),
    );
    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('1 duplicate tab removed.')).not.toBeInTheDocument();
    expect(screen.queryByText(/duplicate tab restored\./i)).not.toBeInTheDocument();
    expect(window.close).not.toHaveBeenCalled();
  });

  it('keeps exact duplicate removal available when advanced matching is off', async () => {
    const service = createService();
    const duplicateUrl = 'https://example.test/same';
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({ active: true, id: 101, url: duplicateUrl }),
              createManagedTab({ id: 102, index: 1, url: duplicateUrl }),
            ],
          }),
        ],
      }),
    );
    renderPopup(service, createPopupSettingsService(false));

    expect(await screen.findByRole('button', { name: 'Close duplicate tabs 1' })).toBeEnabled();
  });

  it('suspends inactive tabs and unsuspends discarded tabs in the current window', async () => {
    const user = userEvent.setup();
    const service = createService();
    const createSnapshot = (discardedTabIds: readonly number[]) =>
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({ active: true, id: 101 }),
              createManagedTab({
                discarded: discardedTabIds.includes(102),
                id: 102,
                index: 1,
              }),
              createManagedTab({
                discarded: discardedTabIds.includes(103),
                id: 103,
                index: 2,
              }),
            ],
          }),
        ],
      });
    vi.mocked(service.loadSnapshot)
      .mockResolvedValueOnce(createSnapshot([103]))
      .mockResolvedValueOnce(createSnapshot([102, 103]))
      .mockResolvedValueOnce(createSnapshot([]));
    renderPopup(service);

    expect(await screen.findByText('Current window')).toBeInTheDocument();
    expect(screen.queryByText('1 suspended')).not.toBeInTheDocument();
    expect(
      await screen.findByText('1 tab suspended · Tabs reload when opened'),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Suspend tabs 1' }));

    expect(service.suspendTabs).toHaveBeenCalledWith([102]);
    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('2 suspended')).not.toBeInTheDocument();
    expect(
      await screen.findByText('2 tabs suspended · Tabs reload when opened'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unsuspend all 2' }));

    expect(service.unsuspendTabs).toHaveBeenCalledWith([102, 103]);
    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('0 suspended')).not.toBeInTheDocument();
    expect(screen.queryByText(/tabs? suspended · Tabs reload/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unsuspend all 0' })).toBeDisabled();
    expect(window.close).not.toHaveBeenCalled();
  });

  it('relies on live updates instead of exposing a manual refresh control', async () => {
    renderPopup(createService());

    expect(await screen.findByText('1 window · 2 tabs')).toHaveClass('popup-context-count');
    expect(screen.queryByRole('button', { name: 'Refresh tabs' })).not.toBeInTheDocument();
  });

  it('places the normal summary in the same slot as the filtered result count', async () => {
    const user = userEvent.setup();
    renderPopup(createService());

    expect(await screen.findByText('1 window · 2 tabs')).toHaveClass('popup-context-count');
    await user.type(await screen.findByRole('searchbox', { name: 'Search open tabs' }), 'Issue');
    expect(await screen.findByText('1 result')).toHaveClass('popup-context-count');
  });

  it('shows a close failure without losing the search', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.closeTabs).mockResolvedValue({
      closedTabIds: [],
      failures: [{ message: 'Tab is locked.', tabId: 102 }],
    });
    renderPopup(service);

    await user.type(await screen.findByRole('searchbox', { name: 'Search open tabs' }), 'Issue');
    await user.click(await screen.findByRole('button', { name: 'Close Issue tracker' }));

    expect(await screen.findByText('Tab is locked.')).toBeInTheDocument();
    expect(screen.getByText('Issue tracker')).toBeInTheDocument();
  });
});
