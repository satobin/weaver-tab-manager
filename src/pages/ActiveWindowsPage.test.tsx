import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type ActiveWindowsService,
  type RestorableTab,
} from '../features/active-windows/chromeActiveWindowsService';
import { type DedupeRule } from '../features/deduplication/deduplication';
import { type SavedWindowsService } from '../features/saved-windows/savedWindowsService';
import { DEFAULT_SETTINGS, type SettingsService } from '../features/settings/settingsService';
import {
  createActiveWindowsSnapshot,
  createManagedTab,
  createManagedWindow,
} from '../test/activeWindowsFixtures';
import { ActiveWindowsPage } from './ActiveWindowsPage';

function createService(): ActiveWindowsService {
  const snapshot = createActiveWindowsSnapshot({
    windows: [
      createManagedWindow({
        groups: [
          {
            collapsed: true,
            color: 'purple',
            id: 7,
            title: 'Planning',
            windowId: 1,
          },
        ],
        tabs: [
          createManagedTab({
            active: true,
            groupId: 7,
            pinned: true,
            title: 'Quarterly plan',
            url: 'https://docs.example.com/quarterly-plan',
          }),
          createManagedTab({
            discarded: true,
            groupId: 7,
            id: 102,
            index: 1,
            title: 'Issue tracker',
            url: 'https://issues.example.net/WEAVER-42',
          }),
        ],
      }),
      createManagedWindow({
        focused: false,
        id: 2,
        isCurrent: false,
        label: 'Window 2',
        tabs: [
          createManagedTab({
            active: true,
            id: 201,
            title: 'Reference',
            url: 'https://reference.test',
            windowId: 2,
          }),
        ],
      }),
    ],
  });

  return {
    closeTabs: vi.fn(() => Promise.resolve({ closedTabIds: [], failures: [] })),
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
    moveTabGroup: vi.fn((groupId: number, destinationWindowId: number) =>
      Promise.resolve({
        destinationWindowId,
        failures: [],
        movedTabIds: groupId === 7 ? [101, 102] : [],
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
    suspendTabs: vi.fn(() => Promise.resolve({ affectedTabIds: [], failures: [] })),
    unsuspendTabs: vi.fn(() => Promise.resolve({ affectedTabIds: [], failures: [] })),
  };
}

function createSettingsService(
  rules: DedupeRule[],
  showTabUrls = true,
  advancedDuplicateMatchingEnabled = true,
): SettingsService {
  const settings = {
    ...DEFAULT_SETTINGS,
    advancedDuplicateMatchingEnabled,
    deduplicationRules: rules,
    showTabUrls,
  };
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

function createSavedWindowsService(): SavedWindowsService {
  return {
    deleteWindow: vi.fn(() => Promise.resolve()),
    keepWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    load: vi.fn(() => Promise.resolve([])),
    openTab: vi.fn(() => Promise.reject(new Error('Not used'))),
    renameWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    restoreWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    saveWindow: vi.fn((sourceWindowId: number, name: string, closeSource: boolean) =>
      Promise.resolve({
        savedWindow: {
          createdAt: '2026-07-10T20:00:00.000Z',
          groups: [],
          id: 'saved-1',
          name,
          tabs: [
            {
              active: true,
              order: 0,
              pinned: false,
              title: 'Saved tab',
              url: 'https://example.com/',
            },
          ],
          updatedAt: '2026-07-10T20:00:00.000Z',
        },
        sourceWindowClosed: closeSource,
        warnings: sourceWindowId === 1 ? [] : ['Unexpected source'],
      }),
    ),
    subscribe: vi.fn(() => () => undefined),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ActiveWindowsPage', () => {
  it('renders window identity, groups, tab state, and summary', async () => {
    const service = createService();
    const { container } = render(<ActiveWindowsPage service={service} />);

    expect(await screen.findByRole('heading', { name: 'Window 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Window 2' })).toBeInTheDocument();
    expect(container.querySelector('.window-browser-icon')).toHaveAttribute('width', '24');
    expect(screen.getByText('2 windows · 3 tabs')).toBeInTheDocument();
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus first tab in Planning' })).toBeInTheDocument();
    expect(screen.getByText('Collapsed')).toBeInTheDocument();
    expect(screen.getByLabelText('Pinned')).toBeInTheDocument();
    const suspendedIndicator = screen.getByTitle('Suspended · Tabs reload when opened');
    expect(suspendedIndicator).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Focus Issue tracker' })).toHaveAttribute(
      'aria-describedby',
      'tab-102-suspended-description',
    );
    expect(screen.getByRole('button', { name: 'Focus Issue tracker' }).closest('li')).toHaveClass(
      'is-suspended',
    );
    expect(suspendedIndicator).toHaveTextContent('Suspended');
    expect(suspendedIndicator).toHaveTextContent('Tabs reload when opened.');
    expect(screen.getByRole('button', { name: 'Focus Quarterly plan' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const currentCard = screen.getByRole('heading', { name: 'Window 1' }).closest('article');
    const otherCard = screen.getByRole('heading', { name: 'Window 2' }).closest('article');
    const currentActiveTab = screen
      .getByRole('button', { name: 'Focus Quarterly plan' })
      .closest('li');
    const otherActiveTab = screen.getByRole('button', { name: 'Focus Reference' }).closest('li');
    expect(currentCard).toHaveClass('is-focused-window');
    expect(otherCard).not.toHaveClass('is-focused-window');
    expect(screen.queryByText('Focused')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Window 1' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(currentActiveTab).toHaveClass('is-active', 'is-active-in-focused-window');
    expect(currentActiveTab).toHaveClass('group-color-purple');
    expect(screen.getByRole('button', { name: 'Focus Issue tracker' }).closest('li')).toHaveClass(
      'group-color-purple',
    );
    expect(otherActiveTab).toHaveClass('is-active');
    expect(otherActiveTab).not.toHaveClass('is-active-in-focused-window');
  });

  it('hides tab URLs and compacts rows when disabled in Settings', async () => {
    const settingsService = createSettingsService(DEFAULT_SETTINGS.deduplicationRules, false);
    const { container } = render(
      <ActiveWindowsPage service={createService()} settingsService={settingsService} />,
    );

    await screen.findByRole('heading', { name: 'Window 1' });
    expect(screen.queryByText('docs.example.com/quarterly-plan')).not.toBeInTheDocument();
    expect(screen.queryByText('issues.example.net/WEAVER-42')).not.toBeInTheDocument();
    expect(container.querySelector('.window-card')).toHaveClass('is-compact-tabs');
    expect(screen.getByRole('button', { name: 'Focus Quarterly plan' })).toHaveAttribute(
      'title',
      'https://docs.example.com/quarterly-plan',
    );
  });

  it('keeps per-window sort controls in the card header immediately before Save', async () => {
    const { container } = render(<ActiveWindowsPage service={createService()} />);
    const heading = await screen.findByRole('heading', { name: 'Window 1' });
    const card = heading.closest('article');
    const header = heading.closest('header');
    expect(card).not.toBeNull();
    expect(header).not.toBeNull();

    const sortControls = within(header as HTMLElement).getByRole('group', {
      name: 'Sort Window 1',
    });
    const saveButton = within(header as HTMLElement).getByRole('button', {
      name: 'Save Window 1',
    });
    expect(sortControls.nextElementSibling).toBe(saveButton);
    expect(container.querySelector('.window-card-toolbar')).not.toBeInTheDocument();
  });

  it('balances cards into independent columns and preserves local sort choices across breakpoints', async () => {
    let notifyResize: ((width: number) => void) | undefined;
    class ResizeObserverMock {
      readonly disconnect = vi.fn();
      readonly unobserve = vi.fn();

      constructor(private readonly callback: ResizeObserverCallback) {}

      observe = (target: Element) => {
        notifyResize = (width) => {
          this.callback([{ contentRect: { width }, target } as ResizeObserverEntry], this);
        };
        notifyResize(936);
      };
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: Array.from({ length: 8 }, (_, index) =>
              createManagedTab({
                active: index === 0,
                id: 101 + index,
                index,
                title: `Current tab ${index + 1}`,
              }),
            ),
          }),
          createManagedWindow({
            focused: false,
            id: 2,
            isCurrent: false,
            label: 'Window 2',
            tabs: [createManagedTab({ id: 201, windowId: 2 })],
          }),
          createManagedWindow({
            focused: false,
            id: 3,
            isCurrent: false,
            label: 'Window 3',
            tabs: [createManagedTab({ id: 301, windowId: 3 })],
          }),
          createManagedWindow({
            focused: false,
            id: 4,
            isCurrent: false,
            label: 'Window 4',
            tabs: [createManagedTab({ id: 401, windowId: 4 })],
          }),
        ],
      }),
    );
    const { container } = render(<ActiveWindowsPage service={service} />);

    await screen.findByRole('heading', { name: 'Window 4' });
    await waitFor(() => expect(container.querySelectorAll('.window-grid-column')).toHaveLength(2));
    const columns = container.querySelectorAll('.window-grid-column');
    expect(
      within(columns[0] as HTMLElement).getByRole('heading', { name: 'Window 1' }),
    ).toBeInTheDocument();
    expect(
      within(columns[1] as HTMLElement).getByRole('heading', { name: 'Window 2' }),
    ).toBeInTheDocument();
    expect(
      within(columns[1] as HTMLElement).getByRole('heading', { name: 'Window 3' }),
    ).toBeInTheDocument();
    expect(
      within(columns[1] as HTMLElement).getByRole('heading', { name: 'Window 4' }),
    ).toBeInTheDocument();
    expect(
      within(columns[0] as HTMLElement).queryByRole('heading', { name: 'Window 4' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sort Window 1 by: Title' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'URL' }));
    await user.click(screen.getByRole('button', { name: 'Sort Window 1 direction A to Z' }));
    expect(notifyResize).toBeDefined();
    act(() => notifyResize?.(459));

    await waitFor(() => expect(container.querySelectorAll('.window-grid-column')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Sort Window 1 by: URL' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Sort Window 1 direction Z to A' }),
    ).toBeInTheDocument();
  });

  it('filters by title and URL and can clear an empty result', async () => {
    const user = userEvent.setup();
    render(<ActiveWindowsPage service={createService()} />);
    const search = await screen.findByRole('searchbox', { name: 'Filter tabs by title or URL' });
    const searchFrame = search.closest('label');
    expect(searchFrame).not.toBeNull();
    const reservedClearButton = searchFrame?.querySelector('.window-search-clear');
    expect(reservedClearButton).not.toBeNull();
    expect(search).toHaveAttribute('type', 'text');
    expect(reservedClearButton).toHaveClass('is-hidden');

    await user.type(search, 'WEAVER-42');
    expect(within(searchFrame as HTMLElement).getByRole('button', { name: 'Clear filter' })).toBe(
      reservedClearButton,
    );
    expect(reservedClearButton).not.toHaveClass('is-hidden');
    expect(screen.queryByText('1 of 3 tabs')).not.toBeInTheDocument();
    expect(screen.getByText('Issue tracker')).toBeInTheDocument();
    expect(screen.queryByText('Quarterly plan')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Window 2' })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'no-result');
    expect(screen.getByRole('heading', { name: 'No matching tabs' })).toBeInTheDocument();
    await user.click(
      within(searchFrame as HTMLElement).getByRole('button', { name: 'Clear filter' }),
    );
    expect(screen.getByText('Quarterly plan')).toBeInTheDocument();
  });

  it('delegates non-destructive window and tab focus actions', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<ActiveWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Window 1' }));
    expect(service.focusWindow).toHaveBeenCalledWith(1);

    await user.click(screen.getByRole('button', { name: 'Window 2' }));
    expect(service.focusWindow).toHaveBeenLastCalledWith(2);
    expect(screen.queryByRole('button', { name: 'Focus Window 2' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Focus first tab in Planning' }));
    expect(service.focusTab).toHaveBeenCalledWith(1, 101);

    await user.click(screen.getByRole('button', { name: 'Focus Issue tracker' }));
    expect(service.focusTab).toHaveBeenLastCalledWith(1, 102);
  });

  it('suspends only loaded background tabs in the chosen window', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({ active: true, id: 101, title: 'Active tab' }),
              createManagedTab({ id: 102, index: 1, title: 'Loaded background tab' }),
              createManagedTab({ discarded: true, id: 103, index: 2, title: 'Suspended tab' }),
            ],
          }),
          createManagedWindow({
            focused: false,
            id: 2,
            isCurrent: false,
            label: 'Window 2',
            tabs: [
              createManagedTab({ active: true, id: 201, title: 'Other active tab', windowId: 2 }),
              createManagedTab({ id: 202, index: 1, title: 'Other background tab', windowId: 2 }),
              createManagedTab({
                discarded: true,
                id: 203,
                index: 2,
                title: 'Other suspended tab',
                windowId: 2,
              }),
            ],
          }),
        ],
      }),
    );
    vi.mocked(service.suspendTabs).mockResolvedValue({ affectedTabIds: [102], failures: [] });
    render(<ActiveWindowsPage service={service} />);

    await user.type(
      await screen.findByRole('searchbox', { name: 'Filter tabs by title or URL' }),
      'Active tab',
    );
    await user.click(await screen.findByRole('button', { name: 'Suspend tabs in Window 1' }));

    expect(service.suspendTabs).toHaveBeenCalledTimes(1);
    expect(service.suspendTabs).toHaveBeenCalledWith([102]);
    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(2));
    expect(service.focusWindow).not.toHaveBeenCalled();

    await user.clear(screen.getByRole('searchbox', { name: 'Filter tabs by title or URL' }));
    await user.click(screen.getByRole('button', { name: 'Unsuspend all tabs in Window 1' }));

    expect(service.unsuspendTabs).toHaveBeenCalledTimes(1);
    expect(service.unsuspendTabs).toHaveBeenCalledWith([103]);
    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(3));
  });

  it('explains why one active tab remains loaded when all background tabs are suspended', async () => {
    render(<ActiveWindowsPage service={createService()} />);

    const suspendButton = await screen.findByRole('button', { name: 'Suspend tabs in Window 1' });
    expect(suspendButton).toBeDisabled();
    expect(suspendButton).toHaveAttribute(
      'title',
      'All background tabs are suspended. Chrome keeps the active tab loaded.',
    );
    expect(screen.getByRole('button', { name: 'Unsuspend all tabs in Window 1' })).toBeEnabled();
  });

  it('supports ordinary, shift-range, and Escape selection', async () => {
    const user = userEvent.setup();
    render(<ActiveWindowsPage service={createService()} />);
    const first = await screen.findByRole('checkbox', { name: 'Select Quarterly plan' });
    const second = screen.getByRole('checkbox', { name: 'Select Issue tracker' });

    await user.click(first);
    expect(first).toBeChecked();
    expect(screen.getByRole('button', { name: 'Clear selected 1' })).toBeInTheDocument();
    expect(screen.getByText('2 tabs (1 selected)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear selection' })).not.toBeInTheDocument();

    await user.keyboard('{Shift>}');
    await user.click(second);
    await user.keyboard('{/Shift}');
    expect(first).toBeChecked();
    expect(second).toBeChecked();
    expect(screen.getByRole('button', { name: 'Clear selected 2' })).toBeInTheDocument();
    expect(screen.getByText('2 tabs (2 selected)')).toBeInTheDocument();
    expect(screen.queryByText('2 tabs selected')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(first).not.toBeChecked();
    expect(second).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Clear selected 2' })).not.toBeInTheDocument();
  });

  it('selects visible tabs per window and reports indeterminate state', async () => {
    const user = userEvent.setup();
    render(<ActiveWindowsPage service={createService()} />);
    const selectWindow = await screen.findByRole('checkbox', {
      name: 'Select all visible tabs in Window 1',
    });

    await user.click(selectWindow);
    expect(selectWindow).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Quarterly plan' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Issue tracker' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Select Issue tracker' }));
    expect(selectWindow).not.toBeChecked();
    expect(selectWindow).toHaveProperty('indeterminate', true);
  });

  it('selects every tab in a group even when the filter hides some group members', async () => {
    const user = userEvent.setup();
    render(<ActiveWindowsPage service={createService()} />);
    const search = await screen.findByRole('searchbox', { name: 'Filter tabs by title or URL' });

    await user.type(search, 'Quarterly');
    const selectGroup = screen.getByRole('checkbox', { name: 'Select all tabs in Planning' });
    await user.click(selectGroup);

    expect(selectGroup).toBeChecked();
    expect(screen.getByRole('button', { name: 'Clear selected 2' })).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Select Issue tracker' }),
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'example' } });
    expect(screen.getByRole('checkbox', { name: 'Select Quarterly plan' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Issue tracker' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Select all tabs in Planning' }));
    expect(screen.getByRole('checkbox', { name: 'Select Quarterly plan' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Issue tracker' })).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Select Quarterly plan' }));
    expect(screen.getByRole('checkbox', { name: 'Select all tabs in Planning' })).toHaveProperty(
      'indeterminate',
      true,
    );
  });

  it('selects filtered results and reuses the same control to clear selection', async () => {
    const user = userEvent.setup();
    render(<ActiveWindowsPage service={createService()} />);
    const search = await screen.findByRole('searchbox', { name: 'Filter tabs by title or URL' });

    await user.type(search, 'example');
    await user.click(screen.getByRole('button', { name: 'Select filtered 2' }));
    expect(screen.getByRole('checkbox', { name: 'Select Quarterly plan' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Issue tracker' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Clear selected 2' }));
    expect(search).toHaveValue('example');
    expect(screen.getByRole('checkbox', { name: 'Select Quarterly plan' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Issue tracker' })).not.toBeChecked();
  });

  it('moves selected tabs in browser display order and clears selection', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.moveTabsToNewWindow).mockResolvedValue({
      destinationWindowId: 9,
      failures: [],
      movedTabIds: [101, 102],
      warnings: [],
    });
    render(<ActiveWindowsPage service={service} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Select Quarterly plan' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Issue tracker' }));
    expect(screen.getByRole('checkbox', { name: 'Select all tabs in Planning' })).toHaveProperty(
      'indeterminate',
      true,
    );
    await user.click(screen.getByRole('button', { name: 'New window 2' }));

    await waitFor(() => {
      expect(service.moveTabsToNewWindow).toHaveBeenCalledWith([101, 102], []);
    });
    expect(screen.getByRole('checkbox', { name: 'Select Quarterly plan' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Issue tracker' })).not.toBeChecked();
  });

  it('preserves a group only when its group checkbox selected the tabs', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.moveTabsToNewWindow).mockResolvedValue({
      destinationWindowId: 9,
      failures: [],
      movedTabIds: [101, 102],
      warnings: [],
    });
    render(<ActiveWindowsPage service={service} />);

    const groupCheckbox = await screen.findByRole('checkbox', {
      name: 'Select all tabs in Planning',
    });
    await user.click(groupCheckbox);
    expect(groupCheckbox).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'New window 2' }));

    await waitFor(() => {
      expect(service.moveTabsToNewWindow).toHaveBeenCalledWith([101, 102], [7]);
    });
  });

  it('does not offer a new window for the only tab in a single-tab window', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<ActiveWindowsPage service={service} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Select Reference' }));
    const newWindowButton = screen.getByRole('button', { name: 'New window 1' });

    expect(newWindowButton).toBeDisabled();
    await user.click(newWindowButton);
    expect(service.moveTabsToNewWindow).not.toHaveBeenCalled();
  });

  it('retains failed closes in selection and reports a partial result', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.closeTabs).mockResolvedValue({
      closedTabIds: [101],
      failures: [{ message: 'Tab is locked.', tabId: 102 }],
    });
    render(<ActiveWindowsPage service={service} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Select Quarterly plan' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Issue tracker' }));
    await user.click(screen.getByRole('button', { name: 'Close 2' }));

    expect(
      await screen.findByText('1 tab could not be closed. Tab is locked.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Quarterly plan' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Issue tracker' })).toBeChecked();
  });

  it('closes one tab from its row action without affecting other tabs', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.closeTabs).mockResolvedValue({ closedTabIds: [102], failures: [] });
    render(<ActiveWindowsPage service={service} />);

    await user.click(
      await screen.findByRole('button', { name: 'Close Issue tracker, tab 2 of 2' }),
    );

    await waitFor(() => expect(service.closeTabs).toHaveBeenCalledWith([102]));
    expect(service.closeTabs).toHaveBeenCalledTimes(1);
  });

  it('closes a whole window through its card action', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<ActiveWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Close Window 2' }));

    expect(service.closeWindow).toHaveBeenCalledTimes(1);
    expect(service.closeWindow).toHaveBeenCalledWith(2);
  });

  it('sorts each window independently and retains a separate global sort choice', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<ActiveWindowsPage service={service} />);

    const currentWindow = (
      await screen.findByRole('heading', {
        name: 'Window 1',
      })
    ).closest('article');
    const otherWindow = screen.getByRole('heading', { name: 'Window 2' }).closest('article');
    expect(currentWindow).not.toBeNull();
    expect(otherWindow).not.toBeNull();

    await user.click(
      within(currentWindow as HTMLElement).getByRole('button', {
        name: 'Sort Window 1 by: Title',
      }),
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'URL' }));
    await user.click(
      within(currentWindow as HTMLElement).getByRole('button', {
        name: 'Sort Window 1 direction A to Z',
      }),
    );
    await user.click(within(currentWindow as HTMLElement).getByRole('button', { name: 'Sort' }));
    expect(service.sortWindow).toHaveBeenCalledWith(1, {
      criterion: 'url',
      direction: 'desc',
      preserveGroups: true,
    });

    await user.click(within(otherWindow as HTMLElement).getByRole('button', { name: 'Sort' }));
    expect(service.sortWindow).toHaveBeenLastCalledWith(2, {
      criterion: 'title',
      direction: 'asc',
      preserveGroups: true,
    });

    await user.click(screen.getByRole('button', { name: 'Sort all windows by: Title' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'URL' }));
    await user.click(screen.getByRole('button', { name: 'Sort direction A to Z' }));
    await user.click(screen.getByRole('button', { name: 'Sort all' }));
    expect(service.sortAllWindows).toHaveBeenCalledWith({
      criterion: 'url',
      direction: 'desc',
      preserveGroups: true,
    });
  });

  it('sorts without showing transient progress text or disabling the toolbar', async () => {
    const user = userEvent.setup();
    const service = createService();
    let resolveSort:
      | ((result: { failures: []; sortedWindowIds: []; warnings: [] }) => void)
      | null = null;
    vi.mocked(service.sortAllWindows).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSort = resolve;
        }),
    );
    render(<ActiveWindowsPage service={service} />);

    const sortButton = await screen.findByRole('button', { name: 'Sort all' });
    await user.click(sortButton);

    expect(screen.queryByText('Sorting all windows')).not.toBeInTheDocument();
    expect(sortButton).toBeEnabled();

    await act(async () => {
      resolveSort?.({ failures: [], sortedWindowIds: [], warnings: [] });
      await Promise.resolve();
    });
    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(2));
  });

  it('opens the global sort menu from its control and dismisses it on outside click', async () => {
    const user = userEvent.setup();
    render(<ActiveWindowsPage service={createService()} />);
    const trigger = await screen.findByRole('button', { name: 'Sort all windows by: Title' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      bottom: 44,
      left: 20,
      top: 10,
      width: 76,
    } as DOMRect);

    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Sort all windows by' });
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveStyle({ left: '20px', top: '48px', width: '96px' });
    expect(screen.getByRole('menuitemradio', { name: 'Title' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu', { name: 'Sort all windows by' })).not.toBeInTheDocument();
  });

  it('merges explicit source windows into the selected destination', async () => {
    const user = userEvent.setup();
    const service = createService();
    const { container } = render(<ActiveWindowsPage service={service} />);

    const mergeButton = await screen.findByRole('button', { name: 'Merge windows' });
    const destinationCard = screen.getByRole('heading', { name: 'Window 1' }).closest('article');
    const sourceCard = screen.getByRole('heading', { name: 'Window 2' }).closest('article');
    vi.spyOn(mergeButton, 'getBoundingClientRect').mockReturnValue({ left: 200 } as DOMRect);
    await user.click(mergeButton);
    const dialog = screen.getByRole('dialog', { name: 'Merge windows' });
    expect(dialog.parentElement).toHaveClass('merge-control');
    expect(dialog).toHaveStyle({ left: '0px' });
    expect(dialog).toBeInTheDocument();
    const destinationTrigger = screen.getByRole('button', {
      name: 'Destination: Window 1 (2)',
    });
    expect(screen.queryByRole('combobox', { name: 'Destination' })).not.toBeInTheDocument();
    expect(destinationCard).toHaveClass('is-focused-window');
    expect(destinationCard).not.toHaveClass('is-merge-destination');
    expect(sourceCard).not.toHaveClass('is-merge-source');
    expect(container.querySelector('.merge-role-label')).not.toBeInTheDocument();
    expect(dialog.querySelector('.merge-color-swatch')).not.toBeInTheDocument();

    await user.click(destinationTrigger);
    const destinationMenu = screen.getByRole('menu', { name: 'Destination' });
    expect(destinationMenu.parentElement).toBe(document.body);
    expect(
      within(destinationMenu).getByRole('menuitemradio', {
        name: /Window 1.*2 tabs.*Quarterly plan/,
      }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      within(destinationMenu).getByRole('menuitemradio', {
        name: /Window 2.*1 tab.*Reference/,
      }),
    ).toBeInTheDocument();
    await user.click(
      within(destinationMenu).getByRole('menuitemradio', { name: /Window 2.*1 tab/ }),
    );
    expect(screen.getByRole('dialog', { name: 'Merge windows' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Destination: Window 2 (1)' })).toBeInTheDocument();
    expect(sourceCard).not.toHaveClass('is-merge-destination');

    const sourceCheckbox = within(dialog).getByRole('checkbox', {
      name: /Window 1.*Quarterly plan.*2 tabs/,
    });
    const selectAll = within(dialog).getByRole('button', { name: 'Select all' });
    expect(selectAll.closest('footer')).toBe(dialog.querySelector('footer'));
    expect(selectAll.querySelector('.lucide-list-checks')).toBeInTheDocument();
    await user.click(selectAll);
    expect(sourceCheckbox).toBeChecked();
    const clearAll = within(dialog).getByRole('button', { name: 'Clear all' });
    expect(clearAll.querySelector('.lucide-list-x')).toBeInTheDocument();
    await user.click(clearAll);
    expect(sourceCheckbox).not.toBeChecked();
    await user.click(sourceCheckbox);
    expect(destinationCard).toHaveClass('is-merge-source');
    expect(sourceCheckbox.closest('label')).toHaveClass('is-selected');
    await user.click(screen.getByRole('button', { name: 'Merge 2 windows' }));

    await waitFor(() => expect(service.mergeWindows).toHaveBeenCalledWith([2, 1]));
    expect(screen.queryByRole('dialog', { name: 'Merge windows' })).not.toBeInTheDocument();
  });

  it('closes the merge dialog when clicking outside it', async () => {
    const user = userEvent.setup();
    render(<ActiveWindowsPage service={createService()} />);

    await user.click(await screen.findByRole('button', { name: 'Merge windows' }));
    expect(screen.getByRole('dialog', { name: 'Merge windows' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Merge windows' })).not.toBeInTheDocument();
  });

  it('lets the destination menu consume Escape before closing Merge', async () => {
    const user = userEvent.setup();
    render(<ActiveWindowsPage service={createService()} />);

    await user.click(await screen.findByRole('button', { name: 'Merge windows' }));
    await user.click(screen.getByRole('button', { name: 'Destination: Window 1 (2)' }));
    expect(screen.getByRole('menu', { name: 'Destination' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Destination' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Merge windows' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Merge windows' })).not.toBeInTheDocument();
  });

  it('removes duplicates while keeping the active copy in the current window', async () => {
    const user = userEvent.setup();
    const service = createService();
    const duplicateUrl = 'https://example.test/same';
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({ id: 101, url: duplicateUrl, windowId: 1 }),
              createManagedTab({
                active: true,
                id: 102,
                index: 1,
                url: duplicateUrl,
                windowId: 1,
              }),
            ],
          }),
          createManagedWindow({
            focused: false,
            id: 2,
            isCurrent: false,
            label: 'Window 2',
            tabs: [createManagedTab({ id: 201, url: duplicateUrl, windowId: 2 })],
          }),
        ],
      }),
    );
    vi.mocked(service.closeTabs).mockResolvedValue({ closedTabIds: [101, 201], failures: [] });
    render(<ActiveWindowsPage service={service} />);

    const removeButton = await screen.findByRole('button', { name: 'Close duplicate tabs 2' });
    await waitFor(() => expect(removeButton).toBeEnabled());
    await user.click(removeButton);

    expect(service.closeTabs).toHaveBeenCalledWith([101, 201]);
    expect(await screen.findByText('2 duplicate tabs removed.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));

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
      {
        group: null,
        index: 0,
        originalTabId: 201,
        pinned: false,
        title: 'Example tab',
        url: duplicateUrl,
        windowId: 2,
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByText('2 duplicate tabs restored.')).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('applies a saved site-wide rule to different paths', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [createManagedTab({ id: 101, url: 'https://app.example.test/one' })],
          }),
          createManagedWindow({
            id: 2,
            isCurrent: false,
            label: 'Window 2',
            tabs: [
              createManagedTab({
                id: 201,
                url: 'https://app.example.test/two?view=details',
                windowId: 2,
              }),
            ],
          }),
        ],
      }),
    );
    vi.mocked(service.closeTabs).mockResolvedValue({ closedTabIds: [201], failures: [] });
    const settingsService = createSettingsService([
      {
        comparisonMode: 'host',
        enabled: true,
        glob: 'app.example.test/*',
        id: 'custom-host',
      },
    ]);
    render(<ActiveWindowsPage service={service} settingsService={settingsService} />);

    const removeButton = await screen.findByRole('button', { name: 'Close duplicate tabs 1' });
    await user.click(removeButton);

    expect(service.closeTabs).toHaveBeenCalledWith([201]);
  });

  it('still finds exact duplicates when advanced duplicate matching is off', async () => {
    const duplicateUrl = 'https://example.test/same';
    const service = createService();
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
    const settingsService = createSettingsService(DEFAULT_SETTINGS.deduplicationRules, true, false);
    render(<ActiveWindowsPage service={service} settingsService={settingsService} />);

    expect(await screen.findByRole('button', { name: 'Close duplicate tabs 1' })).toBeEnabled();
  });

  it('deduplicates different Notion views after the preset is enabled', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({
                active: true,
                id: 101,
                url: 'https://notion.com/p/acme/Project-Plan-3098e50b62b080f9a0a7f74cb093713f',
              }),
            ],
          }),
          createManagedWindow({
            focused: false,
            id: 2,
            isCurrent: false,
            label: 'Window 2',
            tabs: [
              createManagedTab({
                id: 201,
                url: 'https://notion.com/p/acme/Project-Plan-3098e50b62b080f9a0a7f74cb093713f?showMoveTo=true#block-one',
                windowId: 2,
              }),
              createManagedTab({
                id: 202,
                index: 1,
                url: 'https://notion.com/p/acme/Project-Plan-3098e50b62b080f9a0a7f74cb093713f?saveParent=true#block-two',
                windowId: 2,
              }),
            ],
          }),
        ],
      }),
    );
    vi.mocked(service.closeTabs).mockResolvedValue({ closedTabIds: [201, 202], failures: [] });
    const enabledPresetRules = DEFAULT_SETTINGS.deduplicationRules.map((rule) => ({
      ...rule,
      enabled: true,
    }));
    render(
      <ActiveWindowsPage
        service={service}
        settingsService={createSettingsService(enabledPresetRules)}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Close duplicate tabs 2' }));

    expect(service.closeTabs).toHaveBeenCalledWith([201, 202]);
  });

  it('drags a tab to an exact position in another window without creating a third window', async () => {
    const service = createService();
    render(<ActiveWindowsPage service={service} />);
    const sourceButton = await screen.findByRole('button', { name: 'Focus Quarterly plan' });
    const destinationRow = screen.getByRole('button', { name: 'Focus Reference' }).closest('li');
    const destinationList = destinationRow?.closest('ul');
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: vi.fn(),
    } as unknown as DataTransfer;

    expect(sourceButton).toHaveAttribute('draggable', 'true');
    expect(destinationRow).not.toBeNull();
    expect(destinationList).not.toBeNull();
    fireEvent.dragStart(sourceButton, { dataTransfer });
    fireEvent.dragOver(destinationRow as HTMLElement, { clientY: -1, dataTransfer });
    fireEvent.drop(destinationList as HTMLElement, { dataTransfer });
    fireEvent.dragEnd(sourceButton, { dataTransfer });

    await waitFor(() => expect(service.moveTab).toHaveBeenCalledWith(101, 2, 0, null));
    expect(service.moveTabsToNewWindow).not.toHaveBeenCalled();
  });

  it('joins an existing group when a tab is dropped on one of its rows', async () => {
    const service = createService();
    render(<ActiveWindowsPage service={service} />);
    const sourceButton = await screen.findByRole('button', { name: 'Focus Reference' });
    const firstGroupRow = screen
      .getByRole('button', { name: 'Focus Quarterly plan' })
      .closest('li');
    const secondGroupRow = screen
      .getByRole('button', { name: 'Focus Issue tracker' })
      .closest('li');
    const destinationList = firstGroupRow?.closest('ul');
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(sourceButton, { dataTransfer });
    fireEvent.dragOver(firstGroupRow as HTMLElement, { clientY: -1, dataTransfer });
    expect(firstGroupRow).toHaveClass('is-tab-group-drop-target');
    expect(secondGroupRow).toHaveClass('is-tab-group-drop-target');
    fireEvent.drop(destinationList as HTMLElement, { dataTransfer });
    fireEvent.dragEnd(sourceButton, { dataTransfer });

    await waitFor(() => expect(service.moveTab).toHaveBeenCalledWith(201, 1, 0, 7));
    expect(service.moveTabsToNewWindow).not.toHaveBeenCalled();
  });

  it('drags a group heading into another window as one group', async () => {
    const service = createService();
    render(<ActiveWindowsPage service={service} />);
    const groupHeading = await screen.findByRole('button', {
      name: 'Focus first tab in Planning',
    });
    const firstGroupRow = screen
      .getByRole('button', { name: 'Focus Quarterly plan' })
      .closest('li');
    const secondGroupRow = screen
      .getByRole('button', { name: 'Focus Issue tracker' })
      .closest('li');
    const destinationRow = screen.getByRole('button', { name: 'Focus Reference' }).closest('li');
    const destinationList = destinationRow?.closest('ul');
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: vi.fn(),
    } as unknown as DataTransfer;

    expect(groupHeading).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(groupHeading, { dataTransfer });
    expect(firstGroupRow).toHaveClass('is-dragging');
    expect(secondGroupRow).toHaveClass('is-dragging');
    fireEvent.dragOver(destinationRow as HTMLElement, { clientY: -1, dataTransfer });
    fireEvent.drop(destinationList as HTMLElement, { dataTransfer });
    fireEvent.dragEnd(groupHeading, { dataTransfer });
    fireEvent.click(groupHeading);

    await waitFor(() => expect(service.moveTabGroup).toHaveBeenCalledWith(7, 2, 0));
    expect(service.focusTab).not.toHaveBeenCalled();
    expect(service.moveTab).not.toHaveBeenCalled();
    expect(service.moveTabsToNewWindow).not.toHaveBeenCalled();
  });

  it('keeps dragged groups separate when they are dropped on another group', async () => {
    const service = createService();
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            groups: [
              {
                collapsed: false,
                color: 'pink',
                id: 7,
                title: 'Planning',
                windowId: 1,
              },
            ],
            tabs: [
              createManagedTab({ active: true, groupId: 7, id: 101, title: 'Plan A' }),
              createManagedTab({ groupId: 7, id: 102, index: 1, title: 'Plan B' }),
            ],
          }),
          createManagedWindow({
            focused: false,
            groups: [
              {
                collapsed: false,
                color: 'blue',
                id: 8,
                title: 'Research',
                windowId: 2,
              },
            ],
            id: 2,
            isCurrent: false,
            label: 'Window 2',
            tabs: [
              createManagedTab({ groupId: 8, id: 201, title: 'Research A', windowId: 2 }),
              createManagedTab({
                groupId: 8,
                id: 202,
                index: 1,
                title: 'Research B',
                windowId: 2,
              }),
            ],
          }),
        ],
      }),
    );
    render(<ActiveWindowsPage service={service} />);
    const sourceHeading = await screen.findByRole('button', {
      name: 'Focus first tab in Planning',
    });
    const destinationRow = screen.getByRole('button', { name: 'Focus Research A' }).closest('li');
    const destinationList = destinationRow?.closest('ul');
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(sourceHeading, { dataTransfer });
    fireEvent.dragOver(destinationRow as HTMLElement, { clientY: -1, dataTransfer });
    expect(destinationRow).not.toHaveClass('is-tab-group-drop-target');
    fireEvent.drop(destinationList as HTMLElement, { dataTransfer });
    fireEvent.dragEnd(sourceHeading, { dataTransfer });

    await waitFor(() => expect(service.moveTabGroup).toHaveBeenCalledWith(7, 2, 0));
    expect(service.moveTab).not.toHaveBeenCalled();
  });

  it('moves every group tab when its heading is dropped into New window', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.moveTabsToNewWindow).mockResolvedValue({
      destinationWindowId: 9,
      failures: [],
      movedTabIds: [101, 102],
      warnings: [],
    });
    render(<ActiveWindowsPage service={service} />);
    await user.type(
      await screen.findByRole('searchbox', { name: 'Filter tabs by title or URL' }),
      'Quarterly',
    );
    const groupHeading = await screen.findByRole('button', {
      name: 'Focus first tab in Planning',
    });
    const page = screen.getByRole('region', { name: 'Active browser windows' });
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(groupHeading, { dataTransfer });
    fireEvent.dragOver(page, { dataTransfer });
    const newWindowTarget = screen.getByRole('status', { name: 'New window drop target' });
    fireEvent.drop(newWindowTarget, { dataTransfer });
    fireEvent.dragEnd(groupHeading, { dataTransfer });

    await waitFor(() => expect(service.moveTabsToNewWindow).toHaveBeenCalledWith([101, 102], [7]));
    expect(service.moveTabGroup).not.toHaveBeenCalled();
    expect(service.moveTabsToNewWindow).toHaveBeenCalledTimes(1);
  });

  it('cancels a drag without moving the tab when no drop occurs', async () => {
    const service = createService();
    vi.mocked(service.moveTabsToNewWindow).mockResolvedValue({
      destinationWindowId: 9,
      failures: [],
      movedTabIds: [101],
      warnings: [],
    });
    render(<ActiveWindowsPage service={service} />);
    const sourceButton = await screen.findByRole('button', { name: 'Focus Quarterly plan' });
    const destinationRow = screen.getByRole('button', { name: 'Focus Reference' }).closest('li');
    const destinationCard = destinationRow?.closest('article');
    const page = screen.getByRole('region', { name: 'Active browser windows' });
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(sourceButton, { dataTransfer });
    fireEvent.dragOver(destinationRow as HTMLElement, { clientY: -1, dataTransfer });
    expect(destinationCard).toHaveClass('is-drop-target');
    expect(destinationCard?.querySelector('.tab-drop-indicator')).not.toBeNull();

    fireEvent.dragOver(page, { clientX: 40, clientY: 40, dataTransfer });
    expect(destinationCard).not.toHaveClass('is-drop-target');
    expect(destinationCard?.querySelector('.tab-drop-indicator')).toBeNull();
    const newWindowTarget = screen.getByRole('status', { name: 'New window drop target' });
    expect(newWindowTarget).toHaveClass('new-window-drop-zone');
    expect(newWindowTarget.closest('.window-grid-column')).not.toBeNull();

    fireEvent.dragOver(destinationRow as HTMLElement, { clientY: -1, dataTransfer });
    expect(
      screen.queryByRole('status', { name: 'New window drop target' }),
    ).not.toBeInTheDocument();
    expect(destinationCard).toHaveClass('is-drop-target');

    fireEvent.dragOver(page, { clientX: 40, clientY: 40, dataTransfer });
    expect(screen.getByRole('status', { name: 'New window drop target' })).toBeInTheDocument();
    fireEvent.dragEnd(sourceButton, { dataTransfer });

    expect(service.moveTabsToNewWindow).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('status', { name: 'New window drop target' }),
    ).not.toBeInTheDocument();
  });

  it('places a dragged new window at the nearest insertion point and renumbers cards', async () => {
    const service = createService();
    const initialSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          tabs: [createManagedTab({ active: true, id: 101, title: 'Source tab' })],
        }),
        createManagedWindow({
          focused: false,
          id: 2,
          isCurrent: false,
          label: 'Window 2',
          tabs: [createManagedTab({ id: 201, title: 'First neighbor', windowId: 2 })],
        }),
        createManagedWindow({
          focused: false,
          id: 3,
          isCurrent: false,
          label: 'Window 3',
          tabs: [createManagedTab({ id: 301, title: 'Second neighbor', windowId: 3 })],
        }),
      ],
    });
    const refreshedSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          tabs: [createManagedTab({ active: true, id: 102, title: 'Weaver' })],
        }),
        initialSnapshot.windows[1] as ReturnType<typeof createManagedWindow>,
        initialSnapshot.windows[2] as ReturnType<typeof createManagedWindow>,
        createManagedWindow({
          focused: false,
          id: 9,
          isCurrent: false,
          label: 'Window 4',
          tabs: [createManagedTab({ id: 101, title: 'Moved tab', windowId: 9 })],
        }),
      ],
    });
    vi.mocked(service.loadSnapshot)
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValue(refreshedSnapshot);
    vi.mocked(service.moveTabsToNewWindow).mockResolvedValue({
      destinationWindowId: 9,
      failures: [],
      movedTabIds: [101],
      warnings: [],
    });
    render(<ActiveWindowsPage service={service} />);
    const sourceButton = await screen.findByRole('button', { name: 'Focus Source tab' });
    const page = screen.getByRole('region', { name: 'Active browser windows' });
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: vi.fn(),
    } as unknown as DataTransfer;
    const cardBounds = new Map([
      [1, { bottom: 80, left: 0, right: 400, top: 0 }],
      [2, { bottom: 180, left: 0, right: 400, top: 100 }],
      [3, { bottom: 340, left: 0, right: 400, top: 260 }],
    ]);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return (cardBounds.get(Number(this.dataset.windowId)) ?? {
        bottom: 0,
        left: 0,
        right: 0,
        top: 0,
      }) as DOMRect;
    });

    fireEvent.dragStart(sourceButton, { dataTransfer });
    const dragOverEvent = createEvent.dragOver(page, { dataTransfer });
    Object.defineProperties(dragOverEvent, {
      clientX: { value: 100 },
      clientY: { value: 220 },
    });
    fireEvent(page, dragOverEvent);
    const newWindowTarget = screen.getByRole('status', { name: 'New window drop target' });
    const firstNeighborCard = screen
      .getByRole('button', { name: 'Focus First neighbor' })
      .closest('article');
    expect(newWindowTarget).toHaveClass('new-window-drop-zone');
    expect(newWindowTarget.closest('.window-grid-column')).not.toBeNull();
    expect(firstNeighborCard?.nextElementSibling).toBe(newWindowTarget);

    cardBounds.set(2, { bottom: 520, left: 0, right: 400, top: 440 });
    cardBounds.set(3, { bottom: 180, left: 0, right: 400, top: 100 });
    fireEvent(page, dragOverEvent);
    expect(screen.getByRole('status', { name: 'New window drop target' })).toBe(newWindowTarget);
    expect(firstNeighborCard?.nextElementSibling).toBe(newWindowTarget);

    fireEvent.drop(newWindowTarget, { dataTransfer });
    fireEvent.dragEnd(sourceButton, { dataTransfer });

    const movedCard = (await screen.findByRole('button', { name: 'Focus Moved tab' })).closest(
      'article',
    );
    const secondNeighborCard = screen
      .getByRole('button', { name: 'Focus Second neighbor' })
      .closest('article');
    expect(
      within(movedCard as HTMLElement).getByRole('heading', { name: 'Window 3' }),
    ).toBeVisible();
    expect(
      within(secondNeighborCard as HTMLElement).getByRole('heading', { name: 'Window 4' }),
    ).toBeVisible();
  });

  it('requires deliberate pointer movement before changing the New window insertion point', async () => {
    const service = createService();
    render(<ActiveWindowsPage service={service} />);
    const sourceButton = await screen.findByRole('button', { name: 'Focus Quarterly plan' });
    const page = screen.getByRole('region', { name: 'Active browser windows' });
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: vi.fn(),
    } as unknown as DataTransfer;
    const cardBounds = new Map([
      [1, { bottom: 80, left: 0, right: 400, top: 0 }],
      [2, { bottom: 180, left: 0, right: 400, top: 100 }],
    ]);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return (cardBounds.get(Number(this.dataset.windowId)) ?? {
        bottom: 0,
        left: 0,
        right: 0,
        top: 0,
      }) as DOMRect;
    });
    const dragOverPage = (clientX: number, clientY: number) => {
      const event = createEvent.dragOver(page, { dataTransfer });
      Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: clientY },
      });
      fireEvent(page, event);
    };

    fireEvent.dragStart(sourceButton, { dataTransfer });
    dragOverPage(500, 90);
    const firstTarget = screen.getByRole('status', { name: 'New window drop target' });
    const currentWindowCard = screen
      .getByRole('button', { name: 'Focus Quarterly plan' })
      .closest('article');
    const secondWindowCard = screen
      .getByRole('button', { name: 'Focus Reference' })
      .closest('article');
    expect(currentWindowCard?.nextElementSibling).toBe(firstTarget);

    dragOverPage(500, 150);
    dragOverPage(500, 155);
    expect(currentWindowCard?.nextElementSibling).toBe(firstTarget);

    dragOverPage(500, 163);
    const secondTarget = screen.getByRole('status', { name: 'New window drop target' });
    expect(secondTarget).toHaveAttribute('data-anchor-window-id', '2');
    expect(secondWindowCard?.nextElementSibling).toBe(secondTarget);
  });

  it('shows the initial error and recovers through Retry', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.loadSnapshot)
      .mockRejectedValueOnce(new Error('Permission unavailable'))
      .mockResolvedValueOnce(createActiveWindowsSnapshot());
    render(<ActiveWindowsPage service={service} />);

    expect(
      await screen.findByRole('heading', { name: 'Could not load browser windows' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Permission unavailable')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Window 1' })).toBeInTheDocument();
    });
  });

  it('names and saves a window from its card without closing the source', async () => {
    const user = userEvent.setup();
    const savedWindowsService = createSavedWindowsService();
    render(
      <ActiveWindowsPage savedWindowsService={savedWindowsService} service={createService()} />,
    );

    const saveTrigger = await screen.findByRole('button', {
      name: 'Save Window 1',
    });
    await user.click(saveTrigger);
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    const nameInput = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.type(nameInput, 'Project work');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(savedWindowsService.saveWindow).toHaveBeenCalledWith(1, 'Project work', false),
    );
    expect(screen.queryByRole('dialog', { name: 'Save window' })).not.toBeInTheDocument();
    expect(screen.getByText('Saved "Project work".')).toBeInTheDocument();
    expect(saveTrigger).toHaveFocus();
  });

  it('keeps the save dialog open when storage rejects Save & close', async () => {
    const user = userEvent.setup();
    const savedWindowsService = createSavedWindowsService();
    vi.mocked(savedWindowsService.saveWindow).mockRejectedValue(
      new Error('Storage quota exceeded'),
    );
    render(
      <ActiveWindowsPage savedWindowsService={savedWindowsService} service={createService()} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Project work');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

    expect(await within(dialog).findByText('Storage quota exceeded')).toBeInTheDocument();
    expect(savedWindowsService.saveWindow).toHaveBeenCalledWith(1, 'Project work', true);
    expect(screen.getByRole('dialog', { name: 'Save window' })).toBeInTheDocument();
  });
});
