import { describe, expect, it } from 'vitest';

import { createManagedTab, createManagedWindow } from '../../test/activeWindowsFixtures';
import {
  findClosestWindowDropPlacement,
  insertWindowBefore,
  orderAndLabelWindows,
  reconcileWindowOrder,
} from './windowDisplayOrder';

function createWindows() {
  return [
    createManagedWindow(),
    createManagedWindow({
      focused: false,
      id: 2,
      isCurrent: false,
      label: 'Window 2',
      tabs: [createManagedTab({ id: 201, windowId: 2 })],
    }),
    createManagedWindow({
      focused: false,
      id: 3,
      isCurrent: false,
      label: 'Window 3',
      tabs: [createManagedTab({ id: 301, windowId: 3 })],
    }),
  ];
}

describe('window display order', () => {
  it('keeps the current window first and regenerates secondary labels', () => {
    const windows = createWindows();

    expect(reconcileWindowOrder(windows, [3, 1, 2])).toEqual([1, 3, 2]);
    expect(
      orderAndLabelWindows(windows, [3, 1, 2]).map((window) => [window.id, window.label]),
    ).toEqual([
      [1, 'Window 1'],
      [3, 'Window 2'],
      [2, 'Window 3'],
    ]);
  });

  it('inserts a new window before the chosen neighbor without displacing current', () => {
    expect(insertWindowBefore([1, 2, 3], 9, 3, 1)).toEqual([1, 2, 9, 3]);
    expect(insertWindowBefore([1, 2, 3], 9, 1, 1)).toEqual([1, 9, 2, 3]);
  });

  it('chooses the nearest card and the pointer-facing insertion side', () => {
    const cards = [
      { bottom: 180, id: 2, left: 0, right: 400, top: 100 },
      { bottom: 340, id: 3, left: 0, right: 400, top: 260 },
    ];

    expect(findClosestWindowDropPlacement(cards, { x: 100, y: 220 })).toEqual({
      anchorWindowId: 2,
      placement: 'after',
    });
    expect(findClosestWindowDropPlacement(cards, { x: 100, y: 300 })).toEqual({
      anchorWindowId: 3,
      placement: 'after',
    });
  });
});
