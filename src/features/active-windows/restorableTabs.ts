import { type RestorableTab } from './chromeActiveWindowsService';
import { type ActiveWindowsSnapshot } from './model';

export function createRestorableTabs(
  snapshot: ActiveWindowsSnapshot,
  tabIds: readonly number[],
): RestorableTab[] {
  const tabsById = new Map<number, RestorableTab>();
  snapshot.windows.forEach((window) => {
    const groupsById = new Map(window.groups.map((group) => [group.id, group]));
    window.tabs.forEach((tab) => {
      const group = tab.groupId === null ? undefined : groupsById.get(tab.groupId);
      tabsById.set(tab.id, {
        group: group
          ? {
              collapsed: group.collapsed,
              color: group.color,
              id: group.id,
              title: group.title,
            }
          : null,
        index: tab.index,
        originalTabId: tab.id,
        pinned: tab.pinned,
        title: tab.title,
        url: tab.url,
        windowId: tab.windowId,
      });
    });
  });
  return tabIds.flatMap((tabId) => {
    const tab = tabsById.get(tabId);
    return tab ? [tab] : [];
  });
}
