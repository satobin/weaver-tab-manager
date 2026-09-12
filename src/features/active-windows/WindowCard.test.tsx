import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createManagedTab, createManagedWindow } from '../../test/activeWindowsFixtures';
import { WindowCard } from './WindowCard';

function createProps(
  overrides: Partial<ComponentProps<typeof WindowCard>> = {},
): ComponentProps<typeof WindowCard> {
  const window = overrides.window ?? createManagedWindow();
  return {
    allWindowTabs: window.tabs,
    collapsed: false,
    disabled: false,
    draggedGroupId: null,
    draggedTabIds: new Set(),
    dropTarget: null,
    extensionOrigin: 'chrome-extension://weaver/',
    mergeSelected: false,
    onCloseSelectedTabs: vi.fn(),
    onCloseTab: vi.fn(),
    onCloseWindow: vi.fn(),
    onFocusTab: vi.fn(),
    onFocusWindow: vi.fn(),
    onPinTab: vi.fn(),
    onSaveWindow: vi.fn(),
    onSetGroupSelected: vi.fn(),
    onSetTabsSelected: vi.fn(),
    onSortCriterionChange: vi.fn(),
    onSortWindow: vi.fn(),
    onSuspendTab: vi.fn(),
    onSuspendWindow: vi.fn(),
    onTabDragEnd: vi.fn(),
    onTabDragLeave: vi.fn(),
    onTabDragOver: vi.fn(),
    onTabDragStart: vi.fn(),
    onTabDrop: vi.fn(),
    onToggleCollapsed: vi.fn(),
    onToggleTabSelected: vi.fn(),
    onUnpinTab: vi.fn(),
    onUnsuspendTab: vi.fn(),
    onUnsuspendWindow: vi.fn(),
    selectedGroupIds: new Set(),
    selectedTabIds: new Set(),
    showTabUrls: true,
    sortCriterion: 'url',
    sortDirection: 'asc',
    sortMatchesCurrentOrder: false,
    window,
    ...overrides,
  };
}

describe('WindowCard middle-click closing', () => {
  it.each([
    ['row space', '.tab-row'],
    ['title', '.tab-title'],
    ['favicon', '.tab-favicon'],
    ['URL', '.tab-location'],
    ['selection checkbox', '.tab-selection-checkbox'],
    ['pin button', '.tab-pin-button'],
    ['suspend button', '.tab-suspended-button'],
    ['close button', '.tab-close-button'],
  ])('closes once from the %s without activating other actions', async (_name, selector) => {
    const user = userEvent.setup();
    const props = createProps();
    const onParentAuxClick = vi.fn();
    const { container } = render(
      <div onAuxClick={onParentAuxClick}>
        <WindowCard {...props} />
      </div>,
    );
    const target = container.querySelector(selector);
    expect(target).not.toBeNull();

    await user.pointer({ keys: '[MouseMiddle]', target: target as Element });

    expect(props.onCloseTab).toHaveBeenCalledExactlyOnceWith(101);
    expect(props.onFocusTab).not.toHaveBeenCalled();
    expect(props.onToggleTabSelected).not.toHaveBeenCalled();
    expect(props.onPinTab).not.toHaveBeenCalled();
    expect(props.onUnpinTab).not.toHaveBeenCalled();
    expect(props.onSuspendTab).not.toHaveBeenCalled();
    expect(props.onUnsuspendTab).not.toHaveBeenCalled();
    expect(props.onCloseWindow).not.toHaveBeenCalled();
    expect(onParentAuxClick).not.toHaveBeenCalled();
  });

  it('prevents browser defaults only for the middle button', () => {
    const props = createProps();
    render(<WindowCard {...props} />);
    const title = screen.getByText('Example tab');

    for (const button of [0, 1, 2]) {
      const mouseDown = createEvent.mouseDown(title, { button });
      const auxClick = new MouseEvent('auxclick', { bubbles: true, button, cancelable: true });
      fireEvent(title, mouseDown);
      fireEvent(title, auxClick);

      expect(mouseDown.defaultPrevented).toBe(button === 1);
      expect(auxClick.defaultPrevented).toBe(button === 1);
    }
    expect(props.onCloseTab).toHaveBeenCalledExactlyOnceWith(101);
  });

  it('preserves primary actions and leaves right clicks alone', async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<WindowCard {...props} />);
    const focusButton = screen.getByRole('button', { name: 'Focus Example tab' });

    await user.pointer({ keys: '[MouseRight]', target: focusButton });
    expect(props.onCloseTab).not.toHaveBeenCalled();
    expect(props.onFocusTab).not.toHaveBeenCalled();

    await user.click(focusButton);
    expect(props.onFocusTab).toHaveBeenCalledExactlyOnceWith(1, 101);
    await user.click(screen.getByRole('checkbox', { name: 'Select Example tab' }));
    expect(props.onToggleTabSelected).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Pin Example tab' }));
    expect(props.onPinTab).toHaveBeenCalledExactlyOnceWith(101);
    await user.click(screen.getByRole('button', { name: 'Suspend Example tab' }));
    expect(props.onSuspendTab).toHaveBeenCalledExactlyOnceWith(101);
    expect(props.onCloseTab).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close Example tab, tab 1 of 1' }));
    expect(props.onCloseTab).toHaveBeenCalledExactlyOnceWith(101);
  });

  it.each([{ disabled: true }, { closing: true }])(
    'does not close tabs when unavailable: %j',
    (overrides) => {
      const props = createProps(overrides);
      const { container } = render(<WindowCard {...props} />);
      const row = container.querySelector('.tab-row');
      expect(row).not.toBeNull();

      fireEvent(
        row as Element,
        new MouseEvent('auxclick', { bubbles: true, button: 1, cancelable: true }),
      );

      expect(props.onCloseTab).not.toHaveBeenCalled();
    },
  );

  it('closes a grouped tab from its row while preserving group-heading behavior', async () => {
    const user = userEvent.setup();
    const tab = createManagedTab({ groupId: 7 });
    const props = createProps({
      window: createManagedWindow({
        groups: [{ collapsed: false, color: 'blue', id: 7, title: 'Research', windowId: 1 }],
        tabs: [tab],
      }),
    });
    render(<WindowCard {...props} />);
    const groupHeading = screen.getByRole('button', { name: 'Focus first tab in Research' });

    await user.pointer({ keys: '[MouseMiddle]', target: groupHeading });
    expect(props.onCloseTab).not.toHaveBeenCalled();
    expect(props.onFocusTab).not.toHaveBeenCalled();
    expect(props.onSetGroupSelected).not.toHaveBeenCalled();

    await user.click(groupHeading);
    expect(props.onFocusTab).toHaveBeenCalledExactlyOnceWith(1, 101);
    await user.pointer({ keys: '[MouseMiddle]', target: screen.getByText('Example tab') });
    expect(props.onCloseTab).toHaveBeenCalledExactlyOnceWith(101);
    expect(props.onFocusTab).toHaveBeenCalledOnce();
  });
});
