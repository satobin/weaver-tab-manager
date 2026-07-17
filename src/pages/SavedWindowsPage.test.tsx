import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { type SavedWindow } from '../features/saved-windows/savedWindowModel';
import { type SavedWindowsService } from '../features/saved-windows/savedWindowsService';
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
    openTab: vi.fn(() => Promise.resolve(42)),
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
    subscribe: vi.fn(() => () => undefined),
  };
  return service;
}

describe('SavedWindowsPage', () => {
  it('renders an empty state when there are no saved windows', async () => {
    const { container } = render(<SavedWindowsPage service={createService([])} />);

    expect(await screen.findByRole('heading', { name: 'No saved windows' })).toBeInTheDocument();
    expect(screen.getByText('0 saved windows · 0 tabs')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh saved windows' })).not.toBeInTheDocument();
    expect(container.querySelector('.saved-windows-toolbar')).not.toBeInTheDocument();
  });

  it('renders saved-window totals in the shared header target', async () => {
    const headerTarget = document.createElement('div');
    const { container } = render(
      <SavedWindowsPage headerPortalTarget={headerTarget} service={createService()} />,
    );

    await waitFor(() => expect(headerTarget).toHaveTextContent('1 saved window · 2 tabs'));
    expect(container.querySelector('.saved-window-header-status')).not.toBeInTheDocument();
    expect(container.querySelector('.saved-windows-toolbar')).not.toBeInTheDocument();
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

    const expand = await screen.findByRole('button', { name: 'Show preview for Research' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    await user.click(expand);

    expect(expand).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByText('Collapsed')).toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByLabelText('Pinned')).toBeInTheDocument();
    expect(screen.queryByText('Focused after restore')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Focused after restore')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore' }));
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
    const service = createService();
    render(<SavedWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Show preview for Research' }));
    await user.click(screen.getByRole('button', { name: 'Open Inbox in a new tab' }));

    expect(service.openTab).toHaveBeenCalledWith('https://mail.example.com/');
    expect(service.restoreWindow).not.toHaveBeenCalled();
    expect(service.renameWindow).not.toHaveBeenCalled();
    expect(service.deleteWindow).not.toHaveBeenCalled();
    expect(screen.getByText('Research')).toBeInTheDocument();
  });

  it('copies a local-file URL without adding copy actions to web tabs', async () => {
    const user = userEvent.setup();
    const fileUrl = 'file:///Users/simont/Downloads/reference.svg';
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

    await user.click(await screen.findByRole('button', { name: 'Show preview for Research' }));
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
            url: 'file:///Users/simont/Downloads/reference.svg',
          },
        ],
      }),
    ]);
    render(<SavedWindowsPage service={service} />);

    await user.click(await screen.findByRole('button', { name: 'Show preview for Research' }));
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

    await user.click(await screen.findByRole('button', { name: 'Show preview for Research' }));
    await user.click(screen.getByRole('button', { name: 'Open Plan in a new tab' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('URL blocked');
    expect(screen.getByRole('button', { name: 'Open Inbox in a new tab' })).toBeInTheDocument();
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

    await user.click(await screen.findByRole('button', { name: 'Restore' }));

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

    await user.click(await screen.findByRole('button', { name: 'Restore' }));

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
