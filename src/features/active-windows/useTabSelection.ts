import { useCallback, useEffect, useMemo, useReducer } from 'react';

import { type ManagedWindow } from './model';
import {
  EMPTY_TAB_SELECTION,
  getValidSelectedIds,
  tabSelectionReducer,
  type ToggleTabSelection,
} from './selection';

export interface TabSelectionController {
  clear: () => void;
  selectedCount: number;
  selectedIds: ReadonlySet<number>;
  setTabs: (tabIds: readonly number[], checked: boolean) => void;
  toggleTab: (selection: ToggleTabSelection) => void;
}

export function useTabSelection(windows: readonly ManagedWindow[]): TabSelectionController {
  const [state, dispatch] = useReducer(tabSelectionReducer, EMPTY_TAB_SELECTION);
  const selectedIds = useMemo(
    () => getValidSelectedIds(state.selectedIds, windows),
    [state.selectedIds, windows],
  );

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const setTabs = useCallback(
    (tabIds: readonly number[], checked: boolean) =>
      dispatch({ checked, tabIds, type: 'set-tabs' }),
    [],
  );
  const toggleTab = useCallback(
    (selection: ToggleTabSelection) => dispatch({ ...selection, type: 'toggle-tab' }),
    [],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dispatch({ type: 'clear' });
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return {
    clear,
    selectedCount: selectedIds.size,
    selectedIds,
    setTabs,
    toggleTab,
  };
}
