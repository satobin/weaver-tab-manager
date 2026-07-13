import { describe, expect, it } from 'vitest';

import { planTabSort, type SortableTab, type TabSortOptions } from './tabSort';

function createTab(overrides: Partial<SortableTab> = {}): SortableTab {
  return {
    groupId: null,
    id: 1,
    index: 0,
    pinned: false,
    title: 'Tab',
    url: 'https://example.test',
    ...overrides,
  };
}

const DEFAULT_OPTIONS: TabSortOptions = {
  criterion: 'title',
  direction: 'asc',
  preserveGroups: true,
};

describe('planTabSort', () => {
  it('sorts each contiguous group segment without moving the segments', () => {
    const tabs = [
      createTab({ groupId: 7, id: 1, index: 0, title: 'Zulu' }),
      createTab({ groupId: 7, id: 2, index: 1, title: 'Alpha' }),
      createTab({ id: 3, index: 2, title: 'Delta' }),
      createTab({ id: 4, index: 3, title: 'Beta' }),
      createTab({ groupId: 8, id: 5, index: 4, title: 'Charlie' }),
    ];

    expect(planTabSort(tabs, DEFAULT_OPTIONS).map((tab) => tab.id)).toEqual([2, 1, 4, 3, 5]);
  });

  it('sorts all tabs when group preservation is disabled', () => {
    const tabs = [
      createTab({ groupId: 7, id: 1, index: 0, title: 'Zulu' }),
      createTab({ id: 2, index: 1, title: 'Alpha' }),
      createTab({ groupId: 8, id: 3, index: 2, title: 'Delta' }),
    ];

    expect(
      planTabSort(tabs, { ...DEFAULT_OPTIONS, preserveGroups: false }).map((tab) => tab.id),
    ).toEqual([2, 3, 1]);
  });

  it('keeps pinned and unpinned tabs in separate leading and trailing partitions', () => {
    const tabs = [
      createTab({ id: 1, index: 0, pinned: true, title: 'Zulu' }),
      createTab({ id: 2, index: 1, pinned: true, title: 'Alpha' }),
      createTab({ id: 3, index: 2, title: 'Aardvark' }),
    ];

    expect(
      planTabSort(tabs, { ...DEFAULT_OPTIONS, preserveGroups: false }).map((tab) => tab.id),
    ).toEqual([2, 1, 3]);
  });

  it('supports URL sorting, descending order, and stable ties', () => {
    const tabs = [
      createTab({ id: 1, index: 0, title: 'First', url: 'https://b.test' }),
      createTab({ id: 2, index: 1, title: 'Second', url: 'https://a.test' }),
      createTab({ id: 3, index: 2, title: 'Third', url: 'https://b.test' }),
    ];

    expect(
      planTabSort(tabs, {
        criterion: 'url',
        direction: 'desc',
        preserveGroups: false,
      }).map((tab) => tab.id),
    ).toEqual([1, 3, 2]);
  });

  it('handles an empty window', () => {
    expect(planTabSort([], DEFAULT_OPTIONS)).toEqual([]);
  });
});
