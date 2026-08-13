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

import { APP_LAUNCH_ROUTES, APP_ROUTES } from '../app/routes';
import {
  PINNED_TAB_GROUP_MOVE_ERROR_MESSAGE,
  type ActiveWindowsService,
  type CloseDuplicateTabsResult,
  type RestorableTab,
} from '../features/active-windows/chromeActiveWindowsService';
import { type DedupeRule } from '../features/deduplication/deduplication';
import {
  type FastSourceWindowCloseOperation,
  type SaveWindowResult,
  type SavedWindowsService,
} from '../features/saved-windows/savedWindowsService';
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
            unloaded: true,
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
    closeDuplicateTabs: vi.fn(() =>
      Promise.resolve({
        closedTabIds: [],
        closedTabs: [],
        failures: [],
        skippedAgentAssociatedTabIds: [],
        skippedChangedTabIds: [],
        skippedPinnedTabIds: [],
      }),
    ),
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
    pinTab: vi.fn(() => Promise.resolve()),
    restoreTabs: vi.fn((tabs: readonly RestorableTab[]) =>
      Promise.resolve({
        failures: [],
        restoredOriginalTabIds: tabs.map((tab) => tab.originalTabId),
        restoredTabIds: tabs.map((_, index) => 901 + index),
        warnings: [],
      }),
    ),
    sortAllWindows: vi.fn(() =>
      Promise.resolve({ failures: [], sortedWindowIds: [1, 2], warnings: [] }),
    ),
    sortWindow: vi.fn((windowId: number) =>
      Promise.resolve({ failures: [], sortedWindowIds: [windowId], warnings: [] }),
    ),
    subscribe: vi.fn(() => () => undefined),
    suspendTabs: vi.fn(() => Promise.resolve({ affectedTabIds: [], failures: [] })),
    unpinTab: vi.fn(() => Promise.resolve()),
    unsuspendTabs: vi.fn(() => Promise.resolve({ affectedTabIds: [], failures: [] })),
  };
}

function createDuplicateSelectionService(): ActiveWindowsService {
  const service = createService();
  const duplicateUrl = 'https://example.test/same-page';
  vi.mocked(service.loadSnapshot).mockResolvedValue(
    createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          groups: [
            {
              collapsed: false,
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
              id: 101,
              title: 'Keep this tab',
              url: duplicateUrl,
              windowId: 1,
            }),
            createManagedTab({
              groupId: 7,
              id: 102,
              index: 1,
              title: 'Hidden selection',
              url: 'https://example.test/other',
              windowId: 1,
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
              title: 'Close this tab',
              url: duplicateUrl,
              windowId: 2,
            }),
          ],
        }),
      ],
    }),
  );
  return service;
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
    setShowTabUrls: vi.fn(() => Promise.resolve(settings)),
    subscribe: vi.fn(() => () => undefined),
  };
}

function createSaveWindowResult(
  name: string,
  closeSource: boolean,
  warnings: string[] = [],
  sourceWindowId = 1,
): SaveWindowResult {
  const targetTabIds = sourceWindowId === 1 ? [101, 102] : [201];
  return {
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
    sourceWindowClose: closeSource
      ? {
          anchorTabId: targetTabIds[0] ?? 0,
          batchCompletion: Promise.resolve({ errorMessage: null }),
          cancelFinalization: vi.fn(),
          finish: vi.fn(() =>
            Promise.resolve({
              completion: Promise.resolve({ errorMessage: null }),
              errorMessage: null,
              status: 'close-requested' as const,
            }),
          ),
          nonAnchorTabIds: targetTabIds.slice(1),
          targetTabIds,
          windowId: sourceWindowId,
        }
      : null,
    warnings,
  };
}

function requireFastClose(result: SaveWindowResult): FastSourceWindowCloseOperation {
  if (!result.sourceWindowClose) {
    throw new Error('Expected a fast close fixture');
  }
  return result.sourceWindowClose;
}

function createSavedWindowsService(): SavedWindowsService {
  return {
    deduplicateTabs: vi.fn(() => Promise.reject(new Error('Not used'))),
    deleteWindow: vi.fn(() => Promise.resolve()),
    keepWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    load: vi.fn(() => Promise.resolve([])),
    mergeWindows: vi.fn(() => Promise.reject(new Error('Not used'))),
    moveSelectedTabsToNewWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    openTab: vi.fn(() => Promise.reject(new Error('Not used'))),
    removeSelectedTabs: vi.fn(() => Promise.reject(new Error('Not used'))),
    renameWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    restoreWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    saveWindow: vi.fn((sourceWindowId: number, name: string, closeSource: boolean) =>
      Promise.resolve(
        createSaveWindowResult(
          name,
          closeSource,
          sourceWindowId === 1 ? [] : ['Unexpected source'],
          sourceWindowId,
        ),
      ),
    ),
    sortAllWindows: vi.fn(() => Promise.resolve({ sortedWindowIds: [], undo: null })),
    sortWindow: vi.fn(() => Promise.resolve({ sortedWindowIds: [], undo: null })),
    subscribe: vi.fn(() => () => undefined),
    undoMutation: vi.fn(() => Promise.reject(new Error('Not used'))),
  };
}

async function renderCompletedSaveAndClose(
  savedWindowsService: SavedWindowsService,
  name = 'Project work',
) {
  const user = userEvent.setup();
  const service = createService();
  let currentSnapshot = await service.loadSnapshot();
  const listeners = new Set<() => void>();
  vi.mocked(service.loadSnapshot).mockClear();
  vi.mocked(service.loadSnapshot).mockImplementation(() => Promise.resolve(currentSnapshot));
  service.subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  render(<ActiveWindowsPage savedWindowsService={savedWindowsService} service={service} />);

  await user.click(await screen.findByRole('button', { name: 'Save Window 1' }));
  const dialog = screen.getByRole('dialog', { name: 'Save window' });
  await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), name);
  await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

  currentSnapshot = createActiveWindowsSnapshot({
    windows: currentSnapshot.windows.filter((activeWindow) => activeWindow.id !== 1),
  });
  act(() => listeners.forEach((listener) => listener()));
  await screen.findByText(`Saved "${name}" and closed Window 1.`);
  return { service, user };
}

