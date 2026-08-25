import {
  RESTORED_TAB_TITLE_MAX_SETTLE_MS,
  RESTORED_TAB_TITLE_SETTLE_DELAY_MS,
  type RestoredTabMetadataService,
  type RestoredTabMetadataTracker,
} from '../platform/chrome/restoredTabMetadata';

interface ChromeEvent<TArgs extends unknown[]> {
  addListener: (listener: (...args: TArgs) => void) => void;
  removeListener: (listener: (...args: TArgs) => void) => void;
}

export interface RestoredTabMetadataEventApi {
  tabs: {
    get: (tabId: number) => Promise<chrome.tabs.Tab>;
    onActivated: ChromeEvent<[activeInfo: chrome.tabs.OnActivatedInfo]>;
    onRemoved: ChromeEvent<[tabId: number, removeInfo: chrome.tabs.OnRemovedInfo]>;
    onReplaced: ChromeEvent<[addedTabId: number, removedTabId: number]>;
    onUpdated: ChromeEvent<
      [tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab]
    >;
  };
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface RestoredTabMetadataListenerEnvironment {
  clearTimeout: (handle: TimerHandle) => void;
  setTimeout: (callback: () => void, delay: number) => TimerHandle;
}

const DEFAULT_ENVIRONMENT: RestoredTabMetadataListenerEnvironment = {
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
};
const MAX_SETTLE_CHECKS =
  Math.ceil(RESTORED_TAB_TITLE_MAX_SETTLE_MS / RESTORED_TAB_TITLE_SETTLE_DELAY_MS) + 1;

export function installRestoredTabMetadataListeners(
  api: RestoredTabMetadataEventApi,
  metadataService: Pick<RestoredTabMetadataService, 'remove' | 'resolve'> &
    RestoredTabMetadataTracker,
  environment: RestoredTabMetadataListenerEnvironment = DEFAULT_ENVIRONMENT,
): () => void {
  const scheduledChecks = new Map<number, TimerHandle>();
  const generations = new Map<number, number>();
  const pendingReplacements = new Map<number, { sourceTabId: number; token: number }>();
  let nextGeneration = 0;
  let nextReplacementToken = 0;
  let disposed = false;

  const invalidate = (tabId: number): number => {
    nextGeneration += 1;
    generations.set(tabId, nextGeneration);
    return nextGeneration;
  };
  const isCurrent = (tabId: number, generation: number) =>
    !disposed && generations.get(tabId) === generation;
  const forgetIfCurrent = (tabId: number, generation: number) => {
    if (generations.get(tabId) === generation) {
      generations.delete(tabId);
    }
  };
  const clearScheduledCheck = (tabId: number) => {
    const handle = scheduledChecks.get(tabId);
    if (handle !== undefined) {
      environment.clearTimeout(handle);
      scheduledChecks.delete(tabId);
    }
  };

  const scheduleCheck = (tabId: number, generation: number, checksRemaining: number) => {
    if (!isCurrent(tabId, generation)) {
      return;
    }
    clearScheduledCheck(tabId);
    const handle = environment.setTimeout(() => {
      if (scheduledChecks.get(tabId) === handle) {
        scheduledChecks.delete(tabId);
      }
      void (async () => {
        if (!isCurrent(tabId, generation)) {
          return;
        }
        const tracked = await metadataService.isTracked(tabId);
        if (!isCurrent(tabId, generation)) {
          return;
        }
        if (!tracked) {
          forgetIfCurrent(tabId, generation);
          return;
        }
        const tab = await api.tabs.get(tabId);
        if (!isCurrent(tabId, generation)) {
          return;
        }
        await metadataService.resolve([tab], { pruneMissing: false });
        if (checksRemaining > 1 && tab.active && tab.status === 'complete') {
          const stillTracked = await metadataService.isTracked(tabId);
          if (!isCurrent(tabId, generation)) {
            return;
          }
          if (stillTracked) {
            scheduleCheck(tabId, generation, checksRemaining - 1);
            return;
          }
        }
        if (isCurrent(tabId, generation)) {
          forgetIfCurrent(tabId, generation);
        }
      })().catch(() => forgetIfCurrent(tabId, generation));
    }, RESTORED_TAB_TITLE_SETTLE_DELAY_MS);
    scheduledChecks.set(tabId, handle);
  };

  const observe = (tabId: number, currentTab?: chrome.tabs.Tab) => {
    const generation = invalidate(tabId);
    clearScheduledCheck(tabId);
    void (async () => {
      const tracked = await metadataService.isTracked(tabId);
      if (!isCurrent(tabId, generation)) {
        return;
      }
      if (!tracked) {
        forgetIfCurrent(tabId, generation);
        return;
      }
      const tab = currentTab ?? (await api.tabs.get(tabId));
      if (!isCurrent(tabId, generation)) {
        return;
      }
      await metadataService.resolve([tab], { pruneMissing: false });
      if (tab.active && tab.status === 'complete') {
        const stillTracked = await metadataService.isTracked(tabId);
        if (!isCurrent(tabId, generation)) {
          return;
        }
        if (stillTracked) {
          scheduleCheck(tabId, generation, MAX_SETTLE_CHECKS);
          return;
        }
      }
      if (isCurrent(tabId, generation)) {
        forgetIfCurrent(tabId, generation);
      }
    })().catch(() => forgetIfCurrent(tabId, generation));
  };

  const handleRemoved = (tabId: number) => {
    const pendingReplacement = pendingReplacements.get(tabId);
    pendingReplacements.delete(tabId);
    invalidate(tabId);
    clearScheduledCheck(tabId);
    generations.delete(tabId);
    const tabIdsToRemove = [tabId, ...(pendingReplacement ? [pendingReplacement.sourceTabId] : [])];
    void metadataService.remove([...new Set(tabIdsToRemove)]).catch(() => undefined);
  };
  const handleReplaced = (addedTabId: number, removedTabId: number) => {
    const inheritedReplacement = pendingReplacements.get(removedTabId);
    pendingReplacements.delete(removedTabId);
    const sourceTabId = inheritedReplacement?.sourceTabId ?? removedTabId;

    invalidate(removedTabId);
    clearScheduledCheck(removedTabId);
    generations.delete(removedTabId);
    invalidate(addedTabId);
    clearScheduledCheck(addedTabId);
    generations.delete(addedTabId);

    nextReplacementToken += 1;
    const token = nextReplacementToken;
    pendingReplacements.set(addedTabId, { sourceTabId, token });
    void (async () => {
      let replacementTab: chrome.tabs.Tab;
      try {
        replacementTab = await api.tabs.get(addedTabId);
      } catch {
        // A rapid chained replacement can make the intermediate ID disappear before its
        // onReplaced event arrives. Keep ownership for that structural event to inherit.
        return;
      }

      const pendingReplacement = pendingReplacements.get(addedTabId);
      if (pendingReplacement?.token !== token) {
        return;
      }
      // Claim this replacement before awaiting its serialized storage mutation. A chained
      // replacement that arrives afterwards will transfer from addedTabId in queue order.
      pendingReplacements.delete(addedTabId);
      try {
        if (await metadataService.replace(sourceTabId, replacementTab)) {
          observe(addedTabId);
        }
      } catch {
        await metadataService.remove([sourceTabId]).catch(() => undefined);
      }
    })();
  };
  const handleActivated = ({ tabId }: chrome.tabs.OnActivatedInfo) => {
    observe(tabId);
  };
  const handleUpdated = (
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab,
  ) => {
    if (
      changeInfo.status === undefined &&
      changeInfo.title === undefined &&
      changeInfo.url === undefined
    ) {
      return;
    }
    observe(tabId, tab);
  };
  api.tabs.onActivated.addListener(handleActivated);
  api.tabs.onRemoved.addListener(handleRemoved);
  api.tabs.onReplaced.addListener(handleReplaced);
  api.tabs.onUpdated.addListener(handleUpdated);

  return () => {
    disposed = true;
    scheduledChecks.forEach((handle) => environment.clearTimeout(handle));
    scheduledChecks.clear();
    generations.clear();
    pendingReplacements.clear();
    api.tabs.onActivated.removeListener(handleActivated);
    api.tabs.onRemoved.removeListener(handleRemoved);
    api.tabs.onReplaced.removeListener(handleReplaced);
    api.tabs.onUpdated.removeListener(handleUpdated);
  };
}
