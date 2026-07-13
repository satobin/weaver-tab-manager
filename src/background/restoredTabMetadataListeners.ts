import { type RestoredTabMetadataService } from '../platform/chrome/restoredTabMetadata';

interface ChromeEvent<TArgs extends unknown[]> {
  addListener: (listener: (...args: TArgs) => void) => void;
  removeListener: (listener: (...args: TArgs) => void) => void;
}

export interface RestoredTabMetadataEventApi {
  tabs: {
    onRemoved: ChromeEvent<[tabId: number, removeInfo: chrome.tabs.OnRemovedInfo]>;
    onUpdated: ChromeEvent<
      [tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab]
    >;
  };
}

export function installRestoredTabMetadataListeners(
  api: RestoredTabMetadataEventApi,
  metadataService: RestoredTabMetadataService,
): () => void {
  const handleRemoved = (tabId: number) => {
    void metadataService.remove([tabId]).catch(() => undefined);
  };
  const handleUpdated = (
    _tabId: number,
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
    void metadataService.resolve([tab], { pruneMissing: false }).catch(() => undefined);
  };
  api.tabs.onRemoved.addListener(handleRemoved);
  api.tabs.onUpdated.addListener(handleUpdated);

  return () => {
    api.tabs.onRemoved.removeListener(handleRemoved);
    api.tabs.onUpdated.removeListener(handleUpdated);
  };
}
