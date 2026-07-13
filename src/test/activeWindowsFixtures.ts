import {
  type ActiveWindowsSnapshot,
  type ManagedTab,
  type ManagedWindow,
} from '../features/active-windows/model';
import { formatWindowLabel } from '../features/active-windows/windowLabel';

export function createManagedTab(overrides: Partial<ManagedTab> = {}): ManagedTab {
  return {
    active: false,
    discarded: false,
    groupId: null,
    iconUrl: null,
    id: 101,
    index: 0,
    pinned: false,
    title: 'Example tab',
    url: 'https://example.com/path',
    windowId: 1,
    ...overrides,
  };
}

export function createManagedWindow(overrides: Partial<ManagedWindow> = {}): ManagedWindow {
  return {
    focused: true,
    groups: [],
    id: 1,
    isCurrent: true,
    label: formatWindowLabel(1),
    state: 'normal',
    tabs: [createManagedTab()],
    ...overrides,
  };
}

export function createActiveWindowsSnapshot(
  overrides: Partial<ActiveWindowsSnapshot> = {},
): ActiveWindowsSnapshot {
  const windows = overrides.windows ?? [createManagedWindow()];
  return {
    extensionOrigin: 'chrome-extension://weaver/',
    totalTabs: windows.reduce((total, window) => total + window.tabs.length, 0),
    ...overrides,
    windows,
  };
}
