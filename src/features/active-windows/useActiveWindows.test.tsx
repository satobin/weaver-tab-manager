import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createActiveWindowsSnapshot,
  createManagedTab,
  createManagedWindow,
} from '../../test/activeWindowsFixtures';
import { type ActiveWindowsService, type RestorableTab } from './chromeActiveWindowsService';
import { useActiveWindows } from './useActiveWindows';

function createService() {
  const listeners = new Set<() => void>();
  const snapshot = createActiveWindowsSnapshot();
  const service: ActiveWindowsService = {
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
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    suspendTabs: vi.fn(() => Promise.resolve({ affectedTabIds: [], failures: [] })),
    unsuspendTabs: vi.fn(() => Promise.resolve({ affectedTabIds: [], failures: [] })),
  };

  return {
    emitChange: () => listeners.forEach((listener) => listener()),
    listenerCount: () => listeners.size,
    service,
    snapshot,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useActiveWindows', () => {
  it('loads a snapshot and coalesces event bursts into one refresh', async () => {
    const fake = createService();
    const { result } = renderHook(() => useActiveWindows(fake.service));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.snapshot).toBe(fake.snapshot);
    expect(fake.service.loadSnapshot).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    act(() => {
      fake.emitChange();
      fake.emitChange();
      fake.emitChange();
    });
    expect(fake.service.loadSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(fake.service.loadSnapshot).toHaveBeenCalledTimes(2);
  });

  it('shares one cached query and Chrome subscription across consumers', async () => {
    const fake = createService();
    const first = renderHook(() => useActiveWindows(fake.service));
    const second = renderHook(() => useActiveWindows(fake.service));

    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(second.result.current.snapshot).toBe(fake.snapshot);
    expect(fake.service.loadSnapshot).toHaveBeenCalledTimes(1);
    expect(fake.service.subscribe).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount()).toBe(1);

    first.unmount();
    expect(fake.listenerCount()).toBe(1);
    second.unmount();
    expect(fake.listenerCount()).toBe(0);
  });

  it('coalesces concurrent manual refreshes', async () => {
    const fake = createService();
    let resolveRefresh:
      | ((snapshot: ReturnType<typeof createActiveWindowsSnapshot>) => void)
      | null = null;
    vi.mocked(fake.service.loadSnapshot)
      .mockResolvedValueOnce(fake.snapshot)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );
    const { result } = renderHook(() => useActiveWindows(fake.service));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let firstRefresh: Promise<void> | undefined;
    let secondRefresh: Promise<void> | undefined;
    act(() => {
      firstRefresh = result.current.refresh();
      secondRefresh = result.current.refresh();
    });
    expect(firstRefresh).toBe(secondRefresh);
    expect(fake.service.loadSnapshot).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveRefresh?.(fake.snapshot);
      await firstRefresh;
    });
  });

  it('keeps the last good snapshot when a later refresh fails', async () => {
    const fake = createService();
    vi.mocked(fake.service.loadSnapshot)
      .mockResolvedValueOnce(fake.snapshot)
      .mockRejectedValueOnce(new Error('Window query failed'));
    const { result } = renderHook(() => useActiveWindows(fake.service));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.refresh());

    expect(result.current.status).toBe('ready');
    expect(result.current.snapshot).toBe(fake.snapshot);
    expect(result.current.errorMessage).toBe('Window query failed');
  });

  it('retains the last focused Chrome window while the browser is not foreground', async () => {
    const fake = createService();
    const createSnapshot = (focusedWindowId: number | null) =>
      createActiveWindowsSnapshot({
        windows: [
          createManagedWindow({ focused: focusedWindowId === 1 }),
          createManagedWindow({
            focused: focusedWindowId === 2,
            id: 2,
            isCurrent: false,
            label: 'Window 1',
            tabs: [createManagedTab({ id: 201, windowId: 2 })],
          }),
        ],
      });
    vi.mocked(fake.service.loadSnapshot)
      .mockResolvedValueOnce(createSnapshot(1))
      .mockResolvedValueOnce(createSnapshot(null))
      .mockResolvedValueOnce(createSnapshot(2));
    const { result } = renderHook(() => useActiveWindows(fake.service));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.refresh());
    expect(result.current.snapshot?.windows.find((window) => window.id === 1)?.focused).toBe(true);
    expect(result.current.snapshot?.windows.find((window) => window.id === 2)?.focused).toBe(false);

    await act(() => result.current.refresh());
    expect(result.current.snapshot?.windows.find((window) => window.id === 1)?.focused).toBe(false);
    expect(result.current.snapshot?.windows.find((window) => window.id === 2)?.focused).toBe(true);
  });

  it('removes its Chrome listeners on unmount', async () => {
    const fake = createService();
    const { result, unmount } = renderHook(() => useActiveWindows(fake.service));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fake.listenerCount()).toBe(1);

    unmount();
    expect(fake.listenerCount()).toBe(0);
  });
});
