import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type ActiveWindowsService } from '../features/active-windows/chromeActiveWindowsService';
import { type SavedWindowsService } from '../features/saved-windows/savedWindowsService';
import { useActiveWindowCount, useSavedWindowCount } from './useNavigationCounts';

function createActiveService() {
  const listeners = new Set<() => void>();
  let count = 2;
  const service = {
    loadSnapshot: vi.fn(() => Promise.reject(new Error('Full snapshots are not used for counts'))),
    loadWindowCount: vi.fn(() => Promise.resolve(count)),
    subscribe: vi.fn(() => () => undefined),
    subscribeWindowCount: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } as unknown as ActiveWindowsService;
  return {
    emit: () => listeners.forEach((listener) => listener()),
    listenerCount: () => listeners.size,
    service,
    setCount: (nextCount: number) => {
      count = nextCount;
    },
  };
}

function createSavedService() {
  const listeners = new Set<() => void>();
  let count = 3;
  const service = {
    load: vi.fn(() => Promise.reject(new Error('Full collections are not used for counts'))),
    loadCount: vi.fn(() => Promise.resolve(count)),
    subscribe: vi.fn(() => () => undefined),
    subscribeCount: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } as unknown as SavedWindowsService;
  return {
    emit: () => listeners.forEach((listener) => listener()),
    listenerCount: () => listeners.size,
    service,
    setCount: (nextCount: number) => {
      count = nextCount;
    },
  };
}

describe('navigation count hooks', () => {
  it('refreshes the active-window count from its lightweight event source', async () => {
    const fake = createActiveService();
    const { result, unmount } = renderHook(() => useActiveWindowCount(fake.service));

    await waitFor(() => expect(result.current).toBe(2));
    expect(fake.service.loadSnapshot).not.toHaveBeenCalled();
    expect(fake.service.subscribe).not.toHaveBeenCalled();

    fake.setCount(4);
    act(() => fake.emit());
    await waitFor(() => expect(result.current).toBe(4));

    unmount();
    expect(fake.listenerCount()).toBe(0);
  });

  it('starts clean after the saved-count observer is disabled and remounted', async () => {
    const fake = createSavedService();
    const first = renderHook(() => useSavedWindowCount(fake.service));

    await waitFor(() => expect(first.result.current).toBe(3));
    expect(fake.service.load).not.toHaveBeenCalled();
    expect(fake.service.subscribe).not.toHaveBeenCalled();

    fake.setCount(5);
    act(() => fake.emit());
    await waitFor(() => expect(first.result.current).toBe(5));

    first.unmount();
    expect(fake.listenerCount()).toBe(0);

    fake.setCount(8);
    let resolveReload: ((count: number) => void) | undefined;
    vi.mocked(fake.service.loadCount!).mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolveReload = resolve;
        }),
    );
    const second = renderHook(() => useSavedWindowCount(fake.service));
    expect(second.result.current).toBeNull();
    await waitFor(() => expect(fake.service.loadCount).toHaveBeenCalledTimes(3));
    act(() => resolveReload?.(8));
    await waitFor(() => expect(second.result.current).toBe(8));

    second.unmount();
    expect(fake.listenerCount()).toBe(0);
  });
});
