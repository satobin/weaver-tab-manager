import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type SavedWindow } from './savedWindowModel';
import { type SavedWindowsService } from './savedWindowsService';
import { useSavedWindows } from './useSavedWindows';

const savedWindow: SavedWindow = {
  createdAt: '2026-07-10T20:00:00.000Z',
  groups: [],
  id: 'saved-1',
  name: 'Research',
  tabs: [
    {
      active: true,
      order: 0,
      pinned: false,
      title: 'Plan',
      url: 'https://docs.example.com/plan',
    },
  ],
  updatedAt: '2026-07-10T20:00:00.000Z',
};

function createService() {
  const listeners = new Set<() => void>();
  const service: SavedWindowsService = {
    deleteWindow: vi.fn(() => Promise.resolve()),
    keepWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    load: vi.fn(() => Promise.resolve([savedWindow])),
    openTab: vi.fn(() => Promise.reject(new Error('Not used'))),
    renameWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    restoreWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    saveWindow: vi.fn(() => Promise.reject(new Error('Not used'))),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  return {
    emit: () => listeners.forEach((listener) => listener()),
    listenerCount: () => listeners.size,
    service,
  };
}

describe('useSavedWindows', () => {
  it('loads saved windows and refreshes on storage changes', async () => {
    const fake = createService();
    const { result } = renderHook(() => useSavedWindows(fake.service));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.windows).toEqual([savedWindow]);

    vi.mocked(fake.service.load).mockResolvedValue([]);
    act(() => fake.emit());
    await waitFor(() => expect(result.current.windows).toEqual([]));
    expect(fake.service.load).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good collection when a later refresh fails', async () => {
    const fake = createService();
    const { result } = renderHook(() => useSavedWindows(fake.service));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    vi.mocked(fake.service.load).mockRejectedValueOnce(new Error('Storage unavailable'));
    await act(() => result.current.refresh());

    expect(result.current.status).toBe('ready');
    expect(result.current.windows).toEqual([savedWindow]);
    expect(result.current.errorMessage).toBe('Storage unavailable');
  });

  it('removes its storage listener on unmount', async () => {
    const fake = createService();
    const { result, unmount } = renderHook(() => useSavedWindows(fake.service));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fake.listenerCount()).toBe(1);
    unmount();
    expect(fake.listenerCount()).toBe(0);
  });
});
