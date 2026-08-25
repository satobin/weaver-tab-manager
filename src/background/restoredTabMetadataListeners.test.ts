import { describe, expect, it, vi } from 'vitest';

import {
  RESTORED_TAB_TITLE_MAX_SETTLE_MS,
  RESTORED_TAB_TITLE_SETTLE_DELAY_MS,
  type RestoredTabMetadataService,
  type RestoredTabMetadataTracker,
} from '../platform/chrome/restoredTabMetadata';
import {
  installRestoredTabMetadataListeners,
  type RestoredTabMetadataEventApi,
  type RestoredTabMetadataListenerEnvironment,
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

function createApi() {
  const onActivated = createEvent<[chrome.tabs.OnActivatedInfo]>();
  const onRemoved = createEvent<[number, chrome.tabs.OnRemovedInfo]>();
  const onReplaced = createEvent<[number, number]>();
  const onUpdated = createEvent<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>();
  const get = vi.fn((tabId: number) => Promise.resolve({ id: tabId } as chrome.tabs.Tab));
  const api: RestoredTabMetadataEventApi = {
    tabs: { get, onActivated, onRemoved, onReplaced, onUpdated },
  };
  return { api, get, onActivated, onRemoved, onReplaced, onUpdated };
}

function createScheduler() {
  let nextHandle = 0;
  const callbacks = new Map<number, () => void>();
  const environment: RestoredTabMetadataListenerEnvironment = {
    clearTimeout: vi.fn((handle: ReturnType<typeof setTimeout>) =>
      callbacks.delete(handle as unknown as number),
    ),
    setTimeout: vi.fn((callback: () => void, delay: number) => {
      void delay;
      nextHandle += 1;
      callbacks.set(nextHandle, callback);
      return nextHandle as unknown as ReturnType<typeof setTimeout>;
    }),
  };
  return {
    environment,
    pendingCount: () => callbacks.size,
    runNext: () => {
      const next = callbacks.entries().next().value as [number, () => void] | undefined;
      if (!next) {
        throw new Error('No scheduled callback.');
      }
      callbacks.delete(next[0]);
      next[1]();
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('restored-tab metadata listeners', () => {
  it('maintains restored-tab metadata for tracked updates and removals', async () => {
    const { api, onActivated, onRemoved, onReplaced, onUpdated } = createApi();
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn(() => Promise.resolve(true)),
      remove: vi.fn(() => Promise.resolve()),
      replace: vi.fn(() => Promise.resolve(true)),
      resolve: vi.fn(() => Promise.resolve(new Map())),
    };

    const cleanup = installRestoredTabMetadataListeners(api, metadataService);
    expect(onActivated.listenerCount()).toBe(1);
    expect(onRemoved.listenerCount()).toBe(1);
    expect(onReplaced.listenerCount()).toBe(1);
    expect(onUpdated.listenerCount()).toBe(1);
    onUpdated.notify(42, {}, { id: 42 } as chrome.tabs.Tab);
    expect(metadataService.resolve).not.toHaveBeenCalled();
    onUpdated.notify(42, { title: 'Loaded title' }, { id: 42 } as chrome.tabs.Tab);
    await vi.waitFor(() =>
      expect(metadataService.resolve).toHaveBeenCalledWith([{ id: 42 }], {
        pruneMissing: false,
      }),
    );
    onRemoved.notify(42, { isWindowClosing: false, windowId: 1 });
    await Promise.resolve();
    expect(metadataService.remove).toHaveBeenCalledWith([42]);

    cleanup();
    expect(onActivated.listenerCount()).toBe(0);
    expect(onRemoved.listenerCount()).toBe(0);
    expect(onReplaced.listenerCount()).toBe(0);
    expect(onUpdated.listenerCount()).toBe(0);
  });

  it('skips metadata work for bursts of untracked tab updates', async () => {
    const { api, onUpdated } = createApi();
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn(() => Promise.resolve(false)),
      remove: vi.fn(() => Promise.resolve()),
      replace: vi.fn(() => Promise.resolve(true)),
      resolve: vi.fn(() => Promise.resolve(new Map())),
    };

    installRestoredTabMetadataListeners(api, metadataService);
    for (let tabId = 0; tabId < 500; tabId += 1) {
      onUpdated.notify(tabId, { status: 'loading' }, { id: tabId } as chrome.tabs.Tab);
    }
    await vi.waitFor(() => expect(metadataService.isTracked).toHaveBeenCalledTimes(500));

    expect(metadataService.resolve).not.toHaveBeenCalled();
    expect(metadataService.remove).not.toHaveBeenCalled();
  });

  it('always cleans up metadata when a tab closes', async () => {
    const { api, onRemoved } = createApi();
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn(() => Promise.resolve(false)),
      remove: vi.fn(() => Promise.resolve()),
      replace: vi.fn(() => Promise.resolve(true)),
      resolve: vi.fn(() => Promise.resolve(new Map())),
    };

    installRestoredTabMetadataListeners(api, metadataService);
    onRemoved.notify(42, { isWindowClosing: false, windowId: 1 });
    await Promise.resolve();

    expect(metadataService.isTracked).not.toHaveBeenCalled();
    expect(metadataService.remove).toHaveBeenCalledWith([42]);
  });

  it('reconciles an activated tracked tab and schedules a fresh follow-up snapshot', async () => {
    const { api, get, onActivated } = createApi();
    const scheduler = createScheduler();
    let tracked = true;
    const activatedTab = {
      active: true,
      id: 42,
      status: 'complete',
      title: 'Google Docs',
    } as chrome.tabs.Tab;
    const settledTab = {
      ...activatedTab,
      title: 'Quarterly plan - Google Docs',
    } as chrome.tabs.Tab;
    get.mockResolvedValueOnce(activatedTab).mockResolvedValueOnce(settledTab);
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn(() => Promise.resolve(tracked)),
      remove: vi.fn(() => Promise.resolve()),
      replace: vi.fn(() => Promise.resolve(true)),
      resolve: vi.fn((tabs: readonly chrome.tabs.Tab[]) => {
        if (tabs[0] === settledTab) {
          tracked = false;
        }
        return Promise.resolve(new Map());
      }),
    };
    const cleanup = installRestoredTabMetadataListeners(
      api,
      metadataService,
      scheduler.environment,
    );

    onActivated.notify({ tabId: 42, windowId: 1 });
    await vi.waitFor(() => expect(scheduler.pendingCount()).toBe(1));
    expect(metadataService.resolve).toHaveBeenNthCalledWith(1, [activatedTab], {
      pruneMissing: false,
    });

    scheduler.runNext();
    await vi.waitFor(() => expect(metadataService.resolve).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenCalledTimes(2);
    expect(metadataService.resolve).toHaveBeenNthCalledWith(2, [settledTab], {
      pruneMissing: false,
    });
    expect(scheduler.pendingCount()).toBe(0);

    cleanup();
  });

  it('continues fresh checks through the first-title settling ceiling', async () => {
    const { api, get, onUpdated } = createApi();
    const scheduler = createScheduler();
    const followUpCount = Math.ceil(
      RESTORED_TAB_TITLE_MAX_SETTLE_MS / RESTORED_TAB_TITLE_SETTLE_DELAY_MS,
    );
    let resolveCall = 0;
    let tracked = true;
    const activeCompleteTab = {
      active: true,
      id: 42,
      status: 'complete',
      title: 'Google Docs',
    } as chrome.tabs.Tab;
    get.mockResolvedValue(activeCompleteTab);
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn(() => Promise.resolve(tracked)),
      remove: vi.fn(() => Promise.resolve()),
      replace: vi.fn(() => Promise.resolve(true)),
      resolve: vi.fn(() => {
        resolveCall += 1;
        if (resolveCall === followUpCount + 1) {
          tracked = false;
        }
        return Promise.resolve(new Map());
      }),
    };
    const cleanup = installRestoredTabMetadataListeners(
      api,
      metadataService,
      scheduler.environment,
    );

    onUpdated.notify(42, { title: 'Google Docs' }, activeCompleteTab);
    await vi.waitFor(() => expect(scheduler.pendingCount()).toBe(1));

    for (let index = 0; index < followUpCount; index += 1) {
      scheduler.runNext();
      await vi.waitFor(() => expect(metadataService.resolve).toHaveBeenCalledTimes(index + 2));
    }

    expect(get).toHaveBeenCalledTimes(followUpCount);
    expect(scheduler.pendingCount()).toBe(0);

    cleanup();
  });

  it('cancels an older scheduled snapshot when a newer title update arrives', async () => {
    const { api, get, onUpdated } = createApi();
    const scheduler = createScheduler();
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn(() => Promise.resolve(true)),
      remove: vi.fn(() => Promise.resolve()),
      replace: vi.fn(() => Promise.resolve(true)),
      resolve: vi.fn(() => Promise.resolve(new Map())),
    };
    const cleanup = installRestoredTabMetadataListeners(
      api,
      metadataService,
      scheduler.environment,
    );

    onUpdated.notify(42, { title: 'Google Docs' }, {
      active: true,
      id: 42,
      status: 'complete',
    } as chrome.tabs.Tab);
    await vi.waitFor(() => expect(scheduler.pendingCount()).toBe(1));
    onUpdated.notify(42, { title: 'Quarterly plan - Google Docs' }, {
      active: true,
      id: 42,
      status: 'complete',
    } as chrome.tabs.Tab);
    await vi.waitFor(() => expect(metadataService.resolve).toHaveBeenCalledTimes(2));
    expect(scheduler.pendingCount()).toBe(1);

    scheduler.runNext();
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    cleanup();
  });

  it('does not let a stale tracking result replace a newer scheduled snapshot', async () => {
    const { api, onUpdated } = createApi();
    const scheduler = createScheduler();
    const staleTrackingResult = createDeferred<boolean>();
    let trackingCall = 0;
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn(() => {
        trackingCall += 1;
        return trackingCall === 2 ? staleTrackingResult.promise : Promise.resolve(true);
      }),
      remove: vi.fn(() => Promise.resolve()),
      replace: vi.fn(() => Promise.resolve(true)),
      resolve: vi.fn(() => Promise.resolve(new Map())),
    };
    const cleanup = installRestoredTabMetadataListeners(
      api,
      metadataService,
      scheduler.environment,
    );
    const activeCompleteTab = {
      active: true,
      id: 42,
      status: 'complete',
    } as chrome.tabs.Tab;

    onUpdated.notify(42, { title: 'Google Docs' }, activeCompleteTab);
    await vi.waitFor(() => expect(metadataService.isTracked).toHaveBeenCalledTimes(2));
    onUpdated.notify(42, { title: 'Quarterly plan - Google Docs' }, activeCompleteTab);
    await vi.waitFor(() => expect(scheduler.pendingCount()).toBe(1));

    staleTrackingResult.resolve(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(scheduler.environment.setTimeout).toHaveBeenCalledTimes(1);
    expect(scheduler.environment.clearTimeout).not.toHaveBeenCalled();

    cleanup();
  });

  it('transfers replacement metadata after canceling the removed tab check', async () => {
    const { api, get, onReplaced, onUpdated } = createApi();
    const scheduler = createScheduler();
    const trackedTabIds = new Set([42]);
    const replacementTab = {
      active: true,
      id: 84,
      status: 'complete',
      title: 'Google Docs',
      url: 'https://docs.example/plan',
    } as chrome.tabs.Tab;
    const freshReplacementTab = {
      ...replacementTab,
      active: false,
      title: 'Quarterly plan - Google Docs',
    };
    get.mockResolvedValueOnce(replacementTab).mockResolvedValueOnce(freshReplacementTab);
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn((tabId: number) => Promise.resolve(trackedTabIds.has(tabId))),
      remove: vi.fn(() => Promise.resolve()),
      replace: vi.fn((removedTabId: number, tab: chrome.tabs.Tab) => {
        trackedTabIds.delete(removedTabId);
        if (tab.id !== undefined) {
          trackedTabIds.add(tab.id);
        }
        return Promise.resolve(true);
      }),
      resolve: vi.fn(() => Promise.resolve(new Map())),
    };
    const cleanup = installRestoredTabMetadataListeners(
      api,
      metadataService,
      scheduler.environment,
    );

    onUpdated.notify(42, { title: 'Google Docs' }, {
      active: true,
      id: 42,
      status: 'complete',
    } as chrome.tabs.Tab);
    await vi.waitFor(() => expect(scheduler.pendingCount()).toBe(1));

    onReplaced.notify(84, 42);
    await vi.waitFor(() =>
      expect(metadataService.resolve).toHaveBeenCalledWith([freshReplacementTab], {
        pruneMissing: false,
      }),
    );

    expect(metadataService.replace).toHaveBeenCalledWith(42, replacementTab);
    expect(scheduler.environment.clearTimeout).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingCount()).toBe(0);

    cleanup();
  });

  it('freshly observes a replacement after an update arrives during its lookup', async () => {
    const { api, get, onReplaced, onUpdated } = createApi();
    const replacementLookup = createDeferred<chrome.tabs.Tab>();
    const trackedTabIds = new Set([42]);
    const replacementTab = {
      active: true,
      id: 84,
      status: 'complete',
      title: 'Google Docs',
      url: 'https://docs.example/plan',
    } as chrome.tabs.Tab;
    const latestTab = {
      ...replacementTab,
      active: false,
      title: 'Quarterly plan - Google Docs',
    };
    get.mockImplementationOnce(() => replacementLookup.promise).mockResolvedValueOnce(latestTab);
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn((tabId: number) => Promise.resolve(trackedTabIds.has(tabId))),
      remove: vi.fn(() => Promise.resolve()),
      replace: vi.fn((removedTabId: number, tab: chrome.tabs.Tab) => {
        trackedTabIds.delete(removedTabId);
        if (tab.id !== undefined) {
          trackedTabIds.add(tab.id);
        }
        return Promise.resolve(true);
      }),
      resolve: vi.fn(() => Promise.resolve(new Map())),
    };
    const cleanup = installRestoredTabMetadataListeners(api, metadataService);

    onReplaced.notify(84, 42);
    onUpdated.notify(84, { title: latestTab.title }, latestTab);
    await vi.waitFor(() => expect(metadataService.isTracked).toHaveBeenCalledWith(84));

    replacementLookup.resolve(replacementTab);
    await vi.waitFor(() =>
      expect(metadataService.resolve).toHaveBeenCalledWith([latestTab], {
        pruneMissing: false,
      }),
    );

    expect(metadataService.replace).toHaveBeenCalledWith(42, replacementTab);
    expect(get).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('carries pending metadata across a vanished intermediate replacement', async () => {
    const { api, get, onReplaced } = createApi();
    const trackedTabIds = new Set([42]);
    const finalReplacementTab = {
      active: false,
      id: 126,
      status: 'complete',
      title: 'Quarterly plan - Google Docs',
      url: 'https://docs.example/plan',
    } as chrome.tabs.Tab;
    get
      .mockRejectedValueOnce(new Error('Intermediate tab no longer exists'))
      .mockResolvedValueOnce(finalReplacementTab)
      .mockResolvedValueOnce(finalReplacementTab);
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn((tabId: number) => Promise.resolve(trackedTabIds.has(tabId))),
      remove: vi.fn(() => Promise.resolve()),
      replace: vi.fn((removedTabId: number, tab: chrome.tabs.Tab) => {
        trackedTabIds.delete(removedTabId);
        if (tab.id !== undefined) {
          trackedTabIds.add(tab.id);
        }
        return Promise.resolve(true);
      }),
      resolve: vi.fn(() => Promise.resolve(new Map())),
    };
    const cleanup = installRestoredTabMetadataListeners(api, metadataService);

    onReplaced.notify(84, 42);
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith(84));
    onReplaced.notify(126, 84);
    await vi.waitFor(() =>
      expect(metadataService.resolve).toHaveBeenCalledWith([finalReplacementTab], {
        pruneMissing: false,
      }),
    );

    expect(metadataService.replace).toHaveBeenCalledTimes(1);
    expect(metadataService.replace).toHaveBeenCalledWith(42, finalReplacementTab);
    expect(metadataService.remove).not.toHaveBeenCalled();

    cleanup();
  });

  it('removes pending source metadata when the replacement closes during lookup', async () => {
    const { api, onRemoved, onReplaced } = createApi();
    const replacementLookup = createDeferred<chrome.tabs.Tab>();
    vi.mocked(api.tabs.get).mockImplementationOnce(() => replacementLookup.promise);
    const metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
      RestoredTabMetadataTracker = {
      isTracked: vi.fn(() => Promise.resolve(true)),
      remove: vi.fn(() => Promise.resolve()),
      replace: vi.fn(() => Promise.resolve(true)),
      resolve: vi.fn(() => Promise.resolve(new Map())),
    };
    const cleanup = installRestoredTabMetadataListeners(api, metadataService);

    onReplaced.notify(84, 42);
    onRemoved.notify(84, { isWindowClosing: false, windowId: 1 });
    await vi.waitFor(() => expect(metadataService.remove).toHaveBeenCalledWith([84, 42]));

    replacementLookup.resolve({ id: 84 } as chrome.tabs.Tab);
    await Promise.resolve();
    await Promise.resolve();
    expect(metadataService.replace).not.toHaveBeenCalled();

    cleanup();
  });
});