afterEach(() => {
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}${APP_ROUTES.windows}`,
  );
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ActiveWindowsPage', () => {
  it('labels locally detected agent-associated tabs with a robot marker', async () => {
    const service = createService();
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({
                agentAssociated: true,
                agentDedupeProtected: true,
                agentDetection: {
                  activity: 'working',
                  evidence: 'claude-status-group',
                },
                title: 'Agent task',
                url: 'https://example.test/agent-task',
              }),
            ],
          }),
        ],
      }),
    );

    render(<ActiveWindowsPage service={service} />);

    const focusButton = await screen.findByRole('button', { name: 'Focus Agent task' });
    const marker = focusButton.querySelector('.agent-associated-tab-indicator');
    expect(marker).toHaveAttribute(
      'data-tooltip',
      'Agent may still be using this tab — Weaver keeps it open during duplicate cleanup',
    );
    expect(focusButton).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('agent-associated-description'),
    );
    expect(focusButton).toHaveAccessibleDescription(
      'Agent-associated tab · activity appears ongoing or is unclear, so it stays open during duplicate cleanup; Weaver keeps any containing group together during sorting and moving.',
    );
  });

  it('opens duplicate tabs view from the popup launch route', async () => {
    const service = createService();
    const duplicateUrl = 'https://example.test/same-page';
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({
                active: true,
                id: 101,
                title: 'Keep this tab',
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
            tabs: [
              createManagedTab({
                active: true,
                id: 201,
                title: 'Close this tab',
                url: duplicateUrl,
                windowId: 2,
              }),
            ],
          }),
        ],
      }),
    );
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${APP_LAUNCH_ROUTES.duplicateTabs}`,
    );

    render(<ActiveWindowsPage service={service} />);

    const duplicateBanner = await screen.findByRole('status', { name: 'Duplicate tabs view' });
    expect(duplicateBanner).toHaveTextContent(
      'Tabs labeled Keep stay open, including pinned matches and agent-associated matches with ongoing or unclear activity. Duplicate cleanup closes tabs labeled Close.',
    );
    const bannerButtons = within(duplicateBanner).getAllByRole('button');
    expect(bannerButtons[0]).toHaveAccessibleName('Close duplicate tabs: 1 tab');
    expect(within(bannerButtons[0] as HTMLElement).getByText('1')).toHaveClass('toolbar-count');
    expect(bannerButtons[1]).toHaveAccessibleName('Exit duplicate tabs view');
    expect(bannerButtons[1]).toHaveAttribute('title', 'Exit duplicate tabs view');
    expect(screen.getByRole('button', { name: 'Show duplicate tabs only' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const keptTabRow = (await screen.findByText('Keep this tab')).closest('li');
    const closingTabRow = screen.getByText('Close this tab').closest('li');
    expect(keptTabRow).toHaveClass('is-duplicate-preview-keep');
    expect(closingTabRow).toHaveClass('is-duplicate-preview-close');
    expect(within(keptTabRow as HTMLElement).getByText('Keep')).toBeInTheDocument();
    expect(within(closingTabRow as HTMLElement).getByText('Close')).toBeInTheDocument();
    expect(
      within(keptTabRow as HTMLElement).getByRole('button', { name: 'Focus Keep this tab' }),
    ).toHaveAccessibleDescription(
      'Active tabs cannot be suspended. Select another tab in this window first. Keep',
    );
    expect(
      within(closingTabRow as HTMLElement).getByRole('button', { name: 'Focus Close this tab' }),
    ).toHaveAccessibleDescription(
      'Active tabs cannot be suspended. Select another tab in this window first. Close',
    );
    expect(window.location.hash).toBe(APP_ROUTES.windows);
  });

  it('keeps every pinned duplicate visible and closes only unpinned matches', async () => {
    const user = userEvent.setup();
    const service = createService();
    const duplicateUrl = 'https://example.test/pinned-duplicate';
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({
                active: true,
                id: 101,
                pinned: true,
                title: 'Pinned current copy',
                url: duplicateUrl,
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
                pinned: true,
                title: 'Pinned second copy',
                url: duplicateUrl,
                windowId: 2,
              }),
              createManagedTab({
                id: 202,
                index: 1,
                title: 'Unpinned copy',
                url: duplicateUrl,
                windowId: 2,
              }),
            ],
          }),
        ],
      }),
    );
    vi.mocked(service.closeDuplicateTabs).mockResolvedValue({
      closedTabIds: [202],
      closedTabs: [],
      failures: [],
      skippedAgentAssociatedTabIds: [],
      skippedChangedTabIds: [],
      skippedPinnedTabIds: [],
    });
    render(<ActiveWindowsPage service={service} />);

    const previewButton = await screen.findByRole('button', {
      name: 'Show duplicate tabs only',
    });
    await waitFor(() => expect(previewButton).toBeEnabled());
    await user.click(previewButton);

    expect(screen.getByText('Pinned current copy').closest('li')).toHaveClass(
      'is-duplicate-preview-keep',
    );
    expect(screen.getByText('Pinned second copy').closest('li')).toHaveClass(
      'is-duplicate-preview-keep',
    );
    expect(screen.getByText('Unpinned copy').closest('li')).toHaveClass(
      'is-duplicate-preview-close',
    );

    await user.click(
      within(screen.getByRole('group', { name: 'Duplicate tab actions' })).getByRole('button', {
        name: 'Close duplicate tabs: 1 tab',
      }),
    );

    expect(service.closeDuplicateTabs).toHaveBeenCalledWith(
      expect.objectContaining({ tabIds: [202] }),
    );
  });

  it('shows all-pinned duplicate groups as protected instead of an empty state', async () => {
    const user = userEvent.setup();
    const service = createService();
    const duplicateUrl = 'https://example.test/all-pinned';
    const allPinnedSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          tabs: [
            createManagedTab({
              active: true,
              id: 101,
              pinned: true,
              title: 'Pinned first copy',
              url: duplicateUrl,
            }),
            createManagedTab({
              id: 102,
              index: 1,
              pinned: true,
              title: 'Pinned second copy',
              url: duplicateUrl,
            }),
          ],
        }),
      ],
    });
    const oneUnpinnedSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          tabs: [
            createManagedTab({
              active: true,
              id: 101,
              pinned: true,
              title: 'Pinned first copy',
              url: duplicateUrl,
            }),
            createManagedTab({
              id: 102,
              index: 1,
              title: 'Pinned second copy',
              url: duplicateUrl,
            }),
          ],
        }),
      ],
    });
    vi.mocked(service.loadSnapshot)
      .mockResolvedValueOnce(allPinnedSnapshot)
      .mockResolvedValue(oneUnpinnedSnapshot);
    render(<ActiveWindowsPage service={service} />);

    const previewButton = await screen.findByRole('button', { name: 'Show duplicate tabs only' });
    await waitFor(() => expect(previewButton).toBeEnabled());
    await user.click(previewButton);

    expect(screen.getByText('Pinned first copy')).toBeInTheDocument();
    expect(screen.getByText('Pinned second copy')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No duplicate tabs' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Duplicate tabs view' })).toHaveTextContent(
      'Every duplicate shown is protected and will stay open. Pinned tabs can be unpinned; agent-associated tabs stay open while activity is ongoing or unclear.',
    );
    const duplicateActions = screen.getByRole('group', { name: 'Duplicate tab actions' });
    expect(
      within(duplicateActions).getByRole('button', { name: 'Close duplicate tabs: 0 tabs' }),
    ).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Pin Pinned second copy', pressed: true }));

    expect(service.unpinTab).toHaveBeenCalledWith(102);
    await waitFor(() =>
      expect(
        within(duplicateActions).getByRole('button', { name: 'Close duplicate tabs: 1 tab' }),
      ).toBeEnabled(),
    );
    expect(screen.getByText('Pinned second copy').closest('li')).toHaveClass(
      'is-duplicate-preview-close',
    );
    expect(
      screen.getByRole('button', { name: 'Pin Pinned second copy', pressed: false }),
    ).toHaveFocus();
  });

  it('keeps a duplicate after it is pinned from the preview', async () => {
    const user = userEvent.setup();
    const service = createService();
    const duplicateUrl = 'https://example.test/pin-duplicate';
    const unpinnedSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          tabs: [
            createManagedTab({
              active: true,
              id: 101,
              title: 'Current copy',
              url: duplicateUrl,
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
              title: 'Copy to pin',
              url: duplicateUrl,
              windowId: 2,
            }),
          ],
        }),
      ],
    });
    const pinnedSnapshot = createActiveWindowsSnapshot({
      windows: unpinnedSnapshot.windows.map((window) => ({
        ...window,
        tabs: window.tabs.map((tab) => (tab.id === 201 ? { ...tab, pinned: true } : { ...tab })),
      })),
    });
    vi.mocked(service.loadSnapshot)
      .mockResolvedValueOnce(unpinnedSnapshot)
      .mockResolvedValue(pinnedSnapshot);
    render(<ActiveWindowsPage service={service} />);

    const previewButton = await screen.findByRole('button', { name: 'Show duplicate tabs only' });
    await waitFor(() => expect(previewButton).toBeEnabled());
    await user.click(previewButton);
    expect(screen.getByText('Copy to pin').closest('li')).toHaveClass('is-duplicate-preview-close');

    await user.click(screen.getByRole('button', { name: 'Pin Copy to pin', pressed: false }));

    expect(service.pinTab).toHaveBeenCalledWith(201);
    await waitFor(() =>
      expect(screen.getByText('Copy to pin').closest('li')).toHaveClass(
        'is-duplicate-preview-keep',
      ),
    );
    expect(screen.getByText('Current copy').closest('li')).toHaveClass(
      'is-duplicate-preview-close',
    );
    expect(screen.getByRole('button', { name: 'Pin Copy to pin', pressed: true })).toHaveFocus();
  });

  it('keeps pin and suspend controls together without nesting either action', async () => {
    const service = createService();
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({
                id: 101,
                pinned: true,
                title: 'Pinned suspended tab',
                unloaded: true,
              }),
              createManagedTab({
                active: true,
                id: 102,
                index: 1,
                title: 'Active tab',
              }),
            ],
          }),
        ],
      }),
    );
    render(<ActiveWindowsPage service={service} />);

    const row = (await screen.findByText('Pinned suspended tab')).closest('li');
    const actions = row?.querySelector('.tab-inline-actions');
    expect(actions).not.toBeNull();
    const [pinButton, suspendButton] = within(actions as HTMLElement).getAllByRole('button');
    expect(pinButton).toHaveAccessibleName('Pin Pinned suspended tab');
    expect(pinButton).toHaveAttribute('aria-pressed', 'true');
    expect(suspendButton).toHaveAccessibleName('Suspend Pinned suspended tab');
    expect(suspendButton).toHaveAttribute('aria-pressed', 'true');
    expect(actions?.closest('.tab-focus-button')).toBeNull();
  });

  it('reports duplicate candidates that became pinned before the close', async () => {
    const user = userEvent.setup();
    const service = createDuplicateSelectionService();
    const duplicateUrl = 'https://example.test/newly-pinned';
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({ active: true, id: 101, url: duplicateUrl }),
              createManagedTab({ id: 201, index: 1, url: duplicateUrl }),
              createManagedTab({ id: 202, index: 2, url: duplicateUrl }),
            ],
          }),
        ],
      }),
    );
    vi.mocked(service.closeDuplicateTabs).mockResolvedValue({
      closedTabIds: [],
      closedTabs: [],
      failures: [],
      skippedAgentAssociatedTabIds: [],
      skippedChangedTabIds: [],
      skippedPinnedTabIds: [201, 202],
    });
    render(<ActiveWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Close duplicate tabs: 2 tabs' }));

    expect(service.closeDuplicateTabs).toHaveBeenCalledWith(
      expect.objectContaining({ tabIds: [201, 202] }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '2 duplicate tabs left open because they are now pinned.',
    );
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('describes a changed duplicate match without internal keeper terminology', async () => {
    const user = userEvent.setup();
    const service = createDuplicateSelectionService();
    vi.mocked(service.closeDuplicateTabs).mockResolvedValue({
      closedTabIds: [],
      closedTabs: [],
      failures: [],
      skippedAgentAssociatedTabIds: [],
      skippedChangedTabIds: [201],
      skippedPinnedTabIds: [],
    });
    render(<ActiveWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Close duplicate tabs: 1 tab' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      '1 tab left open because Weaver could not safely confirm it was still a duplicate.',
    );
    expect(alert).not.toHaveTextContent(/keeper/i);
  });

  it('clears the query and selected group when the toolbar enters duplicate tabs view', async () => {
    const user = userEvent.setup();
    const service = createDuplicateSelectionService();
    render(<ActiveWindowsPage service={service} />);

    const selectGroup = await screen.findByRole('checkbox', {
      name: 'Select all tabs in Planning',
    });
    const search = screen.getByRole('searchbox', { name: 'Filter tabs by title or URL' });
    await user.click(selectGroup);
    await user.type(search, 'Hidden selection');
    expect(screen.getByRole('button', { name: 'Clear selected 2' })).toBeInTheDocument();

    const previewButton = screen.getByRole('button', { name: 'Show duplicate tabs only' });
    await waitFor(() => expect(previewButton).toBeEnabled());
    await user.click(previewButton);

    expect(search).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear selected 2' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Duplicate tabs view' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Exit duplicate tabs view' }));
    expect(screen.getByRole('checkbox', { name: 'Select all tabs in Planning' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Hidden selection' })).not.toBeChecked();
  });

  it('clears the query and selected tab when the popup route enters duplicate tabs view', async () => {
    const user = userEvent.setup();
    const service = createDuplicateSelectionService();
    render(<ActiveWindowsPage service={service} />);

    const hiddenSelection = await screen.findByRole('checkbox', {
      name: 'Select Hidden selection',
    });
    const search = screen.getByRole('searchbox', { name: 'Filter tabs by title or URL' });
    await user.click(hiddenSelection);
    await user.type(search, 'Hidden selection');
    expect(screen.getByRole('button', { name: 'Clear selected 1' })).toBeInTheDocument();

    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${APP_LAUNCH_ROUTES.duplicateTabs}`,
    );
    fireEvent(window, new Event('hashchange'));

    expect(await screen.findByRole('status', { name: 'Duplicate tabs view' })).toBeInTheDocument();
    expect(search).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear selected 1' })).not.toBeInTheDocument();
    expect(window.location.hash).toBe(APP_ROUTES.windows);

    await user.click(screen.getByRole('button', { name: 'Exit duplicate tabs view' }));
    expect(screen.getByRole('checkbox', { name: 'Select Hidden selection' })).not.toBeChecked();
  });

  it('limits duplicate-view group selection and bulk actions to visible duplicate tabs', async () => {
    const user = userEvent.setup();
    const service = createDuplicateSelectionService();
    vi.mocked(service.closeTabs).mockResolvedValue({ closedTabIds: [101], failures: [] });
    render(<ActiveWindowsPage service={service} />);

    const previewButton = await screen.findByRole('button', {
      name: 'Show duplicate tabs only',
    });
    await waitFor(() => expect(previewButton).toBeEnabled());
    await user.click(previewButton);
    const selectGroup = screen.getByRole('checkbox', {
      name: 'Select all tabs in Planning',
    });
    const groupFocusButton = screen.getByRole('button', {
      name: 'Focus first tab in Planning',
    });

    expect(groupFocusButton).toHaveProperty('draggable', false);
    const partialGroupDragData = { effectAllowed: '', setData: vi.fn() };
    fireEvent.dragStart(groupFocusButton, { dataTransfer: partialGroupDragData });
    expect(partialGroupDragData.setData).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save Window 1' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Suspend tabs in Window 1' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Unsuspend all tabs in Window 1' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close Window 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Sort Window 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge windows' })).toBeDisabled();
    within(screen.getByRole('group', { name: 'Sort all windows' }))
      .getAllByRole('button')
      .forEach((button) => expect(button).toBeDisabled());

    await user.click(selectGroup);

    expect(selectGroup).toBeChecked();
    expect(screen.getByRole('button', { name: 'Open in new window 1' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Close 1' }));
    await waitFor(() => expect(service.closeTabs).toHaveBeenCalledWith([101]));
    expect(service.closeTabs).not.toHaveBeenCalledWith(expect.arrayContaining([102]));
  });

  it('clears duplicate-view selection whenever the search changes', async () => {
    const user = userEvent.setup();
    const service = createDuplicateSelectionService();
    render(<ActiveWindowsPage service={service} />);

    const previewButton = await screen.findByRole('button', {
      name: 'Show duplicate tabs only',
    });
    await waitFor(() => expect(previewButton).toBeEnabled());
    await user.click(previewButton);
    await user.click(screen.getByRole('checkbox', { name: 'Select Keep this tab' }));
    expect(screen.getByRole('button', { name: 'Close 1' })).toBeEnabled();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter tabs by title or URL' }), {
      target: { value: 'Close this' },
    });

    expect(screen.getByRole('checkbox', { name: 'Select Keep this tab' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Open in new window 0' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close 0' })).toBeDisabled();
    expect(service.closeTabs).not.toHaveBeenCalled();
  });

  it('clears a selected keeper when closing its duplicate removes the live duplicate group', async () => {
    const user = userEvent.setup();
    const service = createDuplicateSelectionService();
    const initialSnapshot = await service.loadSnapshot();
    const postCloseSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          groups: [
            {
              collapsed: false,
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
              id: 101,
              title: 'Keep this tab',
              url: 'https://example.test/same-page',
              windowId: 1,
            }),
            createManagedTab({
              groupId: 7,
              id: 102,
              index: 1,
              title: 'Hidden selection',
              url: 'https://example.test/other',
              windowId: 1,
            }),
          ],
        }),
      ],
    });
    vi.mocked(service.loadSnapshot)
      .mockReset()
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValue(postCloseSnapshot);
    vi.mocked(service.closeDuplicateTabs).mockResolvedValue({
      closedTabIds: [201],
      closedTabs: [],
      failures: [],
      skippedAgentAssociatedTabIds: [],
      skippedChangedTabIds: [],
      skippedPinnedTabIds: [],
    });
    render(<ActiveWindowsPage service={service} />);

    const previewButton = await screen.findByRole('button', {
      name: 'Show duplicate tabs only',
    });
    await waitFor(() => expect(previewButton).toBeEnabled());
    await user.click(previewButton);
    await user.click(screen.getByRole('checkbox', { name: 'Select Keep this tab' }));
    await user.click(
      within(screen.getByRole('status', { name: 'Duplicate tabs view' })).getByRole('button', {
        name: 'Close duplicate tabs: 1 tab',
      }),
    );

    const emptyHeading = await screen.findByRole('heading', { name: 'No duplicate tabs' });
    expect(screen.getByRole('status', { name: 'Duplicate tabs view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open in new window 0' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close 0' })).toBeDisabled();
    expect(service.closeDuplicateTabs).toHaveBeenCalledWith(
      expect.objectContaining({ tabIds: [201] }),
    );

    await user.click(
      within(emptyHeading.closest('.filter-empty') as HTMLElement).getByRole('button', {
        name: 'Show all tabs',
      }),
    );
    expect(screen.getByRole('checkbox', { name: 'Select Keep this tab' })).not.toBeChecked();
  });

  it('renders window identity, groups, tab state, and summary', async () => {
    const service = createService();
    const { container } = render(<ActiveWindowsPage service={service} />);

    expect(await screen.findByRole('heading', { name: 'Window 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Window 2' })).toBeInTheDocument();
    expect(container.querySelector('.window-browser-icon')).not.toBeInTheDocument();
    expect(screen.getByText('2 windows · 3 tabs')).toBeInTheDocument();
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus first tab in Planning' })).toBeInTheDocument();
    expect(screen.getByText('Collapsed')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Pin Quarterly plan', pressed: true }),
    ).toBeInTheDocument();
    const suspendedButton = screen.getByRole('button', {
      name: 'Suspend Issue tracker',
      pressed: true,
    });
    expect(suspendedButton).toHaveAttribute('title', 'Unsuspend tab');
    expect(suspendedButton.querySelector('.tab-suspended-icon-pause')).toBeInTheDocument();
    expect(suspendedButton.querySelector('.tab-suspended-icon-play')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus Issue tracker' })).toHaveAttribute(
      'aria-describedby',
      'tab-102-suspended-description',
    );
    expect(screen.getByRole('button', { name: 'Focus Issue tracker' }).closest('li')).toHaveClass(
      'is-suspended',
    );
    expect(suspendedButton).toHaveTextContent('Reloads when opened.');
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
    await user.click(screen.getByRole('button', { name: 'Sort Window 1 by URL, A to Z' }));
    await screen.findByRole('button', { name: 'Sort Window 1 by URL, Z to A' });
    expect(notifyResize).toBeDefined();
    act(() => notifyResize?.(459));

    await waitFor(() => expect(container.querySelectorAll('.window-grid-column')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Sort Window 1 by: URL' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Sort Window 1 by URL, Z to A' }),
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
    const emptyHeading = screen.getByRole('heading', { name: 'No matching tabs' });
    expect(emptyHeading).toBeInTheDocument();
    expect(
      within(emptyHeading.closest('.filter-empty') as HTMLElement).getByRole('button', {
        name: 'Clear filter',
      }),
    ).toHaveAttribute('title', 'Clear tab filter');
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

    await user.click(screen.getByRole('button', { name: 'Focus first tab in Planning' }));
    expect(service.focusTab).toHaveBeenCalledWith(1, 101);

    await user.click(screen.getByRole('button', { name: 'Focus Issue tracker' }));
    expect(service.focusTab).toHaveBeenLastCalledWith(1, 102);
  });

  it('pins from the reveal control, leaves a group, and retains action focus', async () => {
    const user = userEvent.setup();
    const service = createService();
    const unpinnedSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          groups: [
            {
              collapsed: false,
              color: 'blue',
              id: 7,
              title: 'Research',
              windowId: 1,
            },
          ],
          tabs: [
            createManagedTab({ active: true, id: 101, title: 'Active tab' }),
            createManagedTab({
              groupId: 7,
              id: 102,
              index: 1,
              title: 'Grouped background tab',
            }),
          ],
        }),
      ],
    });
    const pinnedSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          tabs: [
            createManagedTab({
              id: 102,
              pinned: true,
              title: 'Grouped background tab',
            }),
            createManagedTab({ active: true, id: 101, index: 1, title: 'Active tab' }),
          ],
        }),
      ],
    });
    vi.mocked(service.loadSnapshot)
      .mockResolvedValueOnce(unpinnedSnapshot)
      .mockResolvedValue(pinnedSnapshot);
    render(<ActiveWindowsPage service={service} />);

    const groupedRow = (await screen.findByText('Grouped background tab')).closest('li');
    const actions = groupedRow?.querySelector('.tab-inline-actions');
    const [pinButton, suspendButton] = within(actions as HTMLElement).getAllByRole('button');
    expect(pinButton).toHaveAccessibleName('Pin Grouped background tab');
    expect(pinButton).toHaveAttribute('aria-pressed', 'false');
    expect(pinButton).toHaveClass('is-reveal-action');
    expect(pinButton).toHaveAttribute('title', 'Pin tab (removes it from its group)');
    expect(pinButton).toHaveAccessibleDescription('Pinning removes this tab from its group.');
    expect(suspendButton).toHaveAccessibleName('Suspend Grouped background tab');
    expect(suspendButton).toHaveAttribute('aria-pressed', 'false');
    expect(suspendButton).toHaveClass('is-reveal-action');
    expect(screen.getByRole('button', { name: 'Pin Active tab', pressed: false })).toHaveClass(
      'is-reveal-action',
    );
    expect(screen.queryByRole('button', { name: 'Suspend Active tab' })).not.toBeInTheDocument();

    const setDragData = vi.fn();
    fireEvent.dragStart(pinButton as HTMLElement, {
      dataTransfer: { effectAllowed: 'none', setData: setDragData },
    });
    expect(setDragData).not.toHaveBeenCalled();

    await user.click(pinButton as HTMLElement);

    expect(service.pinTab).toHaveBeenCalledWith(102);
    expect(service.focusTab).not.toHaveBeenCalled();
    expect(service.focusWindow).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('button', { name: 'Pin Grouped background tab', pressed: true }),
    ).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Suspend Grouped background tab', pressed: false }),
    ).toHaveClass('is-reveal-action');
    expect(screen.queryByText('Research')).not.toBeInTheDocument();
  });

  it('unpins from the pin control without focusing or starting a drag', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<ActiveWindowsPage service={service} />);

    const unpinButton = await screen.findByRole('button', {
      name: 'Pin Quarterly plan',
      pressed: true,
    });
    expect(unpinButton).toHaveAttribute('title', 'Unpin tab');
    expect(unpinButton.closest('.tab-focus-button')).toBeNull();
    expect(unpinButton.querySelector('.tab-pin-icon-pinned')).toBeInTheDocument();
    expect(unpinButton.querySelector('.tab-pin-icon-unpin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pin Reference', pressed: false })).toHaveClass(
      'is-reveal-action',
    );

    const setDragData = vi.fn();
    fireEvent.dragStart(unpinButton, {
      dataTransfer: { effectAllowed: 'none', setData: setDragData },
    });
    expect(setDragData).not.toHaveBeenCalled();

    await user.click(unpinButton);

    expect(service.unpinTab).toHaveBeenCalledTimes(1);
    expect(service.unpinTab).toHaveBeenCalledWith(101);
    expect(service.focusTab).not.toHaveBeenCalled();
    expect(service.focusWindow).not.toHaveBeenCalled();
    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(2));
  });

  it('reports an unpin failure and leaves the control available', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.unpinTab).mockRejectedValue(new Error('Tab no longer exists'));
    render(<ActiveWindowsPage service={service} />);

    const unpinButton = await screen.findByRole('button', {
      name: 'Pin Quarterly plan',
      pressed: true,
    });
    await user.click(unpinButton);

    expect(service.unpinTab).toHaveBeenCalledWith(101);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The browser could not unpin that tab.',
    );
    expect(unpinButton).toBeEnabled();
    expect(service.loadSnapshot).toHaveBeenCalledTimes(1);
  });

  it('reports a pin failure and leaves the reveal control available', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.pinTab).mockRejectedValue(new Error('Tab no longer exists'));
    render(<ActiveWindowsPage service={service} />);

    const pinButton = await screen.findByRole('button', {
      name: 'Pin Reference',
      pressed: false,
    });
    await user.click(pinButton);

    expect(service.pinTab).toHaveBeenCalledWith(201);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The browser could not pin that tab.',
    );
    expect(pinButton).toBeEnabled();
    expect(pinButton).toHaveClass('is-reveal-action');
    expect(service.loadSnapshot).toHaveBeenCalledTimes(1);
  });

  it('shows a struck-through suspend affordance for the active tab without making it actionable', async () => {
    const service = createService();
    render(<ActiveWindowsPage service={service} />);

    const focusButton = await screen.findByRole('button', { name: 'Focus Quarterly plan' });
    expect(focusButton).toHaveAccessibleDescription(
      'Active tabs cannot be suspended. Select another tab in this window first.',
    );
    const activeRow = focusButton.closest('li');
    const unavailableSuspend = activeRow?.querySelector(
      '.tab-suspended-button.is-unavailable-action',
    );
    expect(unavailableSuspend).not.toBeNull();
    expect(unavailableSuspend).toHaveClass('is-reveal-action');
    expect(unavailableSuspend).toHaveAttribute(
      'title',
      "Active tabs can't be suspended. Select another tab in this window first.",
    );
    expect(unavailableSuspend?.querySelector('.tab-suspended-icon-pause')).toBeInTheDocument();
    expect(
      unavailableSuspend?.querySelector('.tab-suspended-unavailable-slash'),
    ).toBeInTheDocument();
    expect(
      within(activeRow as HTMLElement).queryByRole('button', { name: 'Suspend Quarterly plan' }),
    ).not.toBeInTheDocument();

    fireEvent.click(unavailableSuspend as Element);

    const backgroundWindowFocusButton = screen.getByRole('button', { name: 'Focus Reference' });
    expect(backgroundWindowFocusButton).toHaveAccessibleDescription(
      'Active tabs cannot be suspended. Select another tab in this window first.',
    );
    const backgroundWindowActiveRow = backgroundWindowFocusButton.closest('li');
    const backgroundWindowUnavailableSuspend = backgroundWindowActiveRow?.querySelector(
      '.tab-suspended-button.is-unavailable-action',
    );
    expect(backgroundWindowUnavailableSuspend).not.toBeNull();
    expect(
      within(backgroundWindowActiveRow as HTMLElement).queryByRole('button', {
        name: 'Suspend Reference',
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(backgroundWindowUnavailableSuspend as Element);

    expect(service.suspendTabs).not.toHaveBeenCalled();
    expect(service.focusTab).not.toHaveBeenCalled();
  });

  it('suspends from the reveal control without focusing or dragging the tab', async () => {
    const user = userEvent.setup();
    const service = createService();
    const loadedSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          tabs: [
            createManagedTab({ active: true, id: 101, title: 'Active tab' }),
            createManagedTab({ id: 102, index: 1, title: 'Background tab' }),
          ],
        }),
      ],
    });
    const suspendedSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          tabs: [
            createManagedTab({ active: true, id: 101, title: 'Active tab' }),
            createManagedTab({ discarded: true, id: 102, index: 1, title: 'Background tab' }),
          ],
        }),
      ],
    });
    vi.mocked(service.loadSnapshot)
      .mockResolvedValueOnce(loadedSnapshot)
      .mockResolvedValue(suspendedSnapshot);
    vi.mocked(service.suspendTabs).mockResolvedValue({ affectedTabIds: [102], failures: [] });
    render(<ActiveWindowsPage service={service} />);

    const suspendButton = await screen.findByRole('button', {
      name: 'Suspend Background tab',
      pressed: false,
    });
    expect(suspendButton).toHaveClass('is-reveal-action');
    expect(suspendButton).toHaveAttribute('title', 'Suspend tab');
    expect(screen.queryByRole('button', { name: 'Suspend Active tab' })).not.toBeInTheDocument();

    const setDragData = vi.fn();
    fireEvent.dragStart(suspendButton, {
      dataTransfer: { effectAllowed: 'none', setData: setDragData },
    });
    expect(setDragData).not.toHaveBeenCalled();

    await user.click(suspendButton);

    expect(service.suspendTabs).toHaveBeenCalledWith([102]);
    expect(service.focusTab).not.toHaveBeenCalled();
    expect(service.focusWindow).not.toHaveBeenCalled();
    const unsuspendButton = await screen.findByRole('button', {
      name: 'Suspend Background tab',
      pressed: true,
    });
    expect(unsuspendButton).toHaveClass('is-state-action');
    expect(unsuspendButton).toHaveAttribute('title', 'Unsuspend tab');
    expect(unsuspendButton).toHaveFocus();
  });

  it('reports a row-level suspend failure and leaves the action retryable', async () => {
    const user = userEvent.setup();
    const service = createService();
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({ active: true, id: 101, title: 'Active tab' }),
              createManagedTab({ id: 102, index: 1, title: 'Background tab' }),
            ],
          }),
        ],
      }),
    );
    vi.mocked(service.suspendTabs).mockResolvedValue({
      affectedTabIds: [],
      failures: [{ message: 'Tab is locked', tabId: 102 }],
    });
    render(<ActiveWindowsPage service={service} />);

    const suspendButton = await screen.findByRole('button', {
      name: 'Suspend Background tab',
      pressed: false,
    });
    await user.click(suspendButton);

    expect(service.suspendTabs).toHaveBeenCalledWith([102]);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '1 tab could not be suspended. Tab is locked',
    );
    expect(suspendButton).toBeEnabled();
    expect(suspendButton).toHaveClass('is-reveal-action');
  });

  it('unsuspends from the suspended control without focusing the tab', async () => {
    const user = userEvent.setup();
    const service = createService();
    const suspendedSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          tabs: [
            createManagedTab({ active: true, id: 101, title: 'Active tab' }),
            createManagedTab({ id: 102, index: 1, title: 'Issue tracker', unloaded: true }),
          ],
        }),
      ],
    });
    const loadedSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          tabs: [
            createManagedTab({ active: true, id: 101, title: 'Active tab' }),
            createManagedTab({ id: 102, index: 1, title: 'Issue tracker' }),
          ],
        }),
      ],
    });
    vi.mocked(service.loadSnapshot)
      .mockResolvedValueOnce(suspendedSnapshot)
      .mockResolvedValue(loadedSnapshot);
    vi.mocked(service.unsuspendTabs).mockResolvedValue({ affectedTabIds: [102], failures: [] });
    render(<ActiveWindowsPage service={service} />);

    const suspendedButton = await screen.findByRole('button', {
      name: 'Suspend Issue tracker',
      pressed: true,
    });
    expect(suspendedButton.closest('.tab-focus-button')).toBeNull();
    const setDragData = vi.fn();
    fireEvent.dragStart(suspendedButton, {
      dataTransfer: { effectAllowed: 'none', setData: setDragData },
    });
    expect(setDragData).not.toHaveBeenCalled();

    await user.click(suspendedButton);

    expect(service.unsuspendTabs).toHaveBeenCalledTimes(1);
    expect(service.unsuspendTabs).toHaveBeenCalledWith([102]);
    expect(service.focusTab).not.toHaveBeenCalled();
    expect(service.focusWindow).not.toHaveBeenCalled();
    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(2));
    const suspendButton = screen.getByRole('button', {
      name: 'Suspend Issue tracker',
      pressed: false,
    });
    expect(suspendButton).toHaveClass('is-reveal-action');
    expect(suspendButton).toHaveAttribute('title', 'Suspend tab');
    expect(suspendButton).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Focus Issue tracker' }));
    expect(service.focusTab).toHaveBeenCalledWith(1, 102);
    expect(service.unsuspendTabs).toHaveBeenCalledTimes(1);
  });

  it('falls back to the tab focus control when a suspension action becomes unavailable', async () => {
    const user = userEvent.setup();
    const service = createService();
    const suspendedSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          tabs: [
            createManagedTab({ active: true, id: 101, title: 'Previously active tab' }),
            createManagedTab({ id: 102, index: 1, title: 'Issue tracker', unloaded: true }),
          ],
        }),
      ],
    });
    const newlyActiveSnapshot = createActiveWindowsSnapshot({
      windows: [
        createManagedWindow({
          tabs: [
            createManagedTab({ id: 101, title: 'Previously active tab' }),
            createManagedTab({ active: true, id: 102, index: 1, title: 'Issue tracker' }),
          ],
        }),
      ],
    });
    vi.mocked(service.loadSnapshot)
      .mockResolvedValueOnce(suspendedSnapshot)
      .mockResolvedValue(newlyActiveSnapshot);
    vi.mocked(service.unsuspendTabs).mockResolvedValue({ affectedTabIds: [102], failures: [] });
    render(<ActiveWindowsPage service={service} />);

    await user.click(
      await screen.findByRole('button', { name: 'Suspend Issue tracker', pressed: true }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Suspend Issue tracker' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Focus Issue tracker' })).toHaveFocus();
  });

  it('collapses from header whitespace without hijacking identity or action controls', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<ActiveWindowsPage service={service} />);

    const heading = await screen.findByRole('heading', { name: 'Window 1' });
    const card = heading.closest('article');
    const header = heading.closest('header');
    expect(card).not.toBeNull();
    expect(header).not.toBeNull();
    const tabList = (card as HTMLElement).querySelector('#window-1-tabs');
    expect(tabList).not.toBeNull();
    expect(tabList?.querySelectorAll('.tab-list-item')).toHaveLength(2);

    const collapseButton = within(header as HTMLElement).getByRole('button', {
      name: 'Collapse Window 1',
    });
    const titleButton = within(header as HTMLElement).getByRole('button', { name: 'Window 1' });
    const sortButton = within(header as HTMLElement).getByRole('button', {
      name: 'Sort Window 1 by Title, A to Z',
    });
    const selectAllCheckbox = within(header as HTMLElement).getByRole('checkbox', {
      name: 'Select all visible tabs in Window 1',
    });
    expect(collapseButton.parentElement).toBe(header);
    expect(collapseButton).not.toBe(titleButton);
    expect(collapseButton).not.toContainElement(selectAllCheckbox);
    expect(collapseButton).not.toContainElement(titleButton);
    expect(collapseButton).not.toContainElement(sortButton);
    expect(collapseButton).toHaveAttribute('aria-controls', 'window-1-tabs');
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(card as HTMLElement).getByRole('button', { name: 'Focus Quarterly plan' }),
    ).toBeVisible();

    await user.click(titleButton);
    expect(service.focusWindow).toHaveBeenCalledWith(1);
    expect(card).not.toHaveClass('is-collapsed');

    await user.click(sortButton);
    expect(card).not.toHaveClass('is-collapsed');

    await user.click(collapseButton);

    expect(card).toHaveClass('is-collapsed');
    expect(
      within(header as HTMLElement).getByRole('button', { name: 'Expand Window 1' }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(within(header as HTMLElement).queryByText('Collapsed')).not.toBeInTheDocument();
    expect(tabList).toHaveAttribute('hidden');
    expect(tabList?.querySelectorAll('.tab-list-item')).toHaveLength(0);
    expect(
      within(card as HTMLElement).queryByRole('button', { name: 'Focus Quarterly plan' }),
    ).not.toBeInTheDocument();

    await user.click(selectAllCheckbox);
    expect(card).toHaveClass('is-collapsed');

    await user.click(
      within(header as HTMLElement).getByRole('button', {
        name: 'Expand Window 1',
      }),
    );
    expect(card).not.toHaveClass('is-collapsed');
    expect(tabList).not.toHaveAttribute('hidden');
    expect(tabList?.querySelectorAll('.tab-list-item')).toHaveLength(2);
    expect(
      within(card as HTMLElement).getByRole('button', { name: 'Focus Quarterly plan' }),
    ).toBeVisible();

    const collapseAgain = within(header as HTMLElement).getByRole('button', {
      name: 'Collapse Window 1',
    });
    collapseAgain.focus();
    await user.keyboard('{Enter}');
    const search = screen.getByRole('searchbox', { name: 'Filter tabs by title or URL' });
    await user.type(search, 'Reference');
    expect(screen.queryByRole('heading', { name: 'Window 1' })).not.toBeInTheDocument();

    await user.clear(search);
    const restoredHeading = await screen.findByRole('heading', { name: 'Window 1' });
    const restoredCard = restoredHeading.closest('article');
    expect(restoredCard).toHaveClass('is-collapsed');
    expect(
      within(restoredCard as HTMLElement).getByRole('button', { name: 'Expand Window 1' }),
    ).toHaveAttribute('aria-expanded', 'false');
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
      'All background tabs are suspended. Your browser keeps the active tab loaded.',
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
    const selectFilteredButton = screen.getByRole('button', { name: 'Select filtered 2' });
    expect(selectFilteredButton).toHaveAttribute('title', 'Select filtered tabs');
    await user.click(selectFilteredButton);
    expect(screen.getByRole('checkbox', { name: 'Select Quarterly plan' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Issue tracker' })).toBeChecked();

    const clearSelectedButton = screen.getByRole('button', { name: 'Clear selected 2' });
    expect(clearSelectedButton).toHaveAttribute('title', 'Clear selected tabs');
    await user.click(clearSelectedButton);
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
    await user.click(screen.getByRole('button', { name: 'Open in new window 2' }));

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
    await user.click(screen.getByRole('button', { name: 'Open in new window 2' }));

    await waitFor(() => {
      expect(service.moveTabsToNewWindow).toHaveBeenCalledWith([101, 102], [7]);
    });
  });

  it('does not offer a new window for the only tab in a single-tab window', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<ActiveWindowsPage service={service} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Select Reference' }));
    const newWindowButton = screen.getByRole('button', { name: 'Open in new window 1' });

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
    const currentWindowSort = within(currentWindow as HTMLElement).getByRole('button', {
      name: 'Sort Window 1 by URL, A to Z',
    });
    expect(currentWindowSort).toHaveTextContent('Sort');
    expect(currentWindowSort.querySelector('.lucide-arrow-up-down')).toBeInTheDocument();
    await user.click(currentWindowSort);
    const reverseCurrentWindowSort = await within(currentWindow as HTMLElement).findByRole(
      'button',
      {
        name: 'Sort Window 1 by URL, Z to A',
      },
    );
    expect(reverseCurrentWindowSort.querySelector('.lucide-arrow-up')).toBeInTheDocument();
    expect(reverseCurrentWindowSort).toHaveFocus();
    await user.click(reverseCurrentWindowSort);
    expect(service.sortWindow).toHaveBeenCalledWith(1, {
      criterion: 'url',
      direction: 'desc',
    });

    await user.click(
      within(otherWindow as HTMLElement).getByRole('button', {
        name: 'Sort Window 2 by Title, A to Z',
      }),
    );
    expect(service.sortWindow).toHaveBeenLastCalledWith(2, {
      criterion: 'title',
      direction: 'asc',
    });
    expect(
      within(otherWindow as HTMLElement).getByRole('button', {
        name: 'Sort Window 2 by Title, Z to A',
      }),
    ).toHaveAccessibleDescription('Currently sorted by Title, A to Z.');

    await user.click(screen.getByRole('button', { name: 'Sort all windows by: Title' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'URL' }));
    const globalSort = screen.getByRole('button', {
      name: 'Sort all windows by URL, A to Z',
    });
    expect(globalSort.querySelector('.lucide-arrow-up-down')).toBeInTheDocument();
    await user.click(globalSort);
    await user.click(
      await screen.findByRole('button', { name: 'Sort all windows by URL, Z to A' }),
    );
    expect(service.sortAllWindows).toHaveBeenCalledWith({
      criterion: 'url',
      direction: 'desc',
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

    const sortButton = await screen.findByRole('button', {
      name: 'Sort all windows by Title, A to Z',
    });
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
    expect(trigger).toHaveAttribute('title', 'Choose sort field: Title or URL');
    const firstWindow = screen.getByRole('heading', { name: 'Window 1' }).closest('article');
    expect(firstWindow).not.toBeNull();
    expect(
      within(firstWindow as HTMLElement).getByRole('button', {
        name: 'Sort Window 1 by: Title',
      }),
    ).toHaveAttribute('title', 'Choose sort field: Title or URL');
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

  it('provides concise native tooltips for the main Active Windows controls', async () => {
    render(<ActiveWindowsPage service={createService()} />);

    expect(
      await screen.findByRole('searchbox', { name: 'Filter tabs by title or URL' }),
    ).toHaveAttribute('title', 'Filter tabs by title or URL');
    expect(screen.getByRole('button', { name: 'Select filtered 3' })).toHaveAttribute(
      'title',
      'Select filtered tabs',
    );
    expect(screen.getByRole('button', { name: 'Open in new window 0' })).toHaveAttribute(
      'title',
      'Move selected tabs to a new window',
    );
    expect(screen.getByRole('button', { name: 'Close 0' })).toHaveAttribute(
      'title',
      'Close selected tabs',
    );
    const closeButton = screen.getByRole('button', { name: 'Close 0' });
    const openInNewWindowButton = screen.getByRole('button', { name: 'Open in new window 0' });
    expect(openInNewWindowButton.compareDocumentPosition(closeButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(closeButton.querySelector('.lucide-x')).toBeInTheDocument();
    expect(closeButton.querySelector('.lucide-trash-2')).not.toBeInTheDocument();
  });

  it('merges selected windows in display order', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<ActiveWindowsPage service={service} />);

    const mergeButton = await screen.findByRole('button', { name: 'Merge windows' });
    expect(mergeButton).toHaveAttribute('aria-controls', 'merge-windows-dialog');
    expect(mergeButton).toHaveAttribute('aria-haspopup', 'dialog');
    expect(mergeButton).toHaveClass('toolbar-button', 'topbar-merge-button');
    expect(mergeButton).not.toHaveClass('merge-apply-button');
    const firstCard = screen.getByRole('heading', { name: 'Window 1' }).closest('article');
    const secondCard = screen.getByRole('heading', { name: 'Window 2' }).closest('article');
    vi.spyOn(mergeButton, 'getBoundingClientRect').mockReturnValue({ left: 200 } as DOMRect);
    await user.click(mergeButton);
    const dialog = screen.getByRole('dialog', { name: 'Merge windows' });
    expect(dialog.parentElement).toHaveClass('merge-control');
    expect(dialog).toHaveStyle({ left: '0px' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('0 selected')).toBeInTheDocument();
    expect(within(dialog).queryByText('Destination')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Select windows')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText('The first selected window in the list stays open.'),
    ).not.toBeInTheDocument();
    const firstWindowCheckbox = within(dialog).getByRole('checkbox', {
      name: /Window 1.*Quarterly plan.*2 tabs/,
    });
    const secondWindowCheckbox = within(dialog).getByRole('checkbox', {
      name: /Window 2.*Reference.*1 tab/,
    });
    const selectAll = within(dialog).getByRole('button', { name: 'Select all' });
    expect(selectAll.closest('footer')).toBe(dialog.querySelector('footer'));
    expect(selectAll.querySelector('.lucide-list-checks')).toBeInTheDocument();
    await user.click(selectAll);
    expect(firstWindowCheckbox).toBeChecked();
    expect(secondWindowCheckbox).toBeChecked();
    const clearAll = within(dialog).getByRole('button', { name: 'Clear all' });
    expect(clearAll.querySelector('.lucide-list-x')).toBeInTheDocument();
    await user.click(clearAll);
    expect(firstWindowCheckbox).not.toBeChecked();
    expect(secondWindowCheckbox).not.toBeChecked();

    const applyButton = within(dialog).getByRole('button', { name: 'Merge windows' });
    expect(applyButton).toBeDisabled();
    await user.click(secondWindowCheckbox);
    expect(applyButton).toBeDisabled();
    expect(secondWindowCheckbox).toHaveFocus();
    expect(secondCard).toHaveClass('is-merge-selected');
    await user.click(firstWindowCheckbox);
    expect(firstCard).toHaveClass('is-merge-selected');
    expect(firstWindowCheckbox.closest('label')).toHaveClass('is-selected');
    const enabledApplyButton = within(dialog).getByRole('button', { name: 'Merge 2 windows' });
    expect(enabledApplyButton).toHaveClass('toolbar-button', 'merge-apply-button');
    await user.click(enabledApplyButton);

    await waitFor(() => expect(service.mergeWindows).toHaveBeenCalledWith([1, 2]));
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

  it('closes Merge without stealing focus when keyboard focus leaves the dialog', async () => {
    const user = userEvent.setup();
    render(<ActiveWindowsPage service={createService()} />);

    const mergeButton = await screen.findByRole('button', { name: 'Merge windows' });
    await user.click(mergeButton);
    const dialog = screen.getByRole('dialog', { name: 'Merge windows' });
    const selectAllButton = within(dialog).getByRole('button', { name: 'Select all' });

    selectAllButton.focus();
    await user.tab();

    expect(screen.queryByRole('dialog', { name: 'Merge windows' })).not.toBeInTheDocument();
    expect(mergeButton).not.toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('closes Merge with Escape', async () => {
    const user = userEvent.setup();
    render(<ActiveWindowsPage service={createService()} />);

    const mergeButton = await screen.findByRole('button', { name: 'Merge windows' });
    await user.click(mergeButton);
    expect(screen.getByRole('dialog', { name: 'Merge windows' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Merge windows' })).not.toBeInTheDocument();
    await waitFor(() => expect(mergeButton).toHaveFocus());
  });

  it('removes duplicates while keeping the active copy in the current window', async () => {
    const user = userEvent.setup();
    const service = createService();
    const duplicateUrl = 'https://example.test/same';
    let resolveDuplicateClose: ((result: CloseDuplicateTabsResult) => void) | null = null;
    let currentSnapshot = createActiveWindowsSnapshot({
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
    });
    const listeners = new Set<() => void>();
    vi.mocked(service.loadSnapshot).mockImplementation(() => Promise.resolve(currentSnapshot));
    service.subscribe = vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    const duplicateCloseResult: CloseDuplicateTabsResult = {
      closedTabIds: [101, 201],
      closedTabs: [
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
      ],
      failures: [],
      skippedAgentAssociatedTabIds: [],
      skippedChangedTabIds: [],
      skippedPinnedTabIds: [],
    };
    vi.mocked(service.closeDuplicateTabs).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDuplicateClose = resolve;
        }),
    );
    render(<ActiveWindowsPage service={service} />);

    const removeButton = await screen.findByRole('button', {
      name: 'Close duplicate tabs: 2 tabs',
    });
    await waitFor(() => expect(removeButton).toBeEnabled());
    await user.click(removeButton);

    expect(service.closeDuplicateTabs).toHaveBeenCalledWith(
      expect.objectContaining({ tabIds: [101, 201] }),
    );
    expect(screen.queryByText('Removing 2 duplicates')).not.toBeInTheDocument();
    expect(screen.getByText('Closing 2 duplicate tabs')).toHaveClass('sr-only');
    expect(removeButton).toBeDisabled();
    expect(removeButton).toHaveAccessibleName('Closing duplicate tabs');
    expect(removeButton).toHaveAttribute('aria-busy', 'true');
    expect(removeButton).toHaveClass('is-removing-duplicates');
    expect(within(removeButton).getByText('2')).toHaveClass('toolbar-count');
    expect(screen.getByRole('button', { name: 'Show duplicate tabs only' })).toBeDisabled();

    currentSnapshot = createActiveWindowsSnapshot({
      windows: currentSnapshot.windows.map((activeWindow) => {
        const tabs = activeWindow.tabs.filter((tab) => tab.id !== 101);
        return {
          ...activeWindow,
          tabs:
            activeWindow.id === 2
              ? [
                  ...tabs,
                  createManagedTab({
                    id: 301,
                    index: 1,
                    url: duplicateUrl,
                    windowId: 2,
                  }),
                ]
              : tabs,
        };
      }),
    });
    act(() => listeners.forEach((listener) => listener()));

    const updatedRemoveButton = await screen.findByRole('button', {
      name: 'Closing duplicate tabs',
    });
    expect(updatedRemoveButton).toBe(removeButton);
    expect(updatedRemoveButton).toHaveAttribute('aria-busy', 'true');
    expect(updatedRemoveButton).toHaveClass('is-removing-duplicates');
    await waitFor(() =>
      expect(within(updatedRemoveButton).getByText('1')).toHaveClass('toolbar-count'),
    );
    expect(screen.getByText('Closing 2 duplicate tabs')).toHaveClass('sr-only');

    currentSnapshot = createActiveWindowsSnapshot({
      windows: currentSnapshot.windows.map((activeWindow) => ({
        ...activeWindow,
        tabs: activeWindow.tabs.filter((tab) => tab.id !== 201),
      })),
    });
    act(() => listeners.forEach((listener) => listener()));

    await waitFor(() => expect(within(removeButton).getByText('0')).toHaveClass('toolbar-count'));
    expect(removeButton).toHaveAccessibleName('Closing duplicate tabs');
    expect(removeButton).toHaveAttribute('aria-busy', 'true');
    expect(removeButton).toHaveClass('is-removing-duplicates');
    expect(screen.queryByText('Closing 1 duplicate tab')).not.toBeInTheDocument();

    await act(async () => {
      resolveDuplicateClose?.(duplicateCloseResult);
      await Promise.resolve();
    });

    expect(await screen.findByText('2 duplicate tabs removed.')).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Close duplicate tabs: 1 tab' });
    expect(removeButton).toBeEnabled();
    expect(removeButton).not.toHaveAttribute('aria-busy');
    expect(removeButton).not.toHaveClass('is-removing-duplicates');
    const undoButton = screen.getByRole('button', { name: 'Undo' });
    expect(undoButton).toHaveAttribute('title', 'Restore closed duplicate tabs');
    await user.click(undoButton);

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

  it('previews the duplicate keeper and closures without changing tabs', async () => {
    class ResizeObserverMock {
      readonly disconnect = vi.fn();
      readonly unobserve = vi.fn();

      constructor(private readonly callback: ResizeObserverCallback) {}

      observe = (target: Element) => {
        this.callback([{ contentRect: { width: 1412 }, target } as ResizeObserverEntry], this);
      };
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const user = userEvent.setup();
    const service = createService();
    const duplicateUrl = 'https://example.test/same';
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({
                active: true,
                id: 101,
                title: 'Keep this tab',
                url: duplicateUrl,
                windowId: 1,
              }),
              createManagedTab({
                active: false,
                id: 102,
                index: 1,
                title: 'Unrelated tab',
                url: 'https://example.test/other',
                windowId: 1,
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
                title: 'Close this tab',
                url: duplicateUrl,
                windowId: 2,
              }),
            ],
          }),
          createManagedWindow({
            focused: false,
            id: 3,
            isCurrent: false,
            label: 'Window 3',
            tabs: [
              createManagedTab({
                active: true,
                id: 301,
                title: 'Third window tab',
                url: 'https://example.test/third',
                windowId: 3,
              }),
            ],
          }),
        ],
      }),
    );
    const { container } = render(<ActiveWindowsPage service={service} />);

    await screen.findByRole('heading', { name: 'Window 3' });
    await waitFor(() => expect(container.querySelectorAll('.window-grid-column')).toHaveLength(3));
    const initialColumns = container.querySelectorAll('.window-grid-column');
    expect(
      within(initialColumns[0] as HTMLElement).getByRole('heading', { name: 'Window 1' }),
    ).toBeInTheDocument();
    expect(
      within(initialColumns[1] as HTMLElement).getByRole('heading', { name: 'Window 2' }),
    ).toBeInTheDocument();
    expect(
      within(initialColumns[2] as HTMLElement).getByRole('heading', { name: 'Window 3' }),
    ).toBeInTheDocument();

    const previewButton = await screen.findByRole('button', {
      name: 'Show duplicate tabs only',
    });
    await waitFor(() => expect(previewButton).toBeEnabled());
    await user.click(previewButton);

    const previewToggle = screen.getByRole('button', { name: 'Show duplicate tabs only' });
    expect(previewToggle).toHaveAttribute('aria-pressed', 'true');
    expect(previewToggle).toHaveAttribute('title', 'Show all tabs');
    expect(screen.getByRole('status', { name: 'Duplicate tabs view' })).toHaveTextContent(
      'Tabs labeled Keep stay open, including pinned matches and agent-associated matches with ongoing or unclear activity. Duplicate cleanup closes tabs labeled Close.',
    );
    expect(screen.queryByRole('dialog', { name: 'Duplicate tab preview' })).not.toBeInTheDocument();
    expect(screen.getByText('Keep this tab').closest('li')).toHaveClass(
      'is-duplicate-preview-keep',
    );
    expect(screen.getByText('Close this tab').closest('li')).toHaveClass(
      'is-duplicate-preview-close',
    );
    expect(screen.queryByText('Unrelated tab')).not.toBeInTheDocument();
    expect(screen.queryByText('Third window tab')).not.toBeInTheDocument();
    const previewColumns = container.querySelectorAll('.window-grid-column');
    expect(previewColumns).toHaveLength(3);
    expect(
      within(previewColumns[0] as HTMLElement).getByRole('heading', { name: 'Window 1' }),
    ).toBeInTheDocument();
    expect(
      within(previewColumns[1] as HTMLElement).getByRole('heading', { name: 'Window 2' }),
    ).toBeInTheDocument();
    expect(previewColumns[2]).toBeEmptyDOMElement();
    expect(service.closeTabs).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Exit duplicate tabs view' }));

    expect(await screen.findByText('Unrelated tab')).toBeInTheDocument();
    expect(screen.getByText('Third window tab')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show duplicate tabs only' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('filters duplicate groups atomically and closes only the visible group', async () => {
    const user = userEvent.setup();
    const service = createService();
    const createDuplicateSnapshot = (includeFirstCopy: boolean) =>
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({
                active: true,
                id: 101,
                title: 'Needle keeper',
                url: 'https://example.test/first-duplicate',
                windowId: 1,
              }),
              createManagedTab({
                id: 102,
                index: 1,
                title: 'Other keeper',
                url: 'https://example.test/second-duplicate',
                windowId: 1,
              }),
            ],
          }),
          createManagedWindow({
            focused: false,
            id: 2,
            isCurrent: false,
            label: 'Window 2',
            tabs: [
              ...(includeFirstCopy
                ? [
                    createManagedTab({
                      active: true,
                      id: 201,
                      title: 'First mirrored copy',
                      url: 'https://example.test/first-duplicate',
                      windowId: 2,
                    }),
                  ]
                : []),
              createManagedTab({
                active: !includeFirstCopy,
                id: 202,
                index: includeFirstCopy ? 1 : 0,
                title: 'Other mirrored copy',
                url: 'https://example.test/second-duplicate',
                windowId: 2,
              }),
            ],
          }),
        ],
      });
    vi.mocked(service.loadSnapshot)
      .mockResolvedValueOnce(createDuplicateSnapshot(true))
      .mockResolvedValue(createDuplicateSnapshot(false));
    vi.mocked(service.closeDuplicateTabs).mockResolvedValue({
      closedTabIds: [201],
      closedTabs: [
        {
          group: null,
          index: 0,
          originalTabId: 201,
          pinned: false,
          title: 'First mirrored copy',
          url: 'https://example.test/first-duplicate',
          windowId: 2,
        },
      ],
      failures: [],
      skippedAgentAssociatedTabIds: [],
      skippedChangedTabIds: [],
      skippedPinnedTabIds: [],
    });
    render(<ActiveWindowsPage service={service} />);

    const previewButton = await screen.findByRole('button', {
      name: 'Show duplicate tabs only',
    });
    await waitFor(() => expect(previewButton).toBeEnabled());
    await user.click(previewButton);
    await user.type(
      screen.getByRole('searchbox', { name: 'Filter tabs by title or URL' }),
      'Needle',
    );

    expect(screen.getByText('Needle keeper').closest('li')).toHaveClass(
      'is-duplicate-preview-keep',
    );
    expect(screen.getByText('First mirrored copy').closest('li')).toHaveClass(
      'is-duplicate-preview-close',
    );
    expect(screen.queryByText('Other keeper')).not.toBeInTheDocument();
    expect(screen.queryByText('Other mirrored copy')).not.toBeInTheDocument();
    const closeButton = within(
      screen.getByRole('group', { name: 'Duplicate tab actions' }),
    ).getByRole('button', {
      name: 'Close filtered duplicate tabs: 1 tab',
    });
    expect(closeButton).toHaveAttribute('title', 'Close filtered duplicate tabs');
    expect(
      within(screen.getByRole('status', { name: 'Duplicate tabs view' })).getByRole('button', {
        name: 'Close filtered duplicate tabs: 1 tab',
      }),
    ).toHaveAttribute('title', 'Close filtered duplicate tabs');

    await user.click(closeButton);

    expect(service.closeDuplicateTabs).toHaveBeenCalledWith(
      expect.objectContaining({ tabIds: [201] }),
    );
    expect(await screen.findByRole('status', { name: 'Duplicate tabs view' })).toBeInTheDocument();
    const noMatches = await screen.findByRole('heading', {
      name: 'No matching duplicate tabs',
    });
    await user.click(
      within(noMatches.closest('.filter-empty') as HTMLElement).getByRole('button', {
        name: 'Clear filter',
      }),
    );
    expect(await screen.findByText('Other keeper')).toBeInTheDocument();
    expect(screen.getByText('Other mirrored copy')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(service.restoreTabs).toHaveBeenCalledWith([
      expect.objectContaining({ originalTabId: 201 }),
    ]);
  });

  it('distinguishes a duplicate filter with no matching groups and clears it', async () => {
    const user = userEvent.setup();
    render(<ActiveWindowsPage service={createDuplicateSelectionService()} />);

    const previewButton = await screen.findByRole('button', {
      name: 'Show duplicate tabs only',
    });
    await waitFor(() => expect(previewButton).toBeEnabled());
    await user.click(previewButton);
    const search = screen.getByRole('searchbox', { name: 'Filter tabs by title or URL' });
    await user.type(search, 'No tab has this text');

    const heading = screen.getByRole('heading', { name: 'No matching duplicate tabs' });
    const emptyState = heading.closest('.filter-empty');
    expect(emptyState).not.toBeNull();
    expect(
      within(emptyState as HTMLElement).getByRole('button', { name: 'Clear filter' }),
    ).toHaveAttribute('title', 'Clear tab filter');
    const closeButton = within(
      screen.getByRole('group', { name: 'Duplicate tab actions' }),
    ).getByRole('button', {
      name: 'Close filtered duplicate tabs: 0 tabs',
    });
    expect(closeButton).toBeDisabled();
    const bannerCloseButton = within(
      screen.getByRole('status', { name: 'Duplicate tabs view' }),
    ).getByRole('button', { name: 'Close filtered duplicate tabs: 0 tabs' });
    expect(bannerCloseButton).toBeDisabled();
    expect(within(bannerCloseButton).getByText('0')).toHaveClass('toolbar-count');

    await user.click(
      within(emptyState as HTMLElement).getByRole('button', { name: 'Clear filter' }),
    );

    expect(search).toHaveValue('');
    expect(await screen.findByText('Keep this tab')).toBeInTheDocument();
    expect(screen.getByText('Close this tab')).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Duplicate tab actions' })).getByRole('button', {
        name: 'Close duplicate tabs: 1 tab',
      }),
    ).toBeEnabled();
  });

  it('reports a genuinely empty duplicate plan without calling it a filter miss', async () => {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${APP_LAUNCH_ROUTES.duplicateTabs}`,
    );
    render(<ActiveWindowsPage service={createService()} />);

    const heading = await screen.findByRole('heading', { name: 'No duplicate tabs' });
    const emptyState = heading.closest('.filter-empty');
    expect(emptyState).not.toBeNull();
    expect(
      within(emptyState as HTMLElement).getByRole('button', { name: 'Show all tabs' }),
    ).toHaveAttribute('title', 'Exit duplicate tabs view');
    expect(
      within(emptyState as HTMLElement).queryByRole('button', { name: 'Clear filter' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'No matching duplicate tabs' }),
    ).not.toBeInTheDocument();
  });

  it('waits for advanced duplicate settings before declaring the plan empty', async () => {
    const service = createService();
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({
                active: true,
                id: 101,
                title: 'Workspace one',
                url: 'https://app.example.test/one',
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
                title: 'Workspace two',
                url: 'https://app.example.test/two',
                windowId: 2,
              }),
            ],
          }),
        ],
      }),
    );
    const rules: DedupeRule[] = [
      {
        comparisonMode: 'host',
        enabled: true,
        glob: 'app.example.test/*',
        id: 'custom-host',
      },
    ];
    const loadedSettings = {
      ...DEFAULT_SETTINGS,
      advancedDuplicateMatchingEnabled: true,
      deduplicationRules: rules,
    };
    let resolveSettings: (settings: typeof loadedSettings) => void = () => undefined;
    const settingsPromise = new Promise<typeof loadedSettings>((resolve) => {
      resolveSettings = resolve;
    });
    const settingsService = createSettingsService(rules);
    vi.mocked(settingsService.load).mockReturnValue(settingsPromise);
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${APP_LAUNCH_ROUTES.duplicateTabs}`,
    );

    render(<ActiveWindowsPage service={service} settingsService={settingsService} />);

    expect(
      await screen.findByRole('heading', { name: 'Loading duplicate tabs…' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No duplicate tabs' })).not.toBeInTheDocument();

    resolveSettings(loadedSettings);
    await act(() => settingsPromise);

    expect(await screen.findByText('Workspace one')).toBeInTheDocument();
    expect(screen.getByText('Workspace two')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Loading duplicate tabs…' }),
    ).not.toBeInTheDocument();
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
    vi.mocked(service.closeDuplicateTabs).mockResolvedValue({
      closedTabIds: [201],
      closedTabs: [],
      failures: [],
      skippedAgentAssociatedTabIds: [],
      skippedChangedTabIds: [],
      skippedPinnedTabIds: [],
    });
    const settingsService = createSettingsService([
      {
        comparisonMode: 'host',
        enabled: true,
        glob: 'app.example.test/*',
        id: 'custom-host',
      },
    ]);
    render(<ActiveWindowsPage service={service} settingsService={settingsService} />);

    const removeButton = await screen.findByRole('button', {
      name: 'Close duplicate tabs: 1 tab',
    });
    await user.click(removeButton);

    expect(service.closeDuplicateTabs).toHaveBeenCalledWith(
      expect.objectContaining({ tabIds: [201] }),
    );
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

    const closeDuplicatesButton = await screen.findByRole('button', {
      name: 'Close duplicate tabs: 1 tab',
    });
    await waitFor(() => expect(closeDuplicatesButton).toBeEnabled(), { timeout: 5_000 });
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
                url: 'https://notion.com/p/acme/Project-Plan-00000000000000000000000000000000',
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
                url: 'https://notion.com/p/acme/Project-Plan-00000000000000000000000000000000?showMoveTo=true#block-one',
                windowId: 2,
              }),
              createManagedTab({
                id: 202,
                index: 1,
                url: 'https://notion.com/p/acme/Project-Plan-00000000000000000000000000000000?saveParent=true#block-two',
                windowId: 2,
              }),
            ],
          }),
        ],
      }),
    );
    vi.mocked(service.closeDuplicateTabs).mockResolvedValue({
      closedTabIds: [201, 202],
      closedTabs: [],
      failures: [],
      skippedAgentAssociatedTabIds: [],
      skippedChangedTabIds: [],
      skippedPinnedTabIds: [],
    });
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

    await user.click(await screen.findByRole('button', { name: 'Close duplicate tabs: 2 tabs' }));

    expect(service.closeDuplicateTabs).toHaveBeenCalledWith(
      expect.objectContaining({ tabIds: [201, 202] }),
    );
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

  it('tells users to unpin first when a pinned tab is dropped on a group', async () => {
    const service = createService();
    vi.mocked(service.loadSnapshot).mockResolvedValue(
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({
                active: true,
                id: 101,
                pinned: true,
                title: 'Pinned source',
              }),
            ],
          }),
          createManagedWindow({
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
              createManagedTab({
                active: true,
                groupId: 8,
                id: 201,
                title: 'Grouped destination',
                windowId: 2,
              }),
            ],
          }),
        ],
      }),
    );
    vi.mocked(service.moveTab).mockRejectedValue(new Error(PINNED_TAB_GROUP_MOVE_ERROR_MESSAGE));
    render(<ActiveWindowsPage service={service} />);
    const sourceButton = await screen.findByRole('button', { name: 'Focus Pinned source' });
    const destinationRow = screen
      .getByRole('button', { name: 'Focus Grouped destination' })
      .closest('li');
    const destinationList = destinationRow?.closest('ul');
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(sourceButton, { dataTransfer });
    fireEvent.dragOver(destinationRow as HTMLElement, { clientY: -1, dataTransfer });
    fireEvent.drop(destinationList as HTMLElement, { dataTransfer });
    fireEvent.dragEnd(sourceButton, { dataTransfer });

    await waitFor(() => expect(service.moveTab).toHaveBeenCalledWith(101, 2, 0, 8));
    expect(await screen.findByRole('alert')).toHaveTextContent(PINNED_TAB_GROUP_MOVE_ERROR_MESSAGE);
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

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    expect(retryButton).toHaveAttribute('title', 'Retry loading windows');
    await user.click(retryButton);
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

  it('keeps a saved window in closing state until it disappears from the live snapshot', async () => {
    const user = userEvent.setup();
    const service = createService();
    let currentSnapshot = await service.loadSnapshot();
    const listeners = new Set<() => void>();
    vi.mocked(service.loadSnapshot).mockClear();
    vi.mocked(service.loadSnapshot).mockImplementation(() => Promise.resolve(currentSnapshot));
    service.subscribe = vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    });
    const savedWindowsService = createSavedWindowsService();
    const result = createSaveWindowResult('Project work', true);
    const finish = vi.mocked(requireFastClose(result).finish);
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(result);
    render(<ActiveWindowsPage savedWindowsService={savedWindowsService} service={service} />);

    const selectClosingWindow = await screen.findByRole('checkbox', {
      name: 'Select all visible tabs in Window 1',
    });
    await user.click(selectClosingWindow);
    const sourceCard = selectClosingWindow.closest('article');
    await user.click(
      within(sourceCard as HTMLElement).getByRole('button', { name: 'Collapse Window 1' }),
    );
    expect(sourceCard).toHaveClass('is-collapsed');
    await user.click(screen.getByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Project work');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

    expect(screen.queryByRole('dialog', { name: 'Save window' })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Saved "Project work"\. .*closing Window 1/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Saved "Project work" and closed Window 1.')).not.toBeInTheDocument();
    const closingCard = screen.getByRole('heading', { name: 'Window 1' }).closest('article');
    expect(closingCard).toHaveClass('is-closing');
    expect(closingCard).toHaveAttribute('aria-busy', 'true');
    const closingStatus = within(closingCard as HTMLElement)
      .getByText('Closing…')
      .closest<HTMLElement>('.window-card-closing-status');
    expect(closingStatus).toBeVisible();
    expect(closingStatus).toHaveAttribute('role', 'status');
    expect(closingStatus).toHaveAttribute('aria-live', 'polite');
    expect(closingStatus).toHaveAttribute('aria-atomic', 'true');
    expect(closingStatus).toHaveAccessibleName('Window 1, 2 tabs, closing');
    await waitFor(() => expect(closingStatus).toHaveFocus());
    expect(within(closingCard as HTMLElement).getByText('2 tabs')).toBeInTheDocument();
    const closingList = closingCard?.querySelector('.tab-list');
    expect(closingList).toHaveClass('is-closing-snapshot');
    expect(closingList).not.toHaveAttribute('hidden');
    expect(closingCard).not.toHaveClass('is-collapsed');
    expect(closingList).toHaveAttribute('inert');
    expect(closingCard?.querySelectorAll('.tab-list-item')).toHaveLength(2);
    expect(within(closingCard as HTMLElement).getByText('Quarterly plan')).toBeInTheDocument();
    expect(within(closingCard as HTMLElement).getByText('Issue tracker')).toBeInTheDocument();
    expect(
      within(closingCard as HTMLElement).getByRole('button', { name: 'Focus Quarterly plan' }),
    ).toBeDisabled();
    expect(closingCard?.querySelector('[draggable="true"]')).toBeNull();
    expect(
      within(closingCard as HTMLElement).queryByText('This window has no available tabs.'),
    ).not.toBeInTheDocument();
    expect(
      within(closingCard as HTMLElement).queryByRole('checkbox', {
        name: 'Select all visible tabs in Window 1',
      }),
    ).not.toBeInTheDocument();
    expect(
      within(closingCard as HTMLElement).queryByRole('button', { name: 'Collapse Window 1' }),
    ).not.toBeInTheDocument();
    expect(
      within(closingCard as HTMLElement).queryByRole('button', { name: 'Save Window 1' }),
    ).not.toBeInTheDocument();
    expect(selectClosingWindow).not.toBeInTheDocument();
    expect(screen.getByTitle('Sort all A to Z')).toBeDisabled();
    expect(screen.getByText('2 windows · 3 tabs')).toBeInTheDocument();

    act(() => listeners.forEach((listener) => listener()));
    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(3));
    expect(within(closingCard as HTMLElement).getByText('Closing…')).toBeInTheDocument();

    currentSnapshot = createActiveWindowsSnapshot({
      windows: currentSnapshot.windows.map((activeWindow) =>
        activeWindow.id === 1
          ? {
              ...activeWindow,
              tabs: activeWindow.tabs.filter((tab) => tab.id === 101),
            }
          : activeWindow,
      ),
    });
    act(() => listeners.forEach((listener) => listener()));

    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
    expect(within(closingCard as HTMLElement).getByText('2 tabs')).toBeInTheDocument();
    expect(within(closingCard as HTMLElement).getByText('Closing…')).toBeInTheDocument();
    expect(closingStatus).toHaveFocus();
    expect(closingCard?.querySelector('.tab-list')).toBe(closingList);
    expect(closingCard?.querySelectorAll('.tab-list-item')).toHaveLength(2);
    expect(within(closingCard as HTMLElement).getByText('Issue tracker')).toBeInTheDocument();
    expect(screen.queryByText(/1\/2/)).not.toBeInTheDocument();
    expect(screen.getByText('2 windows · 3 tabs')).toBeInTheDocument();

    currentSnapshot = createActiveWindowsSnapshot({
      windows: currentSnapshot.windows.map((activeWindow) =>
        activeWindow.id === 1 ? { ...activeWindow, tabs: [] } : activeWindow,
      ),
    });
    act(() => listeners.forEach((listener) => listener()));

    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(5));
    expect(within(closingCard as HTMLElement).getByText('Closing…')).toBeInTheDocument();
    expect(closingCard?.querySelectorAll('.tab-list-item')).toHaveLength(2);
    expect(
      within(closingCard as HTMLElement).queryByText('This window has no available tabs.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Saved "Project work" and closed Window 1.')).not.toBeInTheDocument();

    currentSnapshot = createActiveWindowsSnapshot({
      windows: currentSnapshot.windows.filter((activeWindow) => activeWindow.id !== 1),
    });
    act(() => listeners.forEach((listener) => listener()));

    expect(
      await screen.findByText('Saved "Project work" and closed Window 1.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 tabs? remain(?:s)? open/i)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: 'Undo Save & close for Project work from Window 1',
        }),
      ).toHaveFocus(),
    );
    expect(screen.queryByRole('button', { name: 'Focus Quarterly plan' })).not.toBeInTheDocument();
    expect(screen.getByText('1 window · 1 tab')).toBeInTheDocument();
  });

  it('keeps duplicate preview unavailable while a saved window is closing', async () => {
    const user = userEvent.setup();
    const savedWindowsService = createSavedWindowsService();
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(
      createSaveWindowResult('Project work', true),
    );
    render(
      <ActiveWindowsPage
        savedWindowsService={savedWindowsService}
        service={createDuplicateSelectionService()}
      />,
    );

    const previewButton = await screen.findByRole('button', {
      name: 'Show duplicate tabs only',
    });
    await waitFor(() => expect(previewButton).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Project work');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

    expect(previewButton).toBeDisabled();
    expect(screen.getByText('Closing…')).toBeInTheDocument();
  });

  it('undoes a completed Save & close by reopening and consuming the saved window', async () => {
    const savedWindowsService = createSavedWindowsService();
    vi.mocked(savedWindowsService.restoreWindow).mockResolvedValue({
      destinationWindowId: 9,
      failures: [],
      restoredTabCount: 2,
      savedWindowRemoved: true,
      warnings: [],
    });
    const { user } = await renderCompletedSaveAndClose(savedWindowsService);

    await user.click(
      screen.getByRole('button', {
        name: 'Undo Save & close for Project work from Window 1',
      }),
    );

    expect(savedWindowsService.restoreWindow).toHaveBeenCalledTimes(1);
    expect(savedWindowsService.restoreWindow).toHaveBeenCalledWith('saved-1');
    expect(savedWindowsService.deleteWindow).not.toHaveBeenCalled();
    expect(
      await screen.findByText('Reopened "Project work" and removed it from Saved Windows.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Undo Save & close for Project work from Window 1',
      }),
    ).not.toBeInTheDocument();
  });

  it('keeps failed Undo tabs in Saved Windows without offering a duplicate restore', async () => {
    const savedWindowsService = createSavedWindowsService();
    vi.mocked(savedWindowsService.restoreWindow).mockResolvedValue({
      destinationWindowId: 9,
      failures: [
        {
          message: 'This URL is blocked.',
          order: 1,
          title: 'Issue tracker',
          url: 'https://issues.example.net/WEAVER-42',
        },
      ],
      restoredTabCount: 1,
      savedWindowRemoved: false,
      warnings: [],
    });
    const { user } = await renderCompletedSaveAndClose(savedWindowsService);

    await user.click(
      screen.getByRole('button', {
        name: 'Undo Save & close for Project work from Window 1',
      }),
    );

    expect(
      await screen.findByText(
        'Reopened 1 tab from "Project work". 1 tab could not be reopened. A recovery copy remains in Saved Windows. This URL is blocked.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Undo Save & close for Project work from Window 1',
      }),
    ).not.toBeInTheDocument();
    expect(savedWindowsService.deleteWindow).not.toHaveBeenCalled();
  });

  it('keeps Undo retryable when the saved window cannot be reopened', async () => {
    const savedWindowsService = createSavedWindowsService();
    vi.mocked(savedWindowsService.restoreWindow).mockRejectedValue(
      new Error('Restore unavailable.'),
    );
    const { user } = await renderCompletedSaveAndClose(savedWindowsService);

    await user.click(
      screen.getByRole('button', {
        name: 'Undo Save & close for Project work from Window 1',
      }),
    );

    expect(
      await screen.findByText(
        'The browser could not reopen "Project work". Check Saved Windows to see whether the saved copy is still available. Restore unavailable.',
      ),
    ).toBeInTheDocument();
    const retryUndo = screen.getByRole('button', {
      name: 'Undo Save & close for Project work from Window 1',
    });
    expect(retryUndo).toBeEnabled();
    expect(retryUndo).toHaveFocus();
    expect(savedWindowsService.deleteWindow).not.toHaveBeenCalled();
  });

  it('keeps Undo retryable when no saved tabs could be reopened', async () => {
    const savedWindowsService = createSavedWindowsService();
    vi.mocked(savedWindowsService.restoreWindow).mockResolvedValue({
      destinationWindowId: 9,
      failures: [
        {
          message: 'This URL is blocked.',
          order: 0,
          title: 'Quarterly plan',
          url: 'https://docs.example.com/quarterly-plan',
        },
      ],
      restoredTabCount: 0,
      savedWindowRemoved: false,
      warnings: [],
    });
    const { user } = await renderCompletedSaveAndClose(savedWindowsService);

    await user.click(
      screen.getByRole('button', {
        name: 'Undo Save & close for Project work from Window 1',
      }),
    );

    expect(
      await screen.findByText(
        'The browser could not reopen "Project work". Its saved copy remains in Saved Windows. This URL is blocked.',
      ),
    ).toBeInTheDocument();
    const retryUndo = screen.getByRole('button', {
      name: 'Undo Save & close for Project work from Window 1',
    });
    expect(retryUndo).toBeEnabled();
    expect(retryUndo).toHaveFocus();
    expect(savedWindowsService.deleteWindow).not.toHaveBeenCalled();
  });

  it('does not offer Undo twice when reopening succeeds but saved-copy removal fails', async () => {
    const savedWindowsService = createSavedWindowsService();
    vi.mocked(savedWindowsService.restoreWindow).mockResolvedValue({
      destinationWindowId: 9,
      failures: [],
      restoredTabCount: 2,
      savedWindowRemoved: false,
      warnings: ['The restored window opened, but its saved copy could not be removed.'],
    });
    const { user } = await renderCompletedSaveAndClose(savedWindowsService);

    await user.click(
      screen.getByRole('button', {
        name: 'Undo Save & close for Project work from Window 1',
      }),
    );

    expect(
      await screen.findByText(
        'Reopened "Project work", but its saved copy remains in Saved Windows. The restored window opened, but its saved copy could not be removed.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Undo Save & close for Project work from Window 1',
      }),
    ).not.toBeInTheDocument();
    expect(savedWindowsService.deleteWindow).not.toHaveBeenCalled();
  });

  it('keeps the compact closing state visible when the matching filtered tab closes', async () => {
    const user = userEvent.setup();
    const service = createService();
    let currentSnapshot = await service.loadSnapshot();
    const listeners = new Set<() => void>();
    vi.mocked(service.loadSnapshot).mockClear();
    vi.mocked(service.loadSnapshot).mockImplementation(() => Promise.resolve(currentSnapshot));
    service.subscribe = vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    const savedWindowsService = createSavedWindowsService();
    const result = createSaveWindowResult('Project work', true);
    const finish = vi.mocked(requireFastClose(result).finish);
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(result);
    render(<ActiveWindowsPage savedWindowsService={savedWindowsService} service={service} />);

    const filter = await screen.findByRole('searchbox', {
      name: 'Filter tabs by title or URL',
    });
    await user.type(filter, 'Issue tracker');
    await user.click(screen.getByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Project work');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

    currentSnapshot = createActiveWindowsSnapshot({
      windows: currentSnapshot.windows.map((activeWindow) =>
        activeWindow.id === 1
          ? { ...activeWindow, tabs: activeWindow.tabs.filter((tab) => tab.id === 101) }
          : activeWindow,
      ),
    });
    act(() => listeners.forEach((listener) => listener()));

    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
    const closingCard = screen.getByRole('heading', { name: 'Window 1' }).closest('article');
    expect(closingCard).toHaveClass('is-closing');
    expect(within(closingCard as HTMLElement).getByText('2 tabs')).toBeInTheDocument();
    expect(within(closingCard as HTMLElement).getByText('Closing…')).toBeInTheDocument();
    expect(closingCard?.querySelector('.tab-list')).toHaveClass('is-closing-snapshot');
    expect(closingCard?.querySelectorAll('.tab-list-item')).toHaveLength(2);
    expect(within(closingCard as HTMLElement).getByText('Quarterly plan')).toBeInTheDocument();
    expect(within(closingCard as HTMLElement).getByText('Issue tracker')).toBeInTheDocument();
    expect(screen.queryByText('No matching tabs')).not.toBeInTheDocument();
  });

  it('keeps the closing state until deferred final verification accepts completion', async () => {
    const user = userEvent.setup();
    const service = createService();
    let currentSnapshot = await service.loadSnapshot();
    const listeners = new Set<() => void>();
    vi.mocked(service.loadSnapshot).mockClear();
    vi.mocked(service.loadSnapshot).mockImplementation(() => Promise.resolve(currentSnapshot));
    service.subscribe = vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    const savedWindowsService = createSavedWindowsService();
    const result = createSaveWindowResult('Project work', true);
    const sourceWindowClose = requireFastClose(result);
    let resolveFinish:
      | ((value: { completion: null; errorMessage: null; status: 'targets-closed' }) => void)
      | undefined;
    const finish = vi.fn(
      () =>
        new Promise<{
          completion: null;
          errorMessage: null;
          status: 'targets-closed';
        }>((resolve) => {
          resolveFinish = resolve;
        }),
    );
    result.sourceWindowClose = { ...sourceWindowClose, finish };
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(result);
    render(<ActiveWindowsPage savedWindowsService={savedWindowsService} service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Project work');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

    currentSnapshot = createActiveWindowsSnapshot({
      windows: currentSnapshot.windows.filter((activeWindow) => activeWindow.id !== 1),
    });
    act(() => listeners.forEach((listener) => listener()));

    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Saved "Project work" and closed Window 1.')).not.toBeInTheDocument();
    const closingCard = screen.getByRole('heading', { name: 'Window 1' }).closest('article');
    expect(closingCard).toHaveClass('is-closing');
    expect(within(closingCard as HTMLElement).getByText('Closing…')).toBeInTheDocument();
    expect(screen.queryByText('No browser windows available')).not.toBeInTheDocument();

    await act(async () => {
      resolveFinish?.({ completion: null, errorMessage: null, status: 'targets-closed' });
      await Promise.resolve();
    });

    expect(
      await screen.findByText('Saved "Project work" and closed Window 1.'),
    ).toBeInTheDocument();
  });

  it('restores a changed source window after its compact closing state fails', async () => {
    const user = userEvent.setup();
    const service = createService();
    let currentSnapshot = await service.loadSnapshot();
    const listeners = new Set<() => void>();
    vi.mocked(service.loadSnapshot).mockClear();
    vi.mocked(service.loadSnapshot).mockImplementation(() => Promise.resolve(currentSnapshot));
    service.subscribe = vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    const savedWindowsService = createSavedWindowsService();
    const result = createSaveWindowResult('Project work', true);
    const sourceWindowClose = requireFastClose(result);
    const finish = vi.fn(() =>
      Promise.resolve({
        completion: null,
        errorMessage:
          'The source window gained or replaced a tab while it was closing, so Weaver left the remaining tabs open.',
        status: 'partial' as const,
      }),
    );
    result.sourceWindowClose = { ...sourceWindowClose, finish };
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(result);
    render(<ActiveWindowsPage savedWindowsService={savedWindowsService} service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Project work');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

    const closingCard = screen.getByRole('heading', { name: 'Window 1' }).closest('article');
    expect(closingCard).toHaveClass('is-closing');
    expect(closingCard?.querySelector('.tab-list')).toHaveClass('is-closing-snapshot');
    expect(closingCard?.querySelectorAll('.tab-list-item')).toHaveLength(2);
    expect(within(closingCard as HTMLElement).getByText('Quarterly plan')).toBeInTheDocument();
    expect(within(closingCard as HTMLElement).getByText('Issue tracker')).toBeInTheDocument();
    expect(within(closingCard as HTMLElement).getByText('2 tabs')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(closingCard as HTMLElement)
          .getByText('Closing…')
          .closest('.window-card-closing-status'),
      ).toHaveFocus(),
    );

    const sourceWindow = currentSnapshot.windows.find((activeWindow) => activeWindow.id === 1);
    if (!sourceWindow) {
      throw new Error('Missing source window fixture');
    }
    currentSnapshot = createActiveWindowsSnapshot({
      windows: currentSnapshot.windows.map((activeWindow) =>
        activeWindow.id === 1
          ? {
              ...activeWindow,
              tabs: [
                sourceWindow.tabs[0] as (typeof sourceWindow.tabs)[number],
                createManagedTab({
                  id: 103,
                  index: 1,
                  title: 'New work',
                  url: 'https://new.example.com/',
                  windowId: 1,
                }),
                createManagedTab({
                  id: 104,
                  index: 2,
                  title: 'More new work',
                  url: 'https://more.example.com/',
                  windowId: 1,
                }),
              ],
            }
          : activeWindow,
      ),
    });
    act(() => listeners.forEach((listener) => listener()));

    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(
        'Saved "Project work", but Window 1 did not finish closing. The source window gained or replaced a tab while it was closing, so Weaver left the remaining tabs open.',
      ),
    ).toBeInTheDocument();
    const restoredCard = screen.getByRole('heading', { name: 'Window 1' }).closest('article');
    expect(restoredCard).not.toHaveClass('is-closing');
    expect(restoredCard).not.toHaveAttribute('aria-busy');
    expect(restoredCard?.querySelector('.tab-list')).not.toBeNull();
    expect(within(restoredCard as HTMLElement).getByText('3 tabs')).toBeInTheDocument();
    expect(within(restoredCard as HTMLElement).queryByText('Closing…')).not.toBeInTheDocument();
    expect(
      within(restoredCard as HTMLElement).getByRole('button', { name: 'Save Window 1' }),
    ).toBeEnabled();
    expect(
      within(restoredCard as HTMLElement).getByRole('button', { name: 'Focus New work' }),
    ).toBeEnabled();
    expect(
      within(restoredCard as HTMLElement).getByRole('button', { name: 'Focus More new work' }),
    ).toBeEnabled();
    expect(screen.getByText('2 windows · 4 tabs')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTitle('Dismiss error')).toHaveFocus());
  });

  it('reconciles a rejected fast-close batch and unlocks the source card', async () => {
    const user = userEvent.setup();
    const savedWindowsService = createSavedWindowsService();
    const result = createSaveWindowResult('Project work', true);
    const sourceWindowClose = requireFastClose(result);
    const finish = vi.mocked(sourceWindowClose.finish);
    result.sourceWindowClose = {
      ...sourceWindowClose,
      batchCompletion: Promise.resolve({ errorMessage: 'Tab is being dragged' }),
    };
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(result);
    render(
      <ActiveWindowsPage savedWindowsService={savedWindowsService} service={createService()} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Project work');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

    expect(
      await screen.findByText(
        'Saved "Project work", but Window 1 did not finish closing. Tab is being dragged',
      ),
    ).toBeInTheDocument();
    expect(finish).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save Window 1' })).toBeEnabled();
  });

  it('does not count a target tab moved to another window as closed', async () => {
    const user = userEvent.setup();
    const service = createService();
    let currentSnapshot = await service.loadSnapshot();
    const listeners = new Set<() => void>();
    vi.mocked(service.loadSnapshot).mockClear();
    vi.mocked(service.loadSnapshot).mockImplementation(() => Promise.resolve(currentSnapshot));
    service.subscribe = vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    const savedWindowsService = createSavedWindowsService();
    const result = createSaveWindowResult('Project work', true);
    const finish = vi.mocked(requireFastClose(result).finish);
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(result);
    render(<ActiveWindowsPage savedWindowsService={savedWindowsService} service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Project work');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

    const movedTab = currentSnapshot.windows
      .find((activeWindow) => activeWindow.id === 1)
      ?.tabs.find((tab) => tab.id === 102);
    if (!movedTab) {
      throw new Error('Missing moved tab fixture');
    }
    currentSnapshot = createActiveWindowsSnapshot({
      windows: currentSnapshot.windows.map((activeWindow) =>
        activeWindow.id === 1
          ? { ...activeWindow, tabs: activeWindow.tabs.filter((tab) => tab.id !== 102) }
          : activeWindow.id === 2
            ? {
                ...activeWindow,
                tabs: [
                  ...activeWindow.tabs,
                  { ...movedTab, index: activeWindow.tabs.length, windowId: 2 },
                ],
              }
            : activeWindow,
      ),
    });
    act(() => listeners.forEach((listener) => listener()));

    await waitFor(() => expect(service.loadSnapshot).toHaveBeenCalledTimes(3));
    const closingCard = screen.getByRole('heading', { name: 'Window 1' }).closest('article');
    expect(within(closingCard as HTMLElement).getByText('2 tabs')).toBeInTheDocument();
    expect(within(closingCard as HTMLElement).getByText('Closing…')).toBeInTheDocument();
    expect(closingCard?.querySelector('.tab-list')).toHaveClass('is-closing-snapshot');
    expect(closingCard?.querySelectorAll('.tab-list-item')).toHaveLength(2);
    expect(within(closingCard as HTMLElement).getByText('Issue tracker')).toBeInTheDocument();
    expect(finish).not.toHaveBeenCalled();
  });

  it('verifies a target that disappears from normal-window snapshots before reporting success', async () => {
    const user = userEvent.setup();
    const service = createService();
    let currentSnapshot = await service.loadSnapshot();
    const listeners = new Set<() => void>();
    vi.mocked(service.loadSnapshot).mockClear();
    vi.mocked(service.loadSnapshot).mockImplementation(() => Promise.resolve(currentSnapshot));
    service.subscribe = vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    const savedWindowsService = createSavedWindowsService();
    const result = createSaveWindowResult('Project work', true);
    const sourceWindowClose = requireFastClose(result);
    const finish = vi.fn(() =>
      Promise.resolve({
        completion: null,
        errorMessage: 'A saved tab moved to another browser window, so Weaver left it open.',
        status: 'partial' as const,
      }),
    );
    result.sourceWindowClose = { ...sourceWindowClose, finish };
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(result);
    render(<ActiveWindowsPage savedWindowsService={savedWindowsService} service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Project work');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

    currentSnapshot = createActiveWindowsSnapshot({
      windows: currentSnapshot.windows.map((activeWindow) =>
        activeWindow.id === 1
          ? { ...activeWindow, tabs: activeWindow.tabs.filter((tab) => tab.id !== 102) }
          : activeWindow,
      ),
    });
    act(() => listeners.forEach((listener) => listener()));

    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(
        'Saved "Project work", but Window 1 did not finish closing. A saved tab moved to another browser window, so Weaver left it open.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Saved "Project work" and closed Window 1.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Window 1' })).toBeEnabled();
  });

  it('reports every source window when multiple saved windows finish closing together', async () => {
    const user = userEvent.setup();
    const service = createService();
    let currentSnapshot = await service.loadSnapshot();
    const listeners = new Set<() => void>();
    vi.mocked(service.loadSnapshot).mockClear();
    vi.mocked(service.loadSnapshot).mockImplementation(() => Promise.resolve(currentSnapshot));
    service.subscribe = vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    });
    const savedWindowsService = createSavedWindowsService();
    vi.mocked(savedWindowsService.saveWindow).mockImplementation(
      (sourceWindowId, name, closeSource) => {
        const result = createSaveWindowResult(name, closeSource, [], sourceWindowId);
        return Promise.resolve({
          ...result,
          savedWindow: { ...result.savedWindow, id: `saved-${sourceWindowId}` },
        });
      },
    );
    render(<ActiveWindowsPage savedWindowsService={savedWindowsService} service={service} />);

    const saveAndClose = async (windowLabel: string, name: string) => {
      await user.click(screen.getByRole('button', { name: `Save ${windowLabel}` }));
      const dialog = screen.getByRole('dialog', { name: 'Save window' });
      await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), name);
      await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));
    };

    await screen.findByRole('button', { name: 'Save Window 1' });
    await saveAndClose('Window 1', 'First project');
    await saveAndClose('Window 2', 'Second project');
    const firstClosingCard = screen.getByRole('heading', { name: 'Window 1' }).closest('article');
    const secondClosingCard = screen.getByRole('heading', { name: 'Window 2' }).closest('article');
    expect(within(firstClosingCard as HTMLElement).getByText('2 tabs')).toBeInTheDocument();
    expect(within(firstClosingCard as HTMLElement).getByText('Closing…')).toBeInTheDocument();
    expect(firstClosingCard?.querySelectorAll('.tab-list-item')).toHaveLength(2);
    expect(within(secondClosingCard as HTMLElement).getByText('1 tab')).toBeInTheDocument();
    expect(within(secondClosingCard as HTMLElement).getByText('Closing…')).toBeInTheDocument();
    expect(secondClosingCard?.querySelectorAll('.tab-list-item')).toHaveLength(1);

    const remainingWindow = currentSnapshot.windows.find((activeWindow) => activeWindow.id === 2);
    if (!remainingWindow) {
      throw new Error('Missing second window fixture');
    }
    currentSnapshot = createActiveWindowsSnapshot({
      windows: [{ ...remainingWindow, label: 'Window 1' }],
    });
    act(() => listeners.forEach((listener) => listener()));

    expect(
      await screen.findByText('Saved "First project" and closed Window 1.'),
    ).toBeInTheDocument();
    const remainingClosingCard = screen
      .getByRole('heading', { name: 'Window 2' })
      .closest('article');
    expect(remainingClosingCard).toHaveClass('is-closing');
    expect(remainingClosingCard).toHaveAttribute('aria-busy', 'true');
    expect(within(remainingClosingCard as HTMLElement).getByText('1 tab')).toBeInTheDocument();
    expect(within(remainingClosingCard as HTMLElement).getByText('Closing…')).toBeInTheDocument();
    expect(remainingClosingCard?.querySelectorAll('.tab-list-item')).toHaveLength(1);
    expect(screen.getByText('2 windows · 3 tabs')).toBeInTheDocument();

    currentSnapshot = createActiveWindowsSnapshot({ windows: [] });
    act(() => listeners.forEach((listener) => listener()));

    expect(
      await screen.findByText('Saved "Second project" and closed Window 2.'),
    ).toBeInTheDocument();
    const firstCompletion = screen
      .getByText('Saved "First project" and closed Window 1.')
      .closest<HTMLElement>('.window-close-completion-notice');
    expect(firstCompletion).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Undo Save & close for/ })).toHaveLength(2);
    expect(
      screen.getByRole('button', {
        name: 'Undo Save & close for First project from Window 1',
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', {
        name: 'Dismiss Save & close result for Second project from Window 2',
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', {
        name: 'Undo Save & close for Second project from Window 2',
      }),
    ).toHaveFocus();

    await user.click(
      within(firstCompletion as HTMLElement).getByRole('button', {
        name: 'Dismiss Save & close result for First project from Window 1',
      }),
    );

    expect(
      screen.queryByText('Saved "First project" and closed Window 1.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Saved "Second project" and closed Window 2.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Undo Save & close for Second project from Window 2',
      }),
    ).toBeEnabled();
  });

  it('explains a slow browser close and offers to focus the source window', async () => {
    const service = createService();
    let currentSnapshot = await service.loadSnapshot();
    const listeners = new Set<() => void>();
    vi.mocked(service.loadSnapshot).mockClear();
    vi.mocked(service.loadSnapshot).mockImplementation(() => Promise.resolve(currentSnapshot));
    service.subscribe = vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    const savedWindowsService = createSavedWindowsService();
    render(<ActiveWindowsPage savedWindowsService={savedWindowsService} service={service} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Project work' },
    });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save & close' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.queryByText(/Saved "Project work"\. .*closing Window 1/i),
    ).not.toBeInTheDocument();
    const closingCard = screen.getByRole('heading', { name: 'Window 1' }).closest('article');
    expect(within(closingCard as HTMLElement).getByText('Closing…')).toBeInTheDocument();
    expect(closingCard?.querySelector('.tab-list')).toHaveClass('is-closing-snapshot');
    expect(closingCard?.querySelectorAll('.tab-list-item')).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(2_999);
    });
    expect(screen.queryByRole('button', { name: 'Focus window' })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const delayedNotice = screen.getByText(
      'Saved "Project work". Still closing Window 1. A page may need extra time or confirmation.',
    );
    expect(delayedNotice).toBeInTheDocument();
    const closingStatus = within(closingCard as HTMLElement)
      .getByText('Closing…')
      .closest<HTMLElement>('.window-card-closing-status');

    currentSnapshot = createActiveWindowsSnapshot({
      windows: currentSnapshot.windows.map((activeWindow) =>
        activeWindow.id === 1
          ? { ...activeWindow, tabs: activeWindow.tabs.filter((tab) => tab.id === 101) }
          : activeWindow,
      ),
    });
    act(() => listeners.forEach((listener) => listener()));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(delayedNotice).toBeInTheDocument();
    expect(screen.queryByText(/1\/2|1 of 2/)).not.toBeInTheDocument();
    expect(within(closingCard as HTMLElement).getByText('2 tabs')).toBeInTheDocument();
    expect(closingStatus).toHaveFocus();
    const focusWindowButton = screen.getByRole('button', { name: 'Focus window' });
    expect(focusWindowButton).toHaveAttribute('title', 'Focus Window 1');
    await act(async () => {
      fireEvent.click(focusWindowButton);
      await Promise.resolve();
    });
    expect(service.focusWindow).toHaveBeenCalledWith(1);

    const dismissButton = screen.getByRole('button', { name: 'Dismiss' });
    dismissButton.focus();
    fireEvent.click(dismissButton);
    await act(async () => Promise.resolve());
    expect(dismissButton).not.toBeInTheDocument();
    expect(closingStatus).toHaveFocus();

    currentSnapshot = createActiveWindowsSnapshot({
      windows: currentSnapshot.windows.filter((activeWindow) => activeWindow.id !== 1),
    });
    act(() => listeners.forEach((listener) => listener()));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    expect(screen.getByText('Saved "Project work" and closed Window 1.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Undo Save & close for Project work from Window 1',
      }),
    ).toHaveFocus();
  });

  it('finishes a fast close after navigating away from Active Windows', async () => {
    const user = userEvent.setup();
    const savedWindowsService = createSavedWindowsService();
    const result = createSaveWindowResult('Project work', true);
    const sourceWindowClose = requireFastClose(result);
    let resolveBatch: ((value: { errorMessage: string | null }) => void) | undefined;
    const batchCompletion = new Promise<{ errorMessage: string | null }>((resolve) => {
      resolveBatch = resolve;
    });
    const finish = vi.fn(() =>
      Promise.resolve({
        completion: Promise.resolve({ errorMessage: null }),
        errorMessage: null,
        status: 'close-requested' as const,
      }),
    );
    result.sourceWindowClose = { ...sourceWindowClose, batchCompletion, finish };
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(result);
    const { unmount } = render(
      <ActiveWindowsPage savedWindowsService={savedWindowsService} service={createService()} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Project work');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

    expect(finish).not.toHaveBeenCalled();
    unmount();
    await act(async () => {
      resolveBatch?.({ errorMessage: null });
      await batchCompletion;
      await Promise.resolve();
    });

    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('finishes a fast close when saving resolves after Active Windows unmounts', async () => {
    const user = userEvent.setup();
    const savedWindowsService = createSavedWindowsService();
    const result = createSaveWindowResult('Project work', true);
    const finish = vi.mocked(requireFastClose(result).finish);
    let resolveSave: ((value: SaveWindowResult) => void) | undefined;
    const savePromise = new Promise<SaveWindowResult>((resolve) => {
      resolveSave = resolve;
    });
    vi.mocked(savedWindowsService.saveWindow).mockReturnValue(savePromise);
    const { unmount } = render(
      <ActiveWindowsPage savedWindowsService={savedWindowsService} service={createService()} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Project work');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

    expect(savedWindowsService.saveWindow).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
    unmount();
    await act(async () => {
      resolveSave?.(result);
      await savePromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('uses browser-neutral recovery copy when saved tabs remain at the timeout', async () => {
    const service = createService();
    const savedWindowsService = createSavedWindowsService();
    const result = createSaveWindowResult('Project work', true);
    const sourceWindowClose = requireFastClose(result);
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(result);
    render(<ActiveWindowsPage savedWindowsService={savedWindowsService} service={service} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Project work' },
    });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save & close' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sourceWindowClose.finish).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(sourceWindowClose.cancelFinalization).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        'Saved "Project work", but your browser did not finish closing all saved tabs from Window 1. Weaver stopped before closing the final tab. Focus the window to check for a confirmation.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Closing…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Window 1' })).toBeEnabled();
  });

  it('unlocks the card when the accepted final-tab close is still pending at the timeout', async () => {
    const service = createService();
    const savedWindowsService = createSavedWindowsService();
    const result = createSaveWindowResult('Solo work', true, [], 2);
    const sourceWindowClose = requireFastClose(result);
    const neverSettles = new Promise<{ errorMessage: string | null }>(() => undefined);
    const finish = vi.fn(() =>
      Promise.resolve({
        completion: neverSettles,
        errorMessage: null,
        status: 'close-requested' as const,
      }),
    );
    const cancelFinalization = vi.fn();
    result.sourceWindowClose = {
      ...sourceWindowClose,
      cancelFinalization,
      finish,
    };
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(result);
    render(<ActiveWindowsPage savedWindowsService={savedWindowsService} service={service} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Save Window 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Solo work' },
    });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save & close' }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(finish).toHaveBeenCalledTimes(1);
    const closingCard = screen.getByRole('heading', { name: 'Window 2' }).closest('article');
    expect(within(closingCard as HTMLElement).getByText('Closing…')).toBeInTheDocument();
    expect(within(closingCard as HTMLElement).getByText('1 tab')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(cancelFinalization).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        'Saved "Solo work", but your browser is still waiting to close the final tab in Window 2. Weaver unlocked the window; closing may still finish after you respond to a page confirmation.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Closing…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Window 2' })).toBeEnabled();
  });

  it('stops an in-flight final verification without claiming the browser may still close the tab', async () => {
    const service = createService();
    const savedWindowsService = createSavedWindowsService();
    const result = createSaveWindowResult('Solo work', true, [], 2);
    const sourceWindowClose = requireFastClose(result);
    let resolveFinish:
      | ((value: { completion: null; errorMessage: string; status: 'partial' }) => void)
      | undefined;
    const finishPending = new Promise<{
      completion: null;
      errorMessage: string;
      status: 'partial';
    }>((resolve) => {
      resolveFinish = resolve;
    });
    const finish = vi.fn(() => finishPending);
    const cancelFinalization = vi.fn();
    result.sourceWindowClose = {
      ...sourceWindowClose,
      cancelFinalization,
      finish,
    };
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(result);
    render(<ActiveWindowsPage savedWindowsService={savedWindowsService} service={service} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Save Window 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Solo work' },
    });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save & close' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(finish).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(cancelFinalization).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        'Saved "Solo work", but Weaver could not finish verifying the final tab in Window 2. Weaver stopped automatic closing and unlocked the window.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/closing may still finish after you respond/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Window 2' })).toBeEnabled();

    await act(async () => {
      resolveFinish?.({
        completion: null,
        errorMessage: 'Automatic final-tab closing stopped after the operation timed out.',
        status: 'partial',
      });
      await Promise.resolve();
    });
  });

  it('reports a rejected final-tab close request instead of leaving the card busy', async () => {
    const user = userEvent.setup();
    const savedWindowsService = createSavedWindowsService();
    const result = createSaveWindowResult('Solo work', true, [], 2);
    const sourceWindowClose = requireFastClose(result);
    result.sourceWindowClose = {
      ...sourceWindowClose,
      finish: vi.fn(() =>
        Promise.resolve({
          completion: Promise.resolve({ errorMessage: 'The page canceled closing' }),
          errorMessage: null,
          status: 'close-requested' as const,
        }),
      ),
    };
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(result);
    render(
      <ActiveWindowsPage savedWindowsService={savedWindowsService} service={createService()} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Save Window 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Solo work');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

    expect(
      await screen.findByText(
        'Saved "Solo work", but Window 2 did not finish closing. The final saved tab could not be closed: The page canceled closing',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Closing…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Window 2' })).toBeEnabled();
  });

  it('keeps the whole source card usable when fast-close preflight cannot verify every tab', async () => {
    const user = userEvent.setup();
    const savedWindowsService = createSavedWindowsService();
    vi.mocked(savedWindowsService.saveWindow).mockResolvedValue(
      createSaveWindowResult('Project work', false, [
        'The window was saved, but not every source tab could be safely verified, so Weaver did not close any source tabs.',
      ]),
    );
    render(
      <ActiveWindowsPage savedWindowsService={savedWindowsService} service={createService()} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Save Window 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Save window' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Project work');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));

    expect(
      screen.getByText(
        'Saved "Project work". The window was saved, but not every source tab could be safely verified, so Weaver did not close any source tabs.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Closing…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Window 1' })).toBeEnabled();
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
