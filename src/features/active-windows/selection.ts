import { type ManagedWindow } from './model';

export interface TabSelectionState {
  anchorByWindow: ReadonlyMap<number, number>;
  selectedIds: ReadonlySet<number>;
}

export interface ToggleTabSelection {
  checked: boolean;
  extendRange: boolean;
  orderedTabIds: readonly number[];
  tabId: number;
  windowId: number;
}

export type TabSelectionAction =
  | { type: 'clear' }
  | { checked: boolean; tabIds: readonly number[]; type: 'set-tabs' }
  | ({ type: 'toggle-tab' } & ToggleTabSelection);

export const EMPTY_TAB_SELECTION: TabSelectionState = {
  anchorByWindow: new Map(),
  selectedIds: new Set(),
};

function setSelection(
  selectedIds: ReadonlySet<number>,
  tabIds: readonly number[],
  checked: boolean,
): Set<number> {
  const next = new Set(selectedIds);
  tabIds.forEach((tabId) => {
    if (checked) {
      next.add(tabId);
    } else {
      next.delete(tabId);
    }
  });
  return next;
}

export function tabSelectionReducer(
  state: TabSelectionState,
  action: TabSelectionAction,
): TabSelectionState {
  switch (action.type) {
    case 'clear':
      return state.selectedIds.size === 0 && state.anchorByWindow.size === 0
        ? state
        : EMPTY_TAB_SELECTION;
    case 'set-tabs':
      return {
        ...state,
        selectedIds: setSelection(state.selectedIds, action.tabIds, action.checked),
      };
    case 'toggle-tab': {
      const anchorId = state.anchorByWindow.get(action.windowId);
      const anchorIndex = anchorId === undefined ? -1 : action.orderedTabIds.indexOf(anchorId);
      const tabIndex = action.orderedTabIds.indexOf(action.tabId);
      const affectedIds =
        action.extendRange && anchorIndex >= 0 && tabIndex >= 0
          ? action.orderedTabIds.slice(
              Math.min(anchorIndex, tabIndex),
              Math.max(anchorIndex, tabIndex) + 1,
            )
          : [action.tabId];
      const anchorByWindow = new Map(state.anchorByWindow);
      anchorByWindow.set(action.windowId, action.tabId);
      return {
        anchorByWindow,
        selectedIds: setSelection(state.selectedIds, affectedIds, action.checked),
      };
    }
  }
}

export function getValidSelectedIds(
  selectedIds: ReadonlySet<number>,
  windows: readonly ManagedWindow[],
): ReadonlySet<number> {
  const validIds = new Set(windows.flatMap((window) => window.tabs.map((tab) => tab.id)));
  return new Set([...selectedIds].filter((tabId) => validIds.has(tabId)));
}
