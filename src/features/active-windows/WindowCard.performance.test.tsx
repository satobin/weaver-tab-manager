import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createManagedTab, createManagedWindow } from '../../test/activeWindowsFixtures';
import { WindowCard } from './WindowCard';
import { type ManagedWindow } from './model';

const BENCHMARK_TAB_COUNT = 500;

function createBenchmarkWindow(): ManagedWindow {
  return createManagedWindow({
    tabs: Array.from({ length: BENCHMARK_TAB_COUNT }, (_, index) =>
      createManagedTab({
        active: index === 0,
        id: index + 1,
        index,
        title: `Benchmark tab ${index + 1}`,
        url: `https://example.test/tabs/${index + 1}`,
      }),
    ),
  });
}

function createProps(window: ManagedWindow, collapsed: boolean): ComponentProps<typeof WindowCard> {
  return {
    allWindowTabs: window.tabs,
    collapsed,
    disabled: false,
    draggedGroupId: null,
    draggedTabIds: new Set(),
    dropTarget: null,
    extensionOrigin: 'chrome-extension://weaver/',
    mergeSelected: false,
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
    sortCriterion: 'title',
    sortDirection: 'asc',
    sortMatchesCurrentOrder: false,
    window,
  };
}

describe('WindowCard large-window rendering', () => {
  it('bounds collapsed DOM and renders the current 500-tab snapshot when expanded', () => {
    const initialWindow = createBenchmarkWindow();
    const collapsedProps = createProps(initialWindow, true);
    const onTabDragOver = vi.fn();
    collapsedProps.draggedTabIds = new Set([BENCHMARK_TAB_COUNT + 1]);
    collapsedProps.onTabDragOver = onTabDragOver;
    const { container, rerender } = render(<WindowCard {...collapsedProps} />);

    const collapseButton = screen.getByRole('button', { name: 'Expand Window 1' });
    const tabList = container.querySelector<HTMLUListElement>('#window-1-tabs');
    expect(collapseButton).toHaveAttribute('aria-controls', 'window-1-tabs');
    expect(collapseButton).toHaveAttribute('aria-expanded', 'false');
    expect(tabList).not.toBeNull();
    expect(tabList).toHaveAttribute('hidden');
    expect(tabList?.querySelectorAll('.tab-list-item')).toHaveLength(0);
    expect(container.querySelectorAll('[data-tab-focus-id]')).toHaveLength(0);

    const card = container.querySelector('article');
    expect(card).not.toBeNull();
    const dragOverEvent = createEvent.dragOver(card as HTMLElement, {
      dataTransfer: { dropEffect: 'none' },
    });
    Object.defineProperties(dragOverEvent, {
      clientX: { value: 12 },
      clientY: { value: 34 },
    });
    fireEvent(card as HTMLElement, dragOverEvent);
    expect(onTabDragOver).toHaveBeenCalledWith(
      {
        browserIndex: -1,
        groupId: null,
        visualIndex: BENCHMARK_TAB_COUNT,
        windowId: 1,
      },
      { x: 12, y: 34 },
    );

    const currentWindow = {
      ...initialWindow,
      tabs: initialWindow.tabs.map((tab, index) =>
        index === BENCHMARK_TAB_COUNT - 1
          ? {
              ...tab,
              agentAssociated: true,
              title: 'Updated while collapsed',
            }
          : tab,
      ),
    };
    rerender(<WindowCard {...createProps(currentWindow, false)} />);

    const expandedTabList = container.querySelector<HTMLUListElement>('#window-1-tabs');
    expect(expandedTabList).toBe(tabList);
    expect(expandedTabList).not.toHaveAttribute('hidden');
    expect(expandedTabList?.querySelectorAll('.tab-list-item')).toHaveLength(BENCHMARK_TAB_COUNT);
    expect(screen.queryByText('Benchmark tab 500')).not.toBeInTheDocument();

    const updatedFocusButton = screen.getByRole('button', {
      name: 'Focus Updated while collapsed',
    });
    expect(updatedFocusButton).toHaveAttribute('draggable', 'true');
    expect(updatedFocusButton.querySelector('.agent-associated-tab-indicator')).not.toBeNull();
  });
});
