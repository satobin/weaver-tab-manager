import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { type TabSortOptions } from '../features/active-windows/tabSort';
import { type SavedWindow } from '../features/saved-windows/savedWindowModel';
import {
  DEFAULT_DEDUPLICATION_RULES,
  type DedupeRule,
} from '../features/deduplication/deduplication';
import {
  deduplicateSavedWindows,
  mergeSavedWindows,
  moveSelectedSavedTabsToNewWindow,
  removeSelectedSavedTabs,
  sortSavedWindows,
  type SavedTabSelectionReference,
} from '../features/saved-windows/savedWindowOperations';
import {
  SavedWindowsMutationConflictError,
  type SavedWindowsMutationUndo,
  type SavedWindowsService,
} from '../features/saved-windows/savedWindowsService';
import {
  DEFAULT_SETTINGS,
  type SettingsService,
  type WeaverSettings,
} from '../features/settings/settingsService';
import { SavedWindowsPage } from './SavedWindowsPage';

function createSavedWindow(overrides: Partial<SavedWindow> = {}): SavedWindow {
  return {
    createdAt: '2026-07-10T20:00:00.000Z',
    groups: [
      {
        collapsed: true,
        color: 'purple',
        key: 'group-1',
        title: 'Planning',
      },
    ],
    id: 'saved-1',
    name: 'Research',
    tabs: [
      {
        active: false,
        order: 0,
        pinned: true,
        title: 'Inbox',
        url: 'https://mail.example.com/',
      },
      {
        active: true,
        groupKey: 'group-1',
        order: 1,
        pinned: false,
        title: 'Plan',
        url: 'https://docs.example.com/plan',
      },
    ],
    updatedAt: '2026-07-10T20:00:00.000Z',
    ...overrides,
  };
}

function createService(
  initialWindows: SavedWindow[] = [createSavedWindow()],
  restoreWarnings: string[] = [],
) {
  let windows = initialWindows;
  const service: SavedWindowsService = {
    deduplicateTabs: vi.fn((rules: readonly DedupeRule[]) => {
      const beforeWindows = windows;
      const transformed = deduplicateSavedWindows(windows, rules, '2026-07-10T22:00:00.000Z');
      windows = transformed.windows;
      return Promise.resolve({
        ...transformed.result,
        undo:
          transformed.result.removedTabCount > 0 ? { afterWindows: windows, beforeWindows } : null,
      });
    }),
    deleteWindow: vi.fn((savedWindowId: string) => {
      windows = windows.filter((savedWindow) => savedWindow.id !== savedWindowId);
      return Promise.resolve();
    }),
    keepWindow: vi.fn((savedWindow: SavedWindow) => {
      if (!windows.some((window) => window.id === savedWindow.id)) {
        windows = [savedWindow, ...windows];
      }
      return Promise.resolve(savedWindow);
    }),
    load: vi.fn(() => Promise.resolve(windows)),
    mergeWindows: vi.fn((savedWindowIds: readonly string[], name: string) => {
      const beforeWindows = windows;
      const transformed = mergeSavedWindows(
        windows,
        savedWindowIds,
        name,
        '2026-07-10T22:00:00.000Z',
      );
      windows = transformed.windows;
      return Promise.resolve({
        ...transformed.result,
        undo: { afterWindows: windows, beforeWindows },
      });
    }),
    moveSelectedTabsToNewWindow: vi.fn(
      (tabs: readonly SavedTabSelectionReference[], name: string) => {
        const beforeWindows = windows;
        const transformed = moveSelectedSavedTabsToNewWindow(
          windows,
          tabs,
          name,
          'saved-moved',
          '2026-07-10T22:00:00.000Z',
        );
        windows = transformed.windows;
        return Promise.resolve({
          ...transformed.result,
          undo: { afterWindows: windows, beforeWindows },
        });
      },
    ),
    openTab: vi.fn(() => Promise.resolve(42)),
    removeSelectedTabs: vi.fn((tabs: readonly SavedTabSelectionReference[]) => {
      const beforeWindows = windows;
      const transformed = removeSelectedSavedTabs(windows, tabs, '2026-07-10T22:00:00.000Z');
      windows = transformed.windows;
      return Promise.resolve({
        ...transformed.result,
        undo: { afterWindows: windows, beforeWindows },
      });
    }),
    renameWindow: vi.fn((savedWindowId: string, name: string) => {
      const existing = windows.find((savedWindow) => savedWindow.id === savedWindowId);
      if (!existing) {
        return Promise.reject(new Error('Missing saved window'));
      }
      const renamed = { ...existing, name, updatedAt: '2026-07-10T21:00:00.000Z' };
      windows = windows.map((savedWindow) =>
        savedWindow.id === savedWindowId ? renamed : savedWindow,
      );
      return Promise.resolve(renamed);
    }),
    restoreWindow: vi.fn((savedWindowId: string) => {
      windows = windows.filter((savedWindow) => savedWindow.id !== savedWindowId);
      return Promise.resolve({
        destinationWindowId: 9,
        failures: [],
        restoredTabCount: 2,
        savedWindowRemoved: true,
        warnings: restoreWarnings,
      });
    }),
    saveWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    sortAllWindows: vi.fn((options: TabSortOptions) => {
      const beforeWindows = windows;
      const transformed = sortSavedWindows(windows, null, options, '2026-07-10T22:00:00.000Z');
      windows = transformed.windows;
      return Promise.resolve({
        ...transformed.result,
        undo:
          transformed.result.sortedWindowIds.length > 0
            ? { afterWindows: windows, beforeWindows }
            : null,
      });
    }),
    sortWindow: vi.fn((savedWindowId: string, options: TabSortOptions) => {
      const beforeWindows = windows;
      const transformed = sortSavedWindows(
        windows,
        [savedWindowId],
        options,
        '2026-07-10T22:00:00.000Z',
      );
      windows = transformed.windows;
      return Promise.resolve({
        ...transformed.result,
        undo:
          transformed.result.sortedWindowIds.length > 0
            ? { afterWindows: windows, beforeWindows }
            : null,
      });
    }),
    subscribe: vi.fn(() => () => undefined),
    undoMutation: vi.fn((undo: SavedWindowsMutationUndo) => {
      windows = [...undo.beforeWindows];
      return Promise.resolve();
    }),
  };
  return service;
}

function createSettingsService(overrides: Partial<WeaverSettings> = {}): SettingsService {
  const settings: WeaverSettings = {
    ...DEFAULT_SETTINGS,
    deduplicationRules: DEFAULT_SETTINGS.deduplicationRules.map((rule) => ({ ...rule })),
    ...overrides,
  };
  return {
    load: vi.fn(() => Promise.resolve(settings)),
    setAdvancedDuplicateMatchingEnabled: vi.fn(() => Promise.resolve(settings)),
    setColorMode: vi.fn(() => Promise.resolve(settings)),
    setDeduplicationRules: vi.fn(() => Promise.resolve(settings)),
    setShowTabUrls: vi.fn(() => Promise.resolve(settings)),
    subscribe: vi.fn(() => () => undefined),
  };
}

function createDeferred<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
  };
}

