import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  createActiveWindowsSnapshot,
  createManagedTab,
  createManagedWindow,
} from '../../test/activeWindowsFixtures';
import { type SavedWindow } from '../saved-windows/savedWindowModel';
import { CommandPalette } from './CommandPalette';

function createActiveService() {
  const snapshot = createActiveWindowsSnapshot({
    windows: [
      createManagedWindow({
        groups: [
          {
            collapsed: false,
            color: 'blue',
            id: 10,
            title: 'Planning',
            windowId: 1,
          },
        ],
        tabs: [
          createManagedTab({
            active: true,
            agentAssociated: true,
            agentDedupeProtected: true,
            groupId: 10,
            id: 101,
            pinned: true,
            title: 'Fleet capacity plan — Notion',
            url: 'https://www.notion.so/fleet-capacity',
          }),
          createManagedTab({
            discarded: true,
            id: 102,
            index: 1,
            title: 'Notion roadmap',
            url: 'https://www.notion.so/roadmap',
          }),
        ],
      }),
    ],
  });
  return {
    focusTab: vi.fn(() => Promise.resolve()),
    loadSnapshot: vi.fn(() => Promise.resolve(snapshot)),
    subscribe: vi.fn(() => () => undefined),
  };
}

function createSavedWindow(): SavedWindow {
  return {
    createdAt: '2026-08-16T12:00:00.000Z',
    groups: [
      {
        collapsed: false,
        color: 'purple',
        key: 'research',
        title: 'Research',
      },
    ],
    id: 'saved-1',
    name: 'Research planning',
    tabs: [
      {
        active: true,
        groupKey: 'research',
        order: 0,
        pinned: true,
        title: 'Weaver ideas — Notion',
        url: 'https://www.notion.so/weaver-ideas',
      },
    ],
    updatedAt: '2026-08-16T12:00:00.000Z',
  };
}

function createSavedService() {
  return {
    load: vi.fn(() => Promise.resolve([createSavedWindow()])),
    openTab: vi.fn(() => Promise.resolve(42)),
    restoreWindow: vi.fn(() => Promise.reject(new Error('Must not restore from the palette'))),
    subscribe: vi.fn(() => () => undefined),
  };
}

