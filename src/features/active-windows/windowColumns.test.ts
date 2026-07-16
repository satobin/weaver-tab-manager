import { describe, expect, it } from 'vitest';

import { createManagedTab, createManagedWindow } from '../../test/activeWindowsFixtures';
import {
  distributeAcrossWindowColumns,
  estimateWindowCardHeight,
  getWindowColumnCount,
} from './windowColumns';

describe('window columns', () => {
  it('derives responsive columns from the same minimum width as the card grid', () => {
    expect(getWindowColumnCount(459, 4)).toBe(1);
    expect(getWindowColumnCount(936, 4)).toBe(2);
    expect(getWindowColumnCount(1412, 4)).toBe(3);
    expect(getWindowColumnCount(5000, 2)).toBe(2);
  });

  it('stacks row peers into independent columns without changing their column order', () => {
    expect(distributeAcrossWindowColumns(['current', 'one', 'two', 'three'], 2)).toEqual([
      ['current', 'two'],
      ['one', 'three'],
    ]);
  });

  it('places later cards into the shortest estimated column', () => {
    const items = [
      { height: 1000, id: 1 },
      { height: 100, id: 2 },
      { height: 200, id: 3 },
      { height: 100, id: 4 },
      { height: 100, id: 5 },
      { height: 100, id: 6 },
    ];

    expect(
      distributeAcrossWindowColumns(items, 3, (item) => item.height).map((column) =>
        column.map((item) => item.id),
      ),
    ).toEqual([[1], [2, 4, 6], [3, 5]]);
  });

  it('estimates card height from visible tab rows and group headings', () => {
    const window = createManagedWindow({
      groups: [{ collapsed: false, color: 'pink', id: 7, title: 'Planning', windowId: 1 }],
      tabs: [
        createManagedTab({ groupId: 7 }),
        createManagedTab({ groupId: 7, id: 102, index: 1 }),
        createManagedTab({ id: 103, index: 2 }),
      ],
    });

    expect(estimateWindowCardHeight(window, true)).toBe(223);
    expect(estimateWindowCardHeight(window, false)).toBe(193);
    expect(estimateWindowCardHeight(window, true, true)).toBe(88);
  });
});
