export type TabGroupColor =
  | 'blue'
  | 'cyan'
  | 'green'
  | 'grey'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'red'
  | 'yellow';

export interface ManagedTabGroup {
  collapsed: boolean;
  color: TabGroupColor;
  id: number;
  title: string;
  windowId: number;
}

export interface ManagedTab {
  active: boolean;
  discarded: boolean;
  frozen: boolean;
  groupId: number | null;
  iconUrl: string | null;
  id: number;
  index: number;
  pinned: boolean;
  title: string;
  unloaded: boolean;
  url: string;
  windowId: number;
}

export function isTabSuspended(
  tab: Pick<ManagedTab, 'discarded' | 'frozen' | 'unloaded'>,
): boolean {
  return tab.discarded || tab.frozen || tab.unloaded;
}

export interface ManagedWindow {
  focused: boolean;
  groups: ManagedTabGroup[];
  id: number;
  isCurrent: boolean;
  label: string;
  state: NonNullable<chrome.windows.Window['state']> | null;
  tabs: ManagedTab[];
}

export interface ActiveWindowsSnapshot {
  extensionOrigin: string;
  totalTabs: number;
  windows: ManagedWindow[];
}

export interface FilteredActiveWindows {
  matchingTabs: number;
  totalTabs: number;
  windows: ManagedWindow[];
}

export function isNewTabUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'about:') {
      return parsedUrl.pathname === 'newtab';
    }

    return (
      ['brave:', 'chrome:', 'edge:'].includes(parsedUrl.protocol) &&
      ['new-tab-page', 'newtab'].includes(parsedUrl.hostname)
    );
  } catch {
    return false;
  }
}

export function filterActiveWindows(
  snapshot: ActiveWindowsSnapshot,
  rawQuery: string,
): FilteredActiveWindows {
  const query = rawQuery.trim().toLocaleLowerCase();

  if (!query) {
    return {
      matchingTabs: snapshot.totalTabs,
      totalTabs: snapshot.totalTabs,
      windows: snapshot.windows,
    };
  }

  let matchingTabs = 0;
  const windows = snapshot.windows.flatMap((window) => {
    const tabs = window.tabs.filter(
      (tab) =>
        tab.title.toLocaleLowerCase().includes(query) ||
        tab.url.toLocaleLowerCase().includes(query),
    );

    if (tabs.length === 0) {
      return [];
    }

    matchingTabs += tabs.length;
    const visibleGroupIds = new Set(
      tabs.flatMap((tab) => (tab.groupId === null ? [] : [tab.groupId])),
    );
    return [
      {
        ...window,
        groups: window.groups.filter((group) => visibleGroupIds.has(group.id)),
        tabs,
      },
    ];
  });

  return { matchingTabs, totalTabs: snapshot.totalTabs, windows };
}

export function formatTabLocation(url: string, extensionOrigin = ''): string {
  if (!url) {
    return 'Address unavailable';
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'chrome-extension:') {
      return extensionOrigin && url.startsWith(extensionOrigin) ? 'Weaver' : 'Browser extension';
    }
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      const path = parsedUrl.pathname === '/' ? '' : parsedUrl.pathname;
      return `${parsedUrl.hostname}${path}`;
    }
  } catch {
    return url;
  }

  return url.replace(/\/$/, '');
}