describe('CommandPalette', () => {
  it('exposes the dialog combobox contract', async () => {
    const user = userEvent.setup();
    const activeService = createActiveService();
    const savedService = createSavedService();
    render(
      <div className="app-shell">
        <CommandPalette activeWindowsService={activeService} savedWindowsService={savedService} />
      </div>,
    );

    const trigger = screen.getByRole('button', { name: 'Search Weaver' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K');
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Search Weaver' });
    const combobox = within(dialog).getByRole('combobox', { name: 'Search Weaver' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(combobox).toHaveFocus();
    expect(combobox).toHaveAttribute('aria-controls', 'command-palette-results');
    expect(
      await within(dialog).findByRole('listbox', { name: 'Weaver search results' }),
    ).toBeVisible();
  });

  it('shows sectioned results, accessible tab states, and compact result shortcuts', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const user = userEvent.setup();
    render(
      <div className="app-shell">
        <CommandPalette
          activeWindowsService={createActiveService()}
          savedWindowsService={createSavedService()}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Search Weaver' }));
    const input = screen.getByRole('combobox', { name: 'Search Weaver' });
    await user.type(input, 'notion');

    const listbox = screen.getByRole('listbox', { name: 'Weaver search results' });
    expect(within(listbox).getByRole('group', { name: /Open tabs 2/u })).toBeVisible();
    expect(within(listbox).getByRole('group', { name: /Tab groups 2/u })).toBeVisible();
    expect(within(listbox).getByRole('group', { name: /Saved Window\/Tabs 2/u })).toBeVisible();
    expect(within(listbox).getByRole('group', { name: /Settings 2/u })).toBeVisible();
    const fleetOption = within(listbox).getByRole('option', { name: /Fleet capacity plan/u });
    expect(fleetOption).toHaveAccessibleName('Fleet capacity plan — Notion. Planning · notion.so');
    expect(fleetOption).toHaveAccessibleDescription(
      /blue tab group.*Active tab.*Agent-associated.*Pinned tab/u,
    );
    const fleetStates = fleetOption.querySelector('.command-palette-result-states');
    expect(fleetStates).toBeInTheDocument();
    expect(fleetStates).toHaveAttribute('aria-hidden', 'true');
    expect(fleetStates?.querySelector('.is-group.group-color-blue')).toBeInTheDocument();
    expect(fleetStates?.querySelector('.is-active')).toBeInTheDocument();
    expect(fleetStates?.querySelector('.is-agent')).toBeInTheDocument();
    expect(fleetStates?.querySelector('.is-pinned')).toBeInTheDocument();
    expect(fleetOption.querySelector('.command-palette-result-shortcut')).toBeInTheDocument();
    expect(fleetOption).toHaveTextContent(/⌘[1-9]/u);
    expect(fleetOption).not.toHaveTextContent(/Focus|Open|Go/u);
    const roadmapOption = within(listbox).getByRole('option', { name: /Notion roadmap/u });
    expect(roadmapOption).toHaveAccessibleDescription(/Suspended tab/u);
    expect(
      roadmapOption.querySelector('.command-palette-result-states .is-suspended'),
    ).toBeInTheDocument();
    expect(roadmapOption.querySelector('.command-palette-result-shortcut')).toBeInTheDocument();
    expect(within(listbox).queryByText(/Window \d+/u)).not.toBeInTheDocument();
  });

  it('keeps empty state and shortcut rails present for Action results', async () => {
    const user = userEvent.setup();
    render(
      <div className="app-shell">
        <CommandPalette
          activeWindowsService={createActiveService()}
          savedWindowsService={createSavedService()}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Search Weaver' }));

    const previewOption = await screen.findByRole('option', {
      name: /^Preview duplicate tabs\./u,
    });
    expect(previewOption.querySelector('.command-palette-result-states')).toBeEmptyDOMElement();
    expect(previewOption.querySelector('.command-palette-result-shortcut')).toBeInTheDocument();

    const mergeOption = screen.getByRole('option', { name: /^Merge windows\./u });
    expect(mergeOption.querySelector('.command-palette-result-states')).toBeEmptyDOMElement();
    expect(mergeOption.querySelector('.command-palette-result-shortcut')).toBeInTheDocument();
  });

  it('updates live result states and keeps one valid selection after source changes', async () => {
    const snapshots = [
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({
                id: 101,
                title: 'Notion live tab',
                url: 'https://www.notion.so/live',
              }),
            ],
          }),
        ],
      }),
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({
            tabs: [
              createManagedTab({
                active: true,
                agentAssociated: true,
                agentDedupeProtected: true,
                discarded: true,
                id: 101,
                pinned: true,
                title: 'Notion live tab',
                url: 'https://www.notion.so/live',
              }),
            ],
          }),
        ],
      }),
      createActiveWindowsSnapshot({ windows: [] }),
    ];
    let snapshotIndex = 0;
    let notifySourceChange: (() => void) | undefined;
    const activeService = {
      focusTab: vi.fn(() => Promise.resolve()),
      loadSnapshot: vi.fn(() => Promise.resolve(snapshots[snapshotIndex]!)),
      subscribe: vi.fn((listener: () => void) => {
        notifySourceChange = listener;
        return () => {
          notifySourceChange = undefined;
        };
      }),
    };
    const user = userEvent.setup();
    render(
      <div className="app-shell">
        <CommandPalette
          activeWindowsService={activeService}
          savedWindowsService={createSavedService()}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Search Weaver' }));
    await user.type(screen.getByRole('combobox', { name: 'Search Weaver' }), 'notion');
    expect(await screen.findByRole('option', { name: /Notion live tab/u })).not.toHaveAttribute(
      'aria-describedby',
    );

    snapshotIndex = 1;
    act(() => notifySourceChange?.());
    await waitFor(() => expect(activeService.loadSnapshot).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('option', { name: /Notion live tab/u })).toHaveAccessibleDescription(
      /Active tab.*Agent-associated.*Pinned tab.*Suspended tab/u,
    );

    snapshotIndex = 2;
    act(() => notifySourceChange?.());
    await waitFor(() => expect(activeService.loadSnapshot).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('option', { name: /Notion live tab/u })).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole('option')
        .filter((option) => option.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);
  });

  it('keeps input focus while navigating and activates the selected live tab', async () => {
    const user = userEvent.setup();
    const activeService = createActiveService();
    render(
      <div className="app-shell">
        <CommandPalette
          activeWindowsService={activeService}
          savedWindowsService={createSavedService()}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Search Weaver' }));
    const input = screen.getByRole('combobox', { name: 'Search Weaver' });
    await user.type(input, 'notion');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { isComposing: true, key: 'Enter' });
    expect(activeService.focusTab).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Search Weaver' })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveFocus();
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(activeService.focusTab).toHaveBeenCalledWith(1, 101));
    expect(screen.queryByRole('dialog', { name: 'Search Weaver' })).not.toBeInTheDocument();
  });

  it('supports numbered result activation when the browser delivers the chord', async () => {
    const user = userEvent.setup();
    const activeService = createActiveService();
    render(
      <div className="app-shell">
        <CommandPalette
          activeWindowsService={activeService}
          savedWindowsService={createSavedService()}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Search Weaver' }));
    const input = screen.getByRole('combobox', { name: 'Search Weaver' });
    await user.type(input, 'notion');

    fireEvent.keyDown(input, { key: '1', metaKey: true });

    await waitFor(() => expect(activeService.focusTab).toHaveBeenCalledWith(1, 102));
  });

  it('handles numbered chords dialog-wide and consumes repeated chords without activating', async () => {
    const user = userEvent.setup();
    const activeService = createActiveService();
    render(
      <div className="app-shell">
        <CommandPalette
          activeWindowsService={activeService}
          savedWindowsService={createSavedService()}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Search Weaver' }));
    const input = screen.getByRole('combobox', { name: 'Search Weaver' });
    await user.type(input, 'notion');
    await user.tab();
    const clear = screen.getByRole('button', { name: 'Clear search' });
    expect(clear).toHaveFocus();

    expect(fireEvent.keyDown(clear, { key: '1', metaKey: true, repeat: true })).toBe(false);
    expect(activeService.focusTab).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Search Weaver' })).toBeInTheDocument();

    expect(fireEvent.keyDown(clear, { ctrlKey: true, key: '1' })).toBe(false);
    await waitFor(() => expect(activeService.focusTab).toHaveBeenCalledWith(1, 102));
    expect(screen.queryByRole('dialog', { name: 'Search Weaver' })).not.toBeInTheDocument();
  });

  it('guards a pending tab focus from rapid duplicate activation', async () => {
    const activeService = createActiveService();
    let resolveFocus: (() => void) | undefined;
    const focusPromise = new Promise<void>((resolve) => {
      resolveFocus = resolve;
    });
    vi.mocked(activeService.focusTab).mockReturnValue(focusPromise);
    render(
      <div className="app-shell">
        <CommandPalette
          activeWindowsService={activeService}
          savedWindowsService={createSavedService()}
        />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Search Weaver' }));
    const input = screen.getByRole('combobox', { name: 'Search Weaver' });
    fireEvent.change(input, { target: { value: 'notion' } });
    const option = await screen.findByRole('option', { name: /^Notion roadmap\./u });

    act(() => {
      option.click();
      option.click();
    });

    expect(activeService.focusTab).toHaveBeenCalledOnce();
    expect(activeService.focusTab).toHaveBeenCalledWith(1, 102);
    expect(option).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      resolveFocus?.();
      await focusPromise;
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Search Weaver' })).not.toBeInTheDocument(),
    );
  });

  it('recovers from a failed tab focus and allows a retry', async () => {
    const user = userEvent.setup();
    const activeService = createActiveService();
    vi.mocked(activeService.focusTab)
      .mockRejectedValueOnce(new Error('That tab is no longer available.'))
      .mockResolvedValueOnce(undefined);
    render(
      <div className="app-shell">
        <CommandPalette
          activeWindowsService={activeService}
          savedWindowsService={createSavedService()}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Search Weaver' }));
    await user.type(screen.getByRole('combobox', { name: 'Search Weaver' }), 'notion');
    const option = await screen.findByRole('option', { name: /^Notion roadmap\./u });

    await user.click(option);

    expect(await screen.findByRole('alert')).toHaveTextContent('That tab is no longer available.');
    expect(option).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('dialog', { name: 'Search Weaver' })).toBeInTheDocument();

    await user.click(option);
    await waitFor(() => expect(activeService.focusTab).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog', { name: 'Search Weaver' })).not.toBeInTheDocument();
  });

  it('keeps healthy and static results available when one source fails', async () => {
    const user = userEvent.setup();
    const activeService = createActiveService();
    vi.mocked(activeService.loadSnapshot).mockRejectedValue(new Error('Tabs unavailable'));
    render(
      <div className="app-shell">
        <CommandPalette
          activeWindowsService={activeService}
          savedWindowsService={createSavedService()}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Search Weaver' }));

    expect(await screen.findByRole('option', { name: /^Preview duplicate tabs\./u })).toBeVisible();
    expect(await screen.findByText('Open tabs are temporarily unavailable.')).toBeVisible();

    await user.type(screen.getByRole('combobox', { name: 'Search Weaver' }), 'weaver ideas');
    expect(await screen.findByRole('option', { name: /^Weaver ideas — Notion\./u })).toBeVisible();
  });

  it('lets the clear and close buttons handle Enter without activating a result', async () => {
    const user = userEvent.setup();
    const activeService = createActiveService();
    render(
      <div className="app-shell">
        <CommandPalette
          activeWindowsService={activeService}
          savedWindowsService={createSavedService()}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Search Weaver' }));
    const input = screen.getByRole('combobox', { name: 'Search Weaver' });
    await user.type(input, 'notion');

    await user.tab();
    const clear = screen.getByRole('button', { name: 'Clear search' });
    expect(clear).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(activeService.focusTab).not.toHaveBeenCalled();

    await user.type(input, 'notion');
    await user.tab();
    await user.tab();
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog', { name: 'Search Weaver' })).not.toBeInTheDocument();
    expect(activeService.focusTab).not.toHaveBeenCalled();
  });

  it('reveals saved windows without restoring or opening them', async () => {
    const user = userEvent.setup();
    const savedService = createSavedService();
    render(
      <div className="app-shell">
        <CommandPalette
          activeWindowsService={createActiveService()}
          savedWindowsService={savedService}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Search Weaver' }));
    await user.type(screen.getByRole('combobox', { name: 'Search Weaver' }), 'research planning');

    await user.click(await screen.findByRole('option', { name: /^Research planning\./u }));

    expect(savedService.restoreWindow).not.toHaveBeenCalled();
    expect(savedService.openTab).not.toHaveBeenCalled();
    expect(window.location.hash).toContain('search=Research+planning');
    expect(window.location.hash).toContain('savedWindowId=saved-1');
  });

  it('reveals an exact saved tab without opening a browser tab', async () => {
    const user = userEvent.setup();
    const savedService = createSavedService();
    render(
      <div className="app-shell">
        <CommandPalette
          activeWindowsService={createActiveService()}
          savedWindowsService={savedService}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Search Weaver' }));
    await user.type(screen.getByRole('combobox', { name: 'Search Weaver' }), 'weaver ideas');

    await user.click(await screen.findByRole('option', { name: /^Weaver ideas — Notion\./u }));

    expect(savedService.openTab).not.toHaveBeenCalled();
    expect(savedService.restoreWindow).not.toHaveBeenCalled();
    const searchParams = new URLSearchParams(window.location.hash.split('?')[1]);
    expect(searchParams.get('savedWindowId')).toBe('saved-1');
    expect(searchParams.get('savedWindowUpdatedAt')).toBe('2026-08-16T12:00:00.000Z');
    expect(searchParams.get('tabOrder')).toBe('0');
    expect(searchParams.has('search')).toBe(false);
  });

  it('restores focus after dismissal and stays closed behind an existing dialog', async () => {
    const user = userEvent.setup();
    const activeService = createActiveService();
    const savedService = createSavedService();
    const { rerender } = render(
      <div className="app-shell">
        <button type="button">Before palette</button>
        <CommandPalette activeWindowsService={activeService} savedWindowsService={savedService} />
      </div>,
    );
    const before = screen.getByRole('button', { name: 'Before palette' });
    before.focus();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await screen.findByRole('dialog', { name: 'Search Weaver' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(before).toHaveFocus());

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await screen.findByRole('dialog', { name: 'Search Weaver' });
    before.setAttribute('disabled', '');
    await user.keyboard('{Escape}');
    const trigger = screen.getByRole('button', { name: 'Search Weaver' });
    await waitFor(() => expect(trigger).toHaveFocus());
    before.removeAttribute('disabled');

    trigger.blur();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    const reopenedDialog = await screen.findByRole('dialog', { name: 'Search Weaver' });
    const reopenedInput = within(reopenedDialog).getByRole('combobox', { name: 'Search Weaver' });
    expect(fireEvent.keyDown(reopenedInput, { key: 'k', metaKey: true, repeat: true })).toBe(false);
    expect(reopenedDialog).toBeInTheDocument();
    expect(reopenedInput).toHaveFocus();
    expect(fireEvent.keyDown(reopenedInput, { key: 'k', metaKey: true })).toBe(false);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Search Weaver' })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());

    rerender(
      <div className="app-shell">
        <button type="button">Before palette</button>
        <CommandPalette activeWindowsService={activeService} savedWindowsService={savedService} />
        <div role="dialog" aria-modal="true" aria-label="Existing dialog" />
      </div>,
    );
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: 'Search Weaver' })).not.toBeInTheDocument();
  });
});
