import { describe, expect, it } from 'vitest';

import { createManagedTab, createManagedWindow } from '../../test/activeWindowsFixtures';
import {
  EMPTY_TAB_SELECTION,
  getValidSelectedIds,
  tabSelectionReducer,
  type TabSelectionState,
} from './selection';

function toggle(
  state: TabSelectionState,
  tabId: number,
  options: { checked?: boolean; extendRange?: boolean; orderedTabIds?: number[] } = {},
) {
  return tabSelectionReducer(state, {
    checked: options.checked ?? true,
    extendRange: options.extendRange ?? false,
    orderedTabIds: options.orderedTabIds ?? [1, 2, 3, 4, 5],
    tabId,
    type: 'toggle-tab',
    windowId: 10,
  });
}

describe('tabSelectionReducer', () => {
  it('toggles one tab and records a per-window range anchor', () => {
    const state = toggle(EMPTY_TAB_SELECTION, 2);
    expect([...state.selectedIds]).toEqual([2]);
    expect(state.anchorByWindow.get(10)).toBe(2);

    const cleared = toggle(state, 2, { checked: false });
    expect([...cleared.selectedIds]).toEqual([]);
  });

  it('selects and clears inclusive shift ranges in visible order', () => {
    const anchored = toggle(EMPTY_TAB_SELECTION, 1, { orderedTabIds: [1, 3, 5] });
    const extended = toggle(anchored, 5, {
      extendRange: true,
      orderedTabIds: [1, 3, 5],
    });
    expect([...extended.selectedIds]).toEqual([1, 3, 5]);

    const cleared = toggle(extended, 3, {
      checked: false,
      extendRange: true,
      orderedTabIds: [1, 3, 5],
    });
    expect([...cleared.selectedIds]).toEqual([1]);
  });

  it('adds and removes bulk tab sets without disturbing other selections', () => {
    const initial = toggle(EMPTY_TAB_SELECTION, 1);
    const selected = tabSelectionReducer(initial, {
      checked: true,
      tabIds: [3, 4],
      type: 'set-tabs',
    });
    expect([...selected.selectedIds]).toEqual([1, 3, 4]);

    const reduced = tabSelectionReducer(selected, {
      checked: false,
      tabIds: [3],
      type: 'set-tabs',
    });
    expect([...reduced.selectedIds]).toEqual([1, 4]);
  });

  it('clears selection and anchors together', () => {
    const selected = toggle(EMPTY_TAB_SELECTION, 2);
    expect(tabSelectionReducer(selected, { type: 'clear' })).toBe(EMPTY_TAB_SELECTION);
  });
});

describe('getValidSelectedIds', () => {
  it('drops tabs that disappeared from the latest browser snapshot', () => {
    const windows = [
      createManagedWindow({
        tabs: [createManagedTab({ id: 1 }), createManagedTab({ id: 3 })],
      }),
    ];
    expect([...getValidSelectedIds(new Set([1, 2, 3]), windows)]).toEqual([1, 3]);
  });
});
