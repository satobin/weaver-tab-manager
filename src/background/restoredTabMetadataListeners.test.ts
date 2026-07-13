import { describe, expect, it, vi } from 'vitest';

import { type RestoredTabMetadataService } from '../platform/chrome/restoredTabMetadata';
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
  it('maintains restored-tab metadata for relevant updates and removals', () => {
    const onRemoved = createEvent<[number, chrome.tabs.OnRemovedInfo]>();
    const onUpdated = createEvent<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>();
    const api: RestoredTabMetadataEventApi = { tabs: { onRemoved, onUpdated } };
    const metadataService: RestoredTabMetadataService = {
      register: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
      resolve: vi.fn(() => Promise.resolve(new Map())),
      subscribe: () => () => undefined,
    };

    const cleanup = installRestoredTabMetadataListeners(api, metadataService);
    expect(onRemoved.listenerCount()).toBe(1);
    expect(onUpdated.listenerCount()).toBe(1);
    onUpdated.notify(42, {}, { id: 42 } as chrome.tabs.Tab);
    expect(metadataService.resolve).not.toHaveBeenCalled();
    onUpdated.notify(42, { title: 'Loaded title' }, { id: 42 } as chrome.tabs.Tab);
    onRemoved.notify(42, { isWindowClosing: false, windowId: 1 });
    expect(metadataService.resolve).toHaveBeenCalledWith([{ id: 42 }], {
      pruneMissing: false,
    });
    expect(metadataService.remove).toHaveBeenCalledWith([42]);

    cleanup();
    expect(onRemoved.listenerCount()).toBe(0);
    expect(onUpdated.listenerCount()).toBe(0);
  });
});