describe('SavedWindowsPage', () => {
  it('renders an empty state when there are no saved windows', async () => {
    const user = userEvent.setup();
    const { container } = render(<SavedWindowsPage service={createService([])} />);

    expect(await screen.findByRole('heading', { name: 'No saved windows' })).toBeInTheDocument();
    expect(screen.getByText('0 saved windows · 0 tabs')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh saved windows' })).not.toBeInTheDocument();
    expect(container.querySelector('.saved-windows-toolbar')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Remove duplicate tabs from Saved Windows: 0 tabs',
      }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Merge saved windows' })).toBeDisabled();

    await user.type(
      screen.getByRole('searchbox', { name: 'Filter saved windows, groups, and tabs' }),
      'missing',
    );
    expect(screen.getByRole('heading', { name: 'No saved windows' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No saved items match' })).not.toBeInTheDocument();
  });

  it('renders saved-window totals in the shared header target', async () => {
    const headerTarget = document.createElement('div');
    const actionTarget = document.createElement('div');
    const { container } = render(
      <SavedWindowsPage
        actionPortalTarget={actionTarget}
        headerPortalTarget={headerTarget}
        service={createService()}
      />,
    );

    await waitFor(() => expect(headerTarget).toHaveTextContent('1 saved window · 2 tabs'));
    expect(actionTarget).toHaveTextContent('Remove duplicate tabs');
    expect(actionTarget).toHaveTextContent('Merge saved windows');
    expect(container.querySelector('.saved-window-header-status')).not.toBeInTheDocument();
    expect(container.querySelector('.saved-windows-toolbar')).not.toBeInTheDocument();
  });

  it('reports its loaded count and clears page ownership when it unmounts', async () => {
    const onWindowCountChange = vi.fn();
    const { unmount } = render(
      <SavedWindowsPage
        onWindowCountChange={onWindowCountChange}
        service={createService([createSavedWindow(), createSavedWindow({ id: 'saved-2' })])}
      />,
    );

    await waitFor(() => expect(onWindowCountChange).toHaveBeenLastCalledWith(2));
    unmount();
    expect(onWindowCountChange).toHaveBeenLastCalledWith(null);
  });

  it('sorts one saved window or every saved window by Title or URL', async () => {
    const user = userEvent.setup();
    const research = createSavedWindow({
      groups: [],
      tabs: [
        {
          active: false,
          order: 0,
          pinned: true,
          title: 'Pinned',
          url: 'https://example.com/pinned',
        },
        {
          active: true,
          order: 1,
          pinned: false,
          title: 'Zulu',
          url: 'https://example.com/alpha-url',
        },
        {
          active: false,
          order: 2,
          pinned: false,
          title: 'Alpha',
          url: 'https://example.com/zulu-url',
        },
      ],
    });
    const notes = createSavedWindow({
      groups: [],
      id: 'saved-2',
      name: 'Notes',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Beta',
          url: 'https://example.com/zulu',
        },
        {
          active: false,
          order: 1,
          pinned: false,
          title: 'Delta',
          url: 'https://example.com/alpha',
        },
      ],
    });
    const service = createService([research, notes]);
    render(<SavedWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Expand Research' }));
    let researchCard = screen.getByRole('article', { name: 'Research' });
    const researchSort = within(researchCard).getByRole('button', {
      name: 'Sort Research by Title, A to Z',
    });
    expect(researchSort.querySelector('.lucide-arrow-up-down')).toBeInTheDocument();
    await user.click(researchSort);

    expect(service.sortWindow).toHaveBeenCalledWith('saved-1', {
      criterion: 'title',
      direction: 'asc',
    });
    researchCard = screen.getByRole('article', { name: 'Research' });
    expect(
      [...researchCard.querySelectorAll('.saved-tab-row .saved-tab-copy strong')].map(
        (element) => element.textContent,
      ),
    ).toEqual(['Pinned', 'Alpha', 'Zulu']);
    const reverseResearchSort = within(researchCard).getByRole('button', {
      name: 'Sort Research by Title, Z to A',
    });
    expect(reverseResearchSort).toHaveAccessibleDescription('Currently sorted by Title, A to Z.');
    expect(reverseResearchSort.querySelector('.lucide-arrow-up')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sort all saved windows by: Title' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'URL' }));
    await user.click(screen.getByRole('button', { name: 'Sort all saved windows by URL, A to Z' }));

    expect(service.sortAllWindows).toHaveBeenCalledWith({
      criterion: 'url',
      direction: 'asc',
    });
    expect(
      await screen.findByRole('button', { name: 'Sort all saved windows by URL, Z to A' }),
    ).toHaveAccessibleDescription('Currently sorted by URL, A to Z.');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('sorts the full saved window while a tab filter is active and disables sorting for selection', async () => {
    const user = userEvent.setup();
    const service = createService([
      createSavedWindow({
        groups: [],
        tabs: [
          {
            active: true,
            order: 0,
            pinned: false,
            title: 'Zulu',
            url: 'https://example.com/zulu',
          },
          {
            active: false,
            order: 1,
            pinned: false,
            title: 'Alpha',
            url: 'https://example.com/alpha',
          },
        ],
      }),
    ]);
    render(<SavedWindowsPage service={service} />);

    const search = await screen.findByRole('searchbox', {
      name: 'Filter saved windows, groups, and tabs',
    });
    await user.click(screen.getByRole('button', { name: 'Expand Research' }));
    await user.type(search, 'alpha');
    const card = screen.getByRole('article', { name: 'Research' });
    await user.click(within(card).getByRole('button', { name: 'Sort Research by Title, A to Z' }));
    expect(service.sortWindow).toHaveBeenCalledWith('saved-1', {
      criterion: 'title',
      direction: 'asc',
    });
    expect(search).toHaveValue('alpha');

    await user.click(screen.getByRole('button', { name: 'Clear saved-tab filter' }));
    const sortedCard = screen.getByRole('article', { name: 'Research' });
    expect(
      [...sortedCard.querySelectorAll('.saved-tab-row .saved-tab-copy strong')].map(
        (element) => element.textContent,
      ),
    ).toEqual(['Alpha', 'Zulu']);

    await user.type(search, 'alpha');
    await user.click(screen.getByRole('button', { name: 'Select filtered 1' }));
    expect(screen.getByRole('button', { name: 'Sort all saved windows by: Title' })).toBeDisabled();
    expect(
      within(screen.getByRole('article', { name: 'Research' })).getByRole('button', {
        name: 'Sort Research by: Title',
      }),
    ).toBeDisabled();
  });

  it('keeps filtered saved windows collapsible and restores their normal collapse state', async () => {
    const user = userEvent.setup();
    render(<SavedWindowsPage service={createService()} />);

    const card = await screen.findByRole('article', { name: 'Research' });
    const preview = document.getElementById('saved-window-saved-1-preview');
    expect(card).toHaveClass('is-collapsed');
    expect(card).not.toHaveClass('is-compact-tabs');
    expect(preview).toHaveAttribute('hidden');

    const search = screen.getByRole('searchbox', {
      name: 'Filter saved windows, groups, and tabs',
    });
    await user.type(search, 'plan');

    const collapse = within(card).getByRole('button', { name: 'Collapse Research' });
    expect(collapse).toHaveAttribute('aria-controls', 'saved-window-saved-1-preview');
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Plan')).toBeInTheDocument();

    await user.click(collapse);
    expect(within(card).getByRole('button', { name: 'Expand Research' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(card).toHaveClass('is-collapsed');
    expect(preview).toHaveAttribute('hidden');
    expect(screen.queryByText('Plan')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear saved-tab filter' }));
    expect(within(card).getByRole('button', { name: 'Expand Research' })).toBeInTheDocument();
    expect(screen.queryByText('Inbox')).not.toBeInTheDocument();

    await user.type(search, 'plan');
    expect(within(card).getByRole('button', { name: 'Collapse Research' })).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
  });

  it('uses the Active Windows card and tab visual primitives for saved windows', async () => {
    const user = userEvent.setup();
    render(
      <SavedWindowsPage
        service={createService()}
        settingsService={createSettingsService({ showTabUrls: false })}
      />,
    );

    const card = await screen.findByRole('article', { name: 'Research' });
    const header = card.querySelector(':scope > .window-card-header');
    const collapse = within(card).getByRole('button', { name: 'Expand Research' });
    expect(card).toHaveClass('window-card', 'saved-window-card', 'is-collapsed');
    expect(header).toBeInTheDocument();
    expect(header?.querySelector('.window-identity')).toBeInTheDocument();
    expect(header?.querySelector('.window-heading-copy')).toBeInTheDocument();
    expect(header?.querySelector('.window-card-actions')).toBeInTheDocument();
    const heading = within(card).getByRole('heading', { name: 'Research' });
    const headingName = heading.querySelector('.window-heading-static');
    const collapseState = heading.querySelector('.window-collapse-state');
    expect(headingName).toHaveTextContent('Research');
    expect(headingName?.nextElementSibling).toBe(collapseState);
    expect(collapse.parentElement).toBe(header);
    expect(collapse).not.toContainElement(
      within(card).getByRole('button', { name: 'Sort Research by: Title' }),
    );
    expect(within(card).getByRole('button', { name: 'Restore Research' })).toHaveTextContent(
      'Restore',
    );

    await user.click(collapse);

    const list = card.querySelector('.saved-tab-list');
    const planRow = screen.getByText('Plan').closest('.saved-tab-row');
    const planItem = planRow?.closest('.tab-list-item');
    expect(list).toHaveClass('tab-list');
    expect(planItem).toHaveClass('group-color-purple');
    expect(planItem?.querySelector('.tab-group-heading')).toBeInTheDocument();
    expect(planRow).toHaveClass('tab-row');
    expect(card.querySelector('.saved-tab-order')).not.toBeInTheDocument();
    expect(screen.getByText('Plan')).toHaveClass('tab-title');
    expect(await screen.findByText('docs.example.com/plan')).toHaveClass('tab-location');
    expect(within(card).getByRole('button', { name: 'Open Plan in a new tab' })).toHaveClass(
      'tab-focus-button',
    );
    expect(
      within(card).getByRole('button', {
        name: 'Remove Plan from Research, saved tab 2',
      }),
    ).toHaveClass('tab-close-button');
  });

  it('filters saved tabs, selects the visible matches, removes them, and offers Undo', async () => {
    const user = userEvent.setup();
    const service = createService();
    const originalRemove: SavedWindowsService['removeSelectedTabs'] = service.removeSelectedTabs;
    const refreshGate = createDeferred<SavedWindow[]>();
    let updatedWindows: SavedWindow[] = [];
    vi.mocked(service.removeSelectedTabs).mockImplementationOnce(async (references) => {
      const result = await originalRemove(references);
      updatedWindows = await service.load();
      vi.mocked(service.load).mockImplementationOnce(() => refreshGate.promise);
      return result;
    });
    render(<SavedWindowsPage service={service} settingsService={createSettingsService()} />);

    const search = await screen.findByRole('searchbox', {
      name: 'Filter saved windows, groups, and tabs',
    });
    const selectFiltered = screen.getByRole('button', { name: 'Select filtered 2' });
    expect(selectFiltered).toBeDisabled();

    await user.type(search, 'plan');

    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.queryByText('Inbox')).not.toBeInTheDocument();
    expect(screen.getByText(/1 matching tab of 2 tabs · Saved/)).toBeInTheDocument();
    const filteredSelection = screen.getByRole('button', { name: 'Select filtered 1' });
    expect(filteredSelection).toBeEnabled();
    await user.click(filteredSelection);

    expect(screen.getByRole('checkbox', { name: 'Select Plan in Research' })).toBeChecked();
    const removeTabs = screen.getByRole('button', { name: 'Remove tabs 1' });
    const moveTabs = screen.getByRole('button', { name: 'Move to new saved window 1' });
    expect(removeTabs).toBeEnabled();
    expect(moveTabs).toBeEnabled();
    expect(moveTabs.compareDocumentPosition(removeTabs)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole('button', { name: 'Open Plan in a new tab' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Remove Plan from Research, saved tab 2' }),
    ).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Remove tabs 1' }));

    expect(service.removeSelectedTabs).toHaveBeenCalledWith([
      {
        expectedTab: {
          active: true,
          groupKey: 'group-1',
          order: 1,
          pinned: false,
          title: 'Plan',
          url: 'https://docs.example.com/plan',
        },
        expectedWindowUpdatedAt: '2026-07-10T20:00:00.000Z',
        tabOrder: 1,
        windowId: 'saved-1',
      },
    ]);
    const busyRemove = screen.getByRole('button', { name: 'Remove tabs 1' });
    await waitFor(() => expect(busyRemove).toHaveAttribute('aria-busy', 'true'));
    expect(busyRemove).toHaveTextContent('1');
    expect(screen.getByText('Removing 1 selected tab from Saved Windows')).toBeInTheDocument();
    refreshGate.resolve(updatedWindows);
    expect(
      await screen.findByText('Removed 1 selected tab from Saved Windows.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No saved items match' })).toBeInTheDocument();

    const undo = screen.getByRole('button', { name: 'Undo' });
    await waitFor(() => expect(undo).toHaveFocus());
    await user.click(undo);

    expect(await screen.findByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Restored 1 tab to its original saved window.')).toBeInTheDocument();
  });

  it('extends saved-tab selection across one saved window with Shift', async () => {
    const user = userEvent.setup();
    const savedWindow = createSavedWindow({
      tabs: [
        {
          active: false,
          order: 0,
          pinned: true,
          title: 'Inbox',
          url: 'https://mail.example.com/',
        },
        {
          active: true,
          groupKey: 'group-1',
          order: 1,
          pinned: false,
          title: 'Plan',
          url: 'https://docs.example.com/plan',
        },
        {
          active: false,
          order: 2,
          pinned: false,
          title: 'Notes',
          url: 'https://notes.example.com/',
        },
      ],
    });
    render(
      <SavedWindowsPage
        service={createService([savedWindow])}
        settingsService={createSettingsService()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Expand Research' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Inbox in Research' }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select Notes in Research' }));
    await user.keyboard('{/Shift}');

    expect(screen.getByRole('checkbox', { name: 'Select Inbox in Research' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Plan in Research' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Notes in Research' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Move to new saved window 3' })).toBeEnabled();
  });

  it('drops a selection when a same-revision refresh reuses its former tab order', async () => {
    const user = userEvent.setup();
    let currentWindows = [createSavedWindow()];
    let listener: (() => void) | undefined;
    const service = createService(currentWindows);
    vi.mocked(service.load).mockImplementation(() => Promise.resolve(currentWindows));
    service.subscribe = vi.fn((nextListener: () => void) => {
      listener = nextListener;
      return () => undefined;
    });
    render(<SavedWindowsPage service={service} settingsService={createSettingsService()} />);

    await user.type(
      await screen.findByRole('searchbox', { name: 'Filter saved windows, groups, and tabs' }),
      'inbox',
    );
    await user.click(screen.getByRole('button', { name: 'Select filtered 1' }));
    expect(screen.getByRole('button', { name: 'Clear selected 1' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move to new saved window 1' }));
    const moveDialog = screen.getByRole('dialog', { name: 'Move to new saved window' });
    const moveName = within(moveDialog).getByRole('textbox', { name: 'New saved window name' });

    currentWindows = [
      createSavedWindow({
        tabs: [
          {
            active: true,
            groupKey: 'group-1',
            order: 0,
            pinned: false,
            title: 'Plan',
            url: 'https://docs.example.com/plan',
          },
        ],
      }),
    ];
    act(() => listener?.());

    expect(await within(moveDialog).findByRole('alert')).toHaveTextContent(
      'The selected saved tabs changed. Review the selection and try again.',
    );
    await waitFor(() => expect(moveName).toHaveFocus());
    expect(within(moveDialog).getByRole('button', { name: 'Move 1 tab' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Clear selected 1' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Remove tabs 0' })).toBeDisabled();

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', { name: 'Move to new saved window' }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveFocus());
  });

  it('blocks a pending move when only part of its original selection changes', async () => {
    const user = userEvent.setup();
    const second = createSavedWindow({
      groups: [],
      id: 'saved-2',
      name: 'Reference',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Plan follow-up',
          url: 'https://docs.example.com/plan-follow-up',
        },
      ],
    });
    let currentWindows = [createSavedWindow(), second];
    let listener: (() => void) | undefined;
    const service = createService(currentWindows);
    vi.mocked(service.load).mockImplementation(() => Promise.resolve(currentWindows));
    service.subscribe = vi.fn((nextListener: () => void) => {
      listener = nextListener;
      return () => undefined;
    });
    render(<SavedWindowsPage service={service} settingsService={createSettingsService()} />);

    await user.type(
      await screen.findByRole('searchbox', { name: 'Filter saved windows, groups, and tabs' }),
      'plan',
    );
    await user.click(screen.getByRole('button', { name: 'Select filtered 2' }));
    await user.click(screen.getByRole('button', { name: 'Move to new saved window 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Move to new saved window' });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'New saved window name' }),
      'Planning follow-up',
    );

    currentWindows = [
      createSavedWindow(),
      createSavedWindow({
        groups: [],
        id: 'saved-2',
        name: 'Reference',
        tabs: [
          {
            active: true,
            order: 0,
            pinned: false,
            title: 'Changed elsewhere',
            url: 'https://docs.example.com/changed',
          },
        ],
      }),
    ];
    act(() => listener?.());

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The selected saved tabs changed. Review the selection and try again.',
    );
    const moveButton = within(dialog).getByRole('button', { name: 'Move 2 tabs' });
    expect(moveButton).toHaveAttribute('aria-disabled', 'true');
    await user.click(moveButton);
    expect(service.moveSelectedTabsToNewWindow).not.toHaveBeenCalled();
  });

  it('moves selected matches from multiple snapshots into a newly named saved window', async () => {
    const user = userEvent.setup();
    const second = createSavedWindow({
      createdAt: '2026-07-09T20:00:00.000Z',
      groups: [],
      id: 'saved-2',
      name: 'Reference',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Plan follow-up',
          url: 'https://docs.example.com/plan-follow-up',
        },
      ],
      updatedAt: '2026-07-09T20:00:00.000Z',
    });
    const service = createService([createSavedWindow(), second]);
    const originalMove: SavedWindowsService['moveSelectedTabsToNewWindow'] =
      service.moveSelectedTabsToNewWindow;
    const refreshGate = createDeferred<SavedWindow[]>();
    let updatedWindows: SavedWindow[] = [];
    vi.mocked(service.moveSelectedTabsToNewWindow).mockImplementationOnce(
      async (references, name) => {
        const result = await originalMove(references, name);
        updatedWindows = await service.load();
        vi.mocked(service.load).mockImplementationOnce(() => refreshGate.promise);
        return result;
      },
    );
    render(<SavedWindowsPage service={service} settingsService={createSettingsService()} />);

    await user.type(
      await screen.findByRole('searchbox', { name: 'Filter saved windows, groups, and tabs' }),
      'plan',
    );
    await user.click(screen.getByRole('button', { name: 'Select filtered 2' }));
    const moveTrigger = screen.getByRole('button', { name: 'Move to new saved window 2' });
    await user.click(moveTrigger);

    let dialog = screen.getByRole('dialog', { name: 'Move to new saved window' });
    let nameInput = within(dialog).getByRole('textbox', { name: 'New saved window name' });
    expect(nameInput).toHaveFocus();
    expect(nameInput).toBeRequired();
    const disabledMove = within(dialog).getByRole('button', { name: 'Move 2 tabs' });
    expect(disabledMove).toHaveAttribute('aria-disabled', 'true');
    expect(disabledMove).toHaveAttribute('data-tooltip', 'Enter a name for the new saved window.');

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', { name: 'Move to new saved window' }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(moveTrigger).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Clear selected 2' })).toBeInTheDocument();

    await user.click(moveTrigger);
    dialog = screen.getByRole('dialog', { name: 'Move to new saved window' });
    nameInput = within(dialog).getByRole('textbox', { name: 'New saved window name' });
    await user.type(nameInput, 'Planning follow-up');
    await user.keyboard('{Enter}');

    expect(service.moveSelectedTabsToNewWindow).toHaveBeenCalledWith(
      [
        expect.objectContaining({ tabOrder: 1, windowId: 'saved-1' }),
        expect.objectContaining({ tabOrder: 0, windowId: 'saved-2' }),
      ],
      'Planning follow-up',
    );
    const busyMove = screen.getByRole('button', { name: 'Move to new saved window 2' });
    await waitFor(() => expect(busyMove).toHaveAttribute('aria-busy', 'true'));
    expect(busyMove).toHaveTextContent('2');
    expect(screen.getByText('Moving 2 selected tabs to a new saved window')).toBeInTheDocument();
    refreshGate.resolve(updatedWindows);
    expect(
      await screen.findByText(
        'Moved 2 tabs into "Planning follow-up". 1 empty saved window removed.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Planning follow-up' })).toBeInTheDocument();
    expect(screen.queryByText('Reference')).not.toBeInTheDocument();
    const undo = screen.getByRole('button', { name: 'Undo' });
    await waitFor(() => expect(undo).toHaveFocus());
    await user.click(undo);

    expect(service.undoMutation).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('article', { name: 'Reference' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Research' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Planning follow-up' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Undid the move. Restored 2 tabs to their original saved windows.'),
    ).toBeInTheDocument();
  }, 10_000);

  it('keeps the move name and selection available when moving selected tabs fails', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.moveSelectedTabsToNewWindow).mockRejectedValueOnce(
      new Error('Saved storage is busy.'),
    );
    render(<SavedWindowsPage service={service} settingsService={createSettingsService()} />);

    await user.type(
      await screen.findByRole('searchbox', { name: 'Filter saved windows, groups, and tabs' }),
      'plan',
    );
    await user.click(screen.getByRole('button', { name: 'Select filtered 1' }));
    await user.click(screen.getByRole('button', { name: 'Move to new saved window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Move to new saved window' });
    const nameInput = within(dialog).getByRole('textbox', { name: 'New saved window name' });
    await user.type(nameInput, 'Planning follow-up');
    await user.keyboard('{Enter}');

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Saved storage is busy.');
    expect(nameInput).toHaveValue('Planning follow-up');
    expect(nameInput).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Clear selected 1' })).toBeInTheDocument();
  });

  it('removes duplicates across saved windows, keeps the newer copy, and offers Undo', async () => {
    const user = userEvent.setup();
    const older = createSavedWindow({
      createdAt: '2026-07-09T20:00:00.000Z',
      groups: [],
      id: 'older',
      name: 'Older research',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Old plan',
          url: 'https://docs.example.com/plan',
        },
      ],
      updatedAt: '2026-07-09T20:00:00.000Z',
    });
    const newer = createSavedWindow({
      createdAt: '2026-07-10T20:00:00.000Z',
      groups: [],
      id: 'newer',
      name: 'Newer research',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'New plan',
          url: 'https://docs.example.com/plan',
        },
      ],
    });
    const service = createService([older, newer]);
    render(<SavedWindowsPage service={service} settingsService={createSettingsService()} />);

    const removeButton = await screen.findByRole('button', {
      name: 'Remove duplicate tabs from Saved Windows: 1 tab',
    });
    expect(removeButton).toBeEnabled();
    await user.click(removeButton);

    expect(service.deduplicateTabs).toHaveBeenCalledWith([]);
    expect(
      await screen.findByText(
        'Removed 1 duplicate tab from 1 saved window. 1 empty saved window removed.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Older research')).not.toBeInTheDocument();
    expect(screen.getByText('Newer research')).toBeInTheDocument();

    const undo = screen.getByRole('button', { name: 'Undo' });
    await waitFor(() => expect(undo).toHaveFocus());
    await user.click(undo);

    expect(service.undoMutation).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Older research')).toBeInTheDocument();
    expect(screen.getByText('Restored 1 duplicate tab to Saved Windows.')).toBeInTheDocument();
  });

  it('previews saved duplicates with the same keep and remove decisions used by cleanup', async () => {
    const user = userEvent.setup();
    const older = createSavedWindow({
      createdAt: '2026-07-09T20:00:00.000Z',
      groups: [],
      id: 'older',
      name: 'Older research',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: true,
          title: 'Old plan',
          url: 'https://docs.example.com/plan',
        },
      ],
      updatedAt: '2026-07-09T20:00:00.000Z',
    });
    const newer = createSavedWindow({
      groups: [],
      id: 'newer',
      name: 'Newer research',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'New plan',
          url: 'https://docs.example.com/plan',
        },
        {
          active: false,
          order: 1,
          pinned: false,
          title: 'New inbox',
          url: 'https://mail.example.com/',
        },
      ],
    });
    const unrelated = createSavedWindow({
      groups: [],
      id: 'unrelated',
      name: 'Unique research',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Unique tab',
          url: 'https://unique.example.com/',
        },
      ],
    });
    const service = createService([older, newer, unrelated]);
    render(<SavedWindowsPage service={service} settingsService={createSettingsService()} />);

    const previewButton = await screen.findByRole('button', {
      name: 'Show saved duplicate tabs only',
    });
    await user.click(previewButton);

    expect(previewButton).toHaveAttribute('aria-pressed', 'true');
    expect(previewButton).toHaveAccessibleName('Show saved duplicate tabs only');
    expect(previewButton).toHaveAttribute('title', 'Show all saved tabs');
    expect(screen.getByRole('status', { name: 'Saved duplicate tabs view' })).toHaveTextContent(
      'Weaver keeps the newest saved copy in each match',
    );
    expect(screen.queryByText('Unique research')).not.toBeInTheDocument();
    expect(screen.queryByText('New inbox')).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Newer research' })).toBeInTheDocument();
    const keepRow = screen.getByText('New plan').closest('.saved-tab-row');
    const removeRow = screen.getByText('Old plan').closest('.saved-tab-row');
    expect(keepRow).toHaveClass('is-duplicate-preview-keep');
    expect(within(keepRow as HTMLElement).getByText('Keep')).toBeInTheDocument();
    expect(
      within(keepRow as HTMLElement).getByRole('button', { name: /^Open New plan/ }),
    ).toHaveAttribute('aria-describedby', expect.stringContaining('duplicate-preview-description'));
    expect(removeRow).toHaveClass('is-duplicate-preview-close');
    expect(within(removeRow as HTMLElement).getByText('Remove')).toBeInTheDocument();
    expect(
      within(removeRow as HTMLElement).queryByRole('button', { name: /^Remove Old plan from/ }),
    ).not.toBeInTheDocument();
    expect(service.deduplicateTabs).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Merge saved windows' })).toBeDisabled();

    await user.click(
      within(screen.getByRole('status', { name: 'Saved duplicate tabs view' })).getByRole(
        'button',
        { name: 'Exit saved duplicate tabs view' },
      ),
    );
    await waitFor(() => expect(previewButton).toHaveFocus());
    expect(screen.getByText('Unique research')).toBeInTheDocument();
    expect(screen.queryByText('Old plan')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: 'Show saved duplicate tabs only',
      }),
    );
    const banner = screen.getByRole('status', { name: 'Saved duplicate tabs view' });
    await user.click(within(banner).getByRole('button', { name: 'Remove duplicate tabs: 1 tab' }));

    expect(service.deduplicateTabs).toHaveBeenCalledWith([]);
    expect(await screen.findByRole('heading', { name: 'No duplicate tabs' })).toBeInTheDocument();
    expect(screen.queryByText('Old plan')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Old plan')).toBeInTheDocument();
    expect(screen.getByText('Remove')).toBeInTheDocument();
  });

  it('uses enabled custom duplicate rules for saved windows', async () => {
    const user = userEvent.setup();
    const rule: DedupeRule = {
      comparisonMode: 'path-prefix',
      enabled: true,
      glob: 'workspace.example.com/*',
      id: 'workspace-section',
      pathSegmentCount: 1,
    };
    const older = createSavedWindow({
      createdAt: '2026-07-09T20:00:00.000Z',
      groups: [],
      id: 'older',
      name: 'Old project view',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Old project',
          url: 'https://workspace.example.com/projects/old',
        },
      ],
      updatedAt: '2026-07-09T20:00:00.000Z',
    });
    const newer = createSavedWindow({
      groups: [],
      id: 'newer',
      name: 'New project view',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'New project',
          url: 'https://workspace.example.com/projects/new',
        },
      ],
    });
    const service = createService([older, newer]);
    render(
      <SavedWindowsPage
        service={service}
        settingsService={createSettingsService({
          advancedDuplicateMatchingEnabled: true,
          deduplicationRules: [rule],
        })}
      />,
    );

    await user.click(
      await screen.findByRole('button', {
        name: 'Remove duplicate tabs from Saved Windows: 1 tab',
      }),
    );

    expect(service.deduplicateTabs).toHaveBeenCalledWith([rule]);
    expect(await screen.findByText('New project view')).toBeInTheDocument();
    expect(screen.queryByText('Old project view')).not.toBeInTheDocument();
  });

  it('finds app.notion.com URL variants in a filtered saved window', async () => {
    const user = userEvent.setup();
    const pageUrl = 'https://app.notion.com/p/acme/Project-Plan-00000000000000000000000000000000';
    const notionRules = DEFAULT_DEDUPLICATION_RULES.map((rule) => ({
      ...rule,
      enabled: rule.id.startsWith('builtin-notion-'),
    }));
    const service = createService([
      createSavedWindow({
        groups: [],
        name: 'Notion research',
        tabs: [
          { active: false, order: 0, pinned: false, title: 'Base page', url: pageUrl },
          {
            active: true,
            order: 1,
            pinned: false,
            title: 'Move view',
            url: `${pageUrl}?showMoveTo=true#block-one`,
          },
          {
            active: false,
            order: 2,
            pinned: false,
            title: 'Parent view',
            url: `${pageUrl}?saveParent=true#block-two`,
          },
        ],
      }),
    ]);
    render(
      <SavedWindowsPage
        service={service}
        settingsService={createSettingsService({
          advancedDuplicateMatchingEnabled: true,
          deduplicationRules: notionRules,
        })}
      />,
    );

    await user.type(
      await screen.findByRole('searchbox', { name: 'Filter saved windows, groups, and tabs' }),
      'notion',
    );
    expect(
      screen.getByRole('button', {
        name: 'Remove duplicate tabs from Saved Windows: 2 tabs',
      }),
    ).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Show saved duplicate tabs only' }));

    expect(screen.getByText('Move view').closest('.saved-tab-row')).toHaveClass(
      'is-duplicate-preview-keep',
    );
    expect(screen.getByText('Base page').closest('.saved-tab-row')).toHaveClass(
      'is-duplicate-preview-close',
    );
    expect(screen.getByText('Parent view').closest('.saved-tab-row')).toHaveClass(
      'is-duplicate-preview-close',
    );
    await user.click(
      within(screen.getByRole('status', { name: 'Saved duplicate tabs view' })).getByRole(
        'button',
        { name: 'Remove duplicate tabs: 2 tabs' },
      ),
    );

    expect(service.deduplicateTabs).toHaveBeenCalledWith(notionRules);
    expect(await screen.findByRole('heading', { name: 'No duplicate tabs' })).toBeInTheDocument();
  });

  it('keeps duplicate cleanup on its button while the storage rewrite is pending', async () => {
    const user = userEvent.setup();
    const older = createSavedWindow({
      createdAt: '2026-07-09T20:00:00.000Z',
      groups: [],
      id: 'older',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Old plan',
          url: 'https://docs.example.com/plan',
        },
      ],
      updatedAt: '2026-07-09T20:00:00.000Z',
    });
    const service = createService([older, createSavedWindow({ id: 'newer' })]);
    const originalCleanup = vi.mocked(service.deduplicateTabs).getMockImplementation();
    const gate = createDeferred<void>();
    vi.mocked(service.deduplicateTabs).mockImplementationOnce(async (rules) => {
      await gate.promise;
      return originalCleanup!(rules);
    });
    render(<SavedWindowsPage service={service} settingsService={createSettingsService()} />);

    const removeButton = await screen.findByRole('button', {
      name: 'Remove duplicate tabs from Saved Windows: 1 tab',
    });
    await user.click(removeButton);

    const busyButton = screen.getByRole('button', {
      name: 'Removing duplicate tabs from Saved Windows',
    });
    expect(busyButton).toBe(removeButton);
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute('aria-busy', 'true');
    expect(busyButton).toHaveClass('is-removing-duplicates');
    expect(busyButton).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Merge saved windows' })).toBeDisabled();

    gate.resolve(undefined);
    expect(await screen.findByText(/Removed 1 duplicate tab/)).toBeInTheDocument();
    await waitFor(() => expect(removeButton).not.toHaveAttribute('aria-busy'));
  });

  it('retires a stale Undo and moves focus to its error', async () => {
    const user = userEvent.setup();
    const older = createSavedWindow({
      createdAt: '2026-07-09T20:00:00.000Z',
      groups: [],
      id: 'older',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Old plan',
          url: 'https://docs.example.com/plan',
        },
      ],
      updatedAt: '2026-07-09T20:00:00.000Z',
    });
    const newer = createSavedWindow({ id: 'newer' });
    const service = createService([older, newer]);
    vi.mocked(service.undoMutation).mockRejectedValueOnce(new SavedWindowsMutationConflictError());
    render(<SavedWindowsPage service={service} settingsService={createSettingsService()} />);

    await user.click(
      await screen.findByRole('button', {
        name: 'Remove duplicate tabs from Saved Windows: 1 tab',
      }),
    );
    const undo = screen.getByRole('button', { name: 'Undo' });
    await waitFor(() => expect(undo).toHaveFocus());
    await user.click(undo);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Saved Windows changed after this action');
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(within(alert).getByRole('button', { name: 'Dismiss' })).toHaveFocus(),
    );
  });

  it('merges selected saved windows by displayed order with an explicit new name', async () => {
    const user = userEvent.setup();
    const first = createSavedWindow({ id: 'saved-1', name: 'Research' });
    const second = createSavedWindow({
      createdAt: '2026-07-09T20:00:00.000Z',
      groups: [],
      id: 'saved-2',
      name: 'Reference',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Reference tab',
          url: 'https://reference.example.com/',
        },
      ],
      updatedAt: '2026-07-09T20:00:00.000Z',
    });
    const service = createService([first, second]);
    render(<SavedWindowsPage service={service} settingsService={createSettingsService()} />);

    await user.click(await screen.findByRole('button', { name: 'Merge saved windows' }));
    const dialog = screen.getByRole('dialog', { name: 'Merge saved windows' });
    const nameInput = within(dialog).getByRole('textbox', { name: 'New saved window name' });
    expect(nameInput).toBeRequired();
    expect(nameInput).toHaveAccessibleDescription(
      'Choose at least two windows, then name the merged window.',
    );
    const checkboxes = within(dialog).getAllByRole('checkbox');
    expect(checkboxes[0]).toHaveFocus();
    const initialMergeButton = within(dialog).getByRole('button', {
      name: 'Merge saved windows',
    });
    expect(initialMergeButton).toHaveAttribute(
      'data-tooltip',
      'Select at least two windows and enter a name to merge.',
    );
    expect(initialMergeButton).toHaveAttribute('aria-disabled', 'true');
    expect(initialMergeButton).toHaveAccessibleDescription(
      'Select at least two windows and enter a name to merge.',
    );
    await user.click(checkboxes[1]!);
    await user.click(checkboxes[0]!);

    expect(within(dialog).getByText('Research')).toBeInTheDocument();
    expect(within(dialog).getByText('Reference')).toBeInTheDocument();
    expect(within(dialog).getByText(/Plan · Saved/)).toBeInTheDocument();
    expect(within(dialog).queryByText('Keeps name')).not.toBeInTheDocument();
    const selectedMergeButton = within(dialog).getByRole('button', {
      name: 'Merge 2 saved windows',
    });
    expect(selectedMergeButton).toHaveAttribute('aria-disabled', 'true');
    expect(selectedMergeButton).toHaveAttribute(
      'data-tooltip',
      'Enter a name for the merged window.',
    );
    expect(selectedMergeButton).toHaveAccessibleDescription('Enter a name for the merged window.');
    const actionArea = nameInput.closest('.merge-dialog-actions');
    expect(actionArea).toContainElement(selectedMergeButton);
    await user.type(nameInput, 'Combined research');
    expect(selectedMergeButton).not.toHaveAttribute('aria-disabled', 'true');
    expect(selectedMergeButton).toHaveAttribute('title', 'Merge selected saved windows');
    await user.keyboard('{Enter}');

    expect(service.mergeWindows).toHaveBeenCalledWith(['saved-1', 'saved-2'], 'Combined research');
    expect(
      await screen.findByText('Merged 2 saved windows into "Combined research".'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Combined research')).toHaveLength(1);
    expect(screen.queryByText('Reference')).not.toBeInTheDocument();
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toBeInTheDocument();
    await waitFor(() => expect(undo).toHaveFocus());
    await user.click(undo);

    expect(service.undoMutation).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Reference')).toBeInTheDocument();
    expect(screen.getByText('Restored 2 saved windows.')).toBeInTheDocument();
  });

  it('restores focus when the saved-window merge dialog is dismissed', async () => {
    const user = userEvent.setup();
    render(
      <SavedWindowsPage
        service={createService([
          createSavedWindow({ id: 'saved-1' }),
          createSavedWindow({ id: 'saved-2', name: 'Reference' }),
        ])}
        settingsService={createSettingsService()}
      />,
    );

    const mergeButton = await screen.findByRole('button', { name: 'Merge saved windows' });
    await user.click(mergeButton);
    const dialog = screen.getByRole('dialog', { name: 'Merge saved windows' });
    expect(within(dialog).getAllByRole('checkbox')[0]).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Merge saved windows' })).not.toBeInTheDocument();
    await waitFor(() => expect(mergeButton).toHaveFocus());
  });

  it('shows merge progress without losing the selected count', async () => {
    const user = userEvent.setup();
    const first = createSavedWindow({ id: 'saved-1', name: 'Research' });
    const second = createSavedWindow({ id: 'saved-2', name: 'Reference' });
    const service = createService([first, second]);
    const originalMerge = vi.mocked(service.mergeWindows).getMockImplementation();
    const gate = createDeferred<void>();
    vi.mocked(service.mergeWindows).mockImplementationOnce(async (ids, name) => {
      await gate.promise;
      return originalMerge!(ids, name);
    });
    render(<SavedWindowsPage service={service} settingsService={createSettingsService()} />);

    await user.click(await screen.findByRole('button', { name: 'Merge saved windows' }));
    const dialog = screen.getByRole('dialog', { name: 'Merge saved windows' });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'New saved window name' }),
      'Combined research',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Select all' }));
    await user.click(within(dialog).getByRole('button', { name: 'Merge 2 saved windows' }));

    const busyButton = screen.getByRole('button', { name: 'Merging 2 saved windows' });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.getByText('Merging 2 saved windows', { selector: '[role="status"]' }),
    ).toBeVisible();

    gate.resolve(undefined);
    expect(
      await screen.findByText('Merged 2 saved windows into "Combined research".'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus());
  });

  it('retains the merge name and selection when the storage rewrite fails', async () => {
    const user = userEvent.setup();
    const service = createService([
      createSavedWindow({ id: 'saved-1', name: 'Research' }),
      createSavedWindow({ id: 'saved-2', name: 'Reference' }),
    ]);
    vi.mocked(service.mergeWindows).mockRejectedValueOnce(new Error('Saved storage is busy.'));
    render(<SavedWindowsPage service={service} settingsService={createSettingsService()} />);

    await user.click(await screen.findByRole('button', { name: 'Merge saved windows' }));
    const initialDialog = screen.getByRole('dialog', { name: 'Merge saved windows' });
    await user.type(
      within(initialDialog).getByRole('textbox', { name: 'New saved window name' }),
      'Combined research',
    );
    await user.click(within(initialDialog).getByRole('button', { name: 'Select all' }));
    await user.click(within(initialDialog).getByRole('button', { name: 'Merge 2 saved windows' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Saved storage is busy.');
    const restoredDialog = await screen.findByRole('dialog', { name: 'Merge saved windows' });
    const restoredName = within(restoredDialog).getByRole('textbox', {
      name: 'New saved window name',
    });
    expect(restoredName).toHaveValue('Combined research');
    within(restoredDialog)
      .getAllByRole('checkbox')
      .forEach((checkbox) => expect(checkbox).toBeChecked());
    await waitFor(() => expect(within(restoredDialog).getAllByRole('checkbox')[0]).toHaveFocus());
    expect(
      within(restoredDialog).getByRole('button', { name: 'Merge 2 saved windows' }),
    ).toBeEnabled();
  });

  it('shows and dismisses the invalid-record cleanup notice', async () => {
    const user = userEvent.setup();
    const service = createService();
    service.loadCleanupNotice = vi.fn(() =>
      Promise.resolve(
        'Weaver discarded 2 invalid saved-window records and kept every valid saved window.',
      ),
    );
    service.dismissCleanupNotice = vi.fn(() => Promise.resolve());

    render(<SavedWindowsPage service={service} />);

    expect(
      await screen.findByText(
        'Weaver discarded 2 invalid saved-window records and kept every valid saved window.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(service.dismissCleanupNotice).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(
        'Weaver discarded 2 invalid saved-window records and kept every valid saved window.',
      ),
    ).not.toBeInTheDocument();
  });

  it('consumes a complete restore and can keep the original snapshot from its notice', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<SavedWindowsPage service={service} />);

    const expand = await screen.findByRole('button', { name: 'Expand Research' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    await user.click(expand);

    expect(expand).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByText('Collapsed')).toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByLabelText('Pinned')).toBeInTheDocument();
    expect(screen.queryByText('Focused after restore')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Focused after restore')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore Research' }));
    expect(service.restoreWindow).toHaveBeenCalledWith('saved-1');
    expect(
      await screen.findByText('Restored 2 tabs from "Research". Removed it from Saved Windows.'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'No saved windows' })).toBeInTheDocument();
    expect(screen.queryByText('Research')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep saved' }));

    expect(service.keepWindow).toHaveBeenCalledWith(expect.objectContaining({ id: 'saved-1' }));
    expect(await screen.findByText('Kept "Research" in Saved Windows.')).toBeInTheDocument();
    expect(await screen.findByText('Research')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep saved' })).not.toBeInTheDocument();
  });

  it('opens an individual saved tab without changing the saved snapshot', async () => {
    const user = userEvent.setup();
    const fullUrl = 'https://mail.example.com/inbox?view=unread#top';
    const savedWindow = createSavedWindow();
    const service = createService([
      {
        ...savedWindow,
        tabs: savedWindow.tabs.map((tab) => (tab.order === 0 ? { ...tab, url: fullUrl } : tab)),
      },
    ]);
    render(
      <SavedWindowsPage
        service={service}
        settingsService={createSettingsService({ showTabUrls: false })}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Expand Research' }));
    const openPinnedTab = screen.getByRole('button', {
      name: 'Open Inbox in a new pinned tab',
    });
    const removePinnedTab = screen.getByRole('button', {
      name: 'Remove Inbox from Research, saved tab 1',
    });
    expect(openPinnedTab).toHaveAttribute('title', 'Open in a new pinned tab');
    expect(openPinnedTab).toHaveClass('has-remove-action');
    expect(openPinnedTab.querySelector('.lucide-external-link')).toBeInTheDocument();
    expect(await screen.findByText('mail.example.com/inbox')).toHaveAttribute('title', fullUrl);
    expect(removePinnedTab).toHaveAttribute('title', 'Remove tab from Saved Windows');
    expect(removePinnedTab.querySelector('.lucide-x')).toBeInTheDocument();
    expect(openPinnedTab.nextElementSibling).toBe(removePinnedTab);
    await user.click(openPinnedTab);

    expect(service.openTab).toHaveBeenCalledWith({
      pinned: true,
      url: fullUrl,
    });
    expect(service.restoreWindow).not.toHaveBeenCalled();
    expect(service.renameWindow).not.toHaveBeenCalled();
    expect(service.deleteWindow).not.toHaveBeenCalled();
    expect(screen.getByText('Research')).toBeInTheDocument();
  });

  it('removes one saved tab from a filtered row and restores it with Undo', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<SavedWindowsPage service={service} />);

    const search = await screen.findByRole('searchbox', {
      name: 'Filter saved windows, groups, and tabs',
    });
    await user.type(search, 'plan');
    const removePlan = screen.getByRole('button', {
      name: 'Remove Plan from Research, saved tab 2',
    });
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    await user.click(removePlan);

    expect(service.removeSelectedTabs).toHaveBeenCalledWith([
      {
        expectedTab: {
          active: true,
          groupKey: 'group-1',
          order: 1,
          pinned: false,
          title: 'Plan',
          url: 'https://docs.example.com/plan',
        },
        expectedWindowUpdatedAt: '2026-07-10T20:00:00.000Z',
        tabOrder: 1,
        windowId: 'saved-1',
      },
    ]);
    expect(service.openTab).not.toHaveBeenCalled();
    expect(search).toHaveValue('plan');
    expect(await screen.findByText('Removed "Plan" from "Research".')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No saved items match' })).toBeInTheDocument();

    const undo = screen.getByRole('button', { name: 'Undo' });
    await waitFor(() => expect(search).toHaveFocus());
    expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });
    await user.click(undo);

    expect(service.undoMutation).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Restored "Plan" to "Research".')).toBeInTheDocument();
    expect(search).toHaveValue('plan');
  });

  it('consumes palette searches for saved windows and tab groups on the current route', async () => {
    window.location.hash =
      '#/saved-windows?groupKey=group-1&savedWindowId=saved-1&search=Untitled+group';
    const savedWindow = createSavedWindow();
    const service = createService([
      {
        ...savedWindow,
        groups: savedWindow.groups.map((group) => ({ ...group, title: '' })),
      },
    ]);
    render(<SavedWindowsPage service={service} />);

    const search = await screen.findByRole('searchbox', {
      name: 'Filter saved windows, groups, and tabs',
    });
    await waitFor(() => expect(search).toHaveValue('Untitled group'));
    await waitFor(() => expect(search).toHaveFocus());
    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(screen.getByText('Untitled group')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/saved-windows');
    expect(service.restoreWindow).not.toHaveBeenCalled();
    expect(service.openTab).not.toHaveBeenCalled();

    search.blur();
    expect(search).not.toHaveFocus();
    window.location.hash = '#/saved-windows?savedWindowId=saved-1&search=Research';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(search).toHaveValue('Research'));
    await waitFor(() => expect(search).toHaveFocus());
    expect(window.location.hash).toBe('#/saved-windows');

    search.blur();
    window.location.hash = '#/saved-windows?savedWindowId=saved-1&search=Research';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(search).toHaveFocus());
  });

  it('keeps focus at the same list position after removing one saved tab', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<SavedWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Expand Research' }));
    const removeInbox = screen.getByRole('button', {
      name: 'Remove Inbox from Research, saved tab 1',
    });
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    await user.click(removeInbox);

    const removePlan = await screen.findByRole('button', {
      name: 'Remove Plan from Research, saved tab 1',
    });
    await waitFor(() => expect(removePlan).toHaveFocus());
    expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('removes an empty saved window with its last tab and restores both with Undo', async () => {
    const user = userEvent.setup();
    const service = createService([
      createSavedWindow({
        groups: [],
        name: 'Solo',
        tabs: [
          {
            active: true,
            order: 0,
            pinned: false,
            title: 'Solo tab',
            url: 'https://example.com/solo',
          },
        ],
      }),
    ]);
    render(<SavedWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Expand Solo' }));
    await user.click(
      screen.getByRole('button', { name: 'Remove Solo tab from Solo, saved tab 1' }),
    );

    expect(
      await screen.findByText('Removed "Solo tab" from "Solo". Removed the empty saved window.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No saved windows' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    const restoredPreview = await screen.findByRole('button', { name: 'Expand Solo' });
    expect(screen.getByText('Restored "Solo tab" to "Solo".')).toBeInTheDocument();
    await user.click(restoredPreview);
    expect(
      screen.getByRole('button', { name: 'Remove Solo tab from Solo, saved tab 1' }),
    ).toBeInTheDocument();
  });

  it('keeps an individual saved tab when its guarded removal fails', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.removeSelectedTabs).mockRejectedValueOnce(
      new SavedWindowsMutationConflictError(),
    );
    render(<SavedWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Expand Research' }));
    const removeInbox = screen.getByRole('button', {
      name: 'Remove Inbox from Research, saved tab 1',
    });
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    await user.click(removeInbox);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Saved Windows changed after this action, so Weaver did not overwrite the newer changes.',
    );
    await waitFor(() => expect(removeInbox).toHaveFocus());
    expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(within(alert).getByRole('button', { name: 'Dismiss' })).not.toHaveFocus();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove Inbox from Research, saved tab 1' }),
    ).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(service.openTab).not.toHaveBeenCalled();
  });

  it('copies a local-file URL without adding copy actions to web tabs', async () => {
    const user = userEvent.setup();
    const fileUrl = 'file:///Users/example/Downloads/reference.svg';
    const service = createService([
      createSavedWindow({
        tabs: [
          {
            active: false,
            order: 0,
            pinned: false,
            title: 'Local reference',
            url: fileUrl,
          },
          {
            active: true,
            order: 1,
            pinned: false,
            title: 'Web reference',
            url: 'https://example.com/reference',
          },
        ],
      }),
    ]);
    render(<SavedWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Expand Research' }));
    expect(screen.getByRole('button', { name: 'Copy URL for Local reference' })).toHaveAttribute(
      'title',
      'Copy URL',
    );
    expect(screen.queryByRole('button', { name: 'Copy URL for Web reference' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Copy URL for Local reference' }));

    await expect(navigator.clipboard.readText()).resolves.toBe(fileUrl);
    expect(await screen.findByText('Copied URL for "Local reference".')).toBeInTheDocument();
    expect(service.openTab).not.toHaveBeenCalled();
  });

  it('surfaces a local-file URL copy failure', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard blocked'));
    const service = createService([
      createSavedWindow({
        tabs: [
          {
            active: true,
            order: 0,
            pinned: false,
            title: 'Local reference',
            url: 'file:///Users/example/Downloads/reference.svg',
          },
        ],
      }),
    ]);
    render(<SavedWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Expand Research' }));
    await user.click(screen.getByRole('button', { name: 'Copy URL for Local reference' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The browser could not copy that URL.',
    );
  });

  it('surfaces a saved-tab open failure without collapsing the preview', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.openTab).mockRejectedValue(new Error('URL blocked'));
    render(<SavedWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Expand Research' }));
    await user.click(screen.getByRole('button', { name: 'Open Plan in a new tab' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('URL blocked');
    expect(
      screen.getByRole('button', { name: 'Open Inbox in a new pinned tab' }),
    ).toBeInTheDocument();
  });

  it('renames inline and requires confirmation before deletion', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<SavedWindowsPage service={service} />);

    await screen.findByText('Research');
    await user.click(screen.getByRole('button', { name: 'Rename Research' }));
    const input = screen.getByRole('textbox', { name: 'New name for Research' });
    await user.clear(input);
    await user.type(input, 'Reference set');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() =>
      expect(service.renameWindow).toHaveBeenCalledWith('saved-1', 'Reference set'),
    );
    expect(await screen.findByText('Reference set')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete Reference set' }));
    expect(screen.getByText('Delete this saved window?')).toBeInTheDocument();
    expect(service.deleteWindow).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(service.deleteWindow).toHaveBeenCalledWith('saved-1'));
    expect(await screen.findByRole('heading', { name: 'No saved windows' })).toBeInTheDocument();
  });

  it('surfaces partial restore failures without deleting the saved record', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.restoreWindow).mockResolvedValue({
      destinationWindowId: 9,
      failures: [
        {
          message: 'URL blocked',
          order: 1,
          title: 'Plan',
          url: 'https://docs.example.com/plan',
        },
      ],
      restoredTabCount: 1,
      savedWindowRemoved: false,
      warnings: [],
    });
    render(<SavedWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Restore Research' }));

    expect(
      await screen.findByText('Restored 1 tab from "Research". 1 tab failed. URL blocked'),
    ).toBeInTheDocument();
    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(service.load).toHaveBeenCalledTimes(2);
  });

  it('offers Keep saved after a complete restore that includes warnings', async () => {
    const user = userEvent.setup();
    const service = createService([createSavedWindow()], ['One tab group could not be restored.']);
    render(<SavedWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Restore Research' }));

    expect(
      await screen.findByText(
        'Restored 2 tabs from "Research". Removed it from Saved Windows. One tab group could not be restored.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep saved' })).toBeInTheDocument();
  });

  it('shows a retryable load error for corrupted storage', async () => {
    const service = createService();
    vi.mocked(service.load).mockRejectedValue(new Error('Saved windows data is corrupted.'));
    render(<SavedWindowsPage service={service} />);

    expect(
      await screen.findByRole('heading', { name: 'Could not load saved windows' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Saved windows data is corrupted.')).toBeInTheDocument();
  });
});
