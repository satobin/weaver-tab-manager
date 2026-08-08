import { describe, expect, it, vi } from 'vitest';

import {
  type RestoredTabMetadataService,
  type RestoredTabMetadataTracker,
} from '../platform/chrome/restoredTabMetadata';
import {
  installRestoredTabMetadataListeners,
  type RestoredTabMetadataEventApi,
} from './restoredTabMetadataListeners';

function createEvent<TArgs extends unknown[]>() {
  const listeners = new Set<(...args: TArgs) => void>();
  return {
    addListener: (listener: (...args: TArgs) => void) => listeners.add(listener),
    listenerCount: () => listeners.size,
    notify: (...args: TArgs) => listeners.forEach((listener) => listener(...args)),
    removeListener: (listener: (...args: TArgs) => void) => listeners.delete(listener),
  };
}

describe('restored-tab metadata listeners', () => {
  it('maintains restored-tab metadata for tracked updates and removals', async () => {
    const onRemoved = createEvent<[number, chrome.tabs.OnRemovedInfo]>();
    const onUpdated = createEvent<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>();
    const api: RestoredTabMetadataEventApi = { tabs: { onRemoved, onUpdated } };
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn(() => Promise.resolve(true)),
      remove: vi.fn(() => Promise.resolve()),
      resolve: vi.fn(() => Promise.resolve(new Map())),
    };

    const cleanup = installRestoredTabMetadataListeners(api, metadataService);
    expect(onRemoved.listenerCount()).toBe(1);
    expect(onUpdated.listenerCount()).toBe(1);
    onUpdated.notify(42, {}, { id: 42 } as chrome.tabs.Tab);
    expect(metadataService.resolve).not.toHaveBeenCalled();
    onUpdated.notify(42, { title: 'Loaded title' }, { id: 42 } as chrome.tabs.Tab);
    onRemoved.notify(42, { isWindowClosing: false, windowId: 1 });
    await Promise.resolve();
    expect(metadataService.resolve).toHaveBeenCalledWith([{ id: 42 }], {
      pruneMissing: false,
    });
    expect(metadataService.remove).toHaveBeenCalledWith([42]);

    cleanup();
    expect(onRemoved.listenerCount()).toBe(0);
    expect(onUpdated.listenerCount()).toBe(0);
  });

  it('skips metadata work for bursts of untracked tab updates', async () => {
    const onRemoved = createEvent<[number, chrome.tabs.OnRemovedInfo]>();
    const onUpdated = createEvent<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>();
    const api: RestoredTabMetadataEventApi = { tabs: { onRemoved, onUpdated } };
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn(() => Promise.resolve(false)),
      remove: vi.fn(() => Promise.resolve()),
      resolve: vi.fn(() => Promise.resolve(new Map())),
    };

    installRestoredTabMetadataListeners(api, metadataService);
    for (let tabId = 0; tabId < 500; tabId += 1) {
      onUpdated.notify(tabId, { status: 'loading' }, { id: tabId } as chrome.tabs.Tab);
    }
    await Promise.resolve();

    expect(metadataService.isTracked).toHaveBeenCalledTimes(500);
    expect(metadataService.resolve).not.toHaveBeenCalled();
    expect(metadataService.remove).not.toHaveBeenCalled();
  });

  it('always cleans up metadata when a tab closes', async () => {
    const onRemoved = createEvent<[number, chrome.tabs.OnRemovedInfo]>();
    const onUpdated = createEvent<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>();
    const api: RestoredTabMetadataEventApi = { tabs: { onRemoved, onUpdated } };
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn(() => Promise.resolve(false)),
      remove: vi.fn(() => Promise.resolve()),
      resolve: vi.fn(() => Promise.resolve(new Map())),
    };

    installRestoredTabMetadataListeners(api, metadataService);
    onRemoved.notify(42, { isWindowClosing: false, windowId: 1 });
    await Promise.resolve();

    expect(metadataService.isTracked).not.toHaveBeenCalled();
    expect(metadataService.remove).toHaveBeenCalledWith([42]);
  });
});
