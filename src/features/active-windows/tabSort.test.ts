import { describe, expect, it } from 'vitest';

import { isTabOrderSorted, planTabSort, type SortableTab, type TabSortOptions } from './tabSort';

function createTab(overrides: Partial<SortableTab> = {}): SortableTab {
  return {
    agentAssociated: false,
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

  it('keeps the pinned prefix untouched while sorting only unpinned tabs', () => {
    const tabs = [
      createTab({ id: 1, index: 0, pinned: true, title: 'Zulu' }),
      createTab({ id: 2, index: 1, pinned: true, title: 'Alpha' }),
      createTab({ id: 3, index: 2, title: 'Zulu unpinned' }),
      createTab({ id: 4, index: 3, title: 'Alpha unpinned' }),
    ];

    expect(
      planTabSort(tabs, { ...DEFAULT_OPTIONS, preserveGroups: false }).map((tab) => tab.id),
    ).toEqual([1, 2, 4, 3]);
  });

  it('keeps groups containing agent-associated tabs immutable while sorting around them', () => {
    const tabs = [
      createTab({ id: 1, index: 0, title: 'Zulu before' }),
      createTab({ id: 2, index: 1, title: 'Alpha before' }),
      createTab({ agentAssociated: true, groupId: 7, id: 3, index: 2, title: 'Zulu agent' }),
      createTab({ groupId: 7, id: 4, index: 3, title: 'Alpha agent' }),
      createTab({ id: 5, index: 4, title: 'Zulu after' }),
      createTab({ id: 6, index: 5, title: 'Alpha after' }),
    ];

    expect(
      planTabSort(tabs, { ...DEFAULT_OPTIONS, preserveGroups: false }).map((tab) => tab.id),
    ).toEqual([2, 1, 3, 4, 6, 5]);
    expect(planTabSort(tabs, DEFAULT_OPTIONS).map((tab) => tab.id)).toEqual([2, 1, 3, 4, 6, 5]);
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

describe('isTabOrderSorted', () => {
  it('recognizes a sorted unpinned suffix without requiring pinned tabs to be alphabetical', () => {
    const tabs = [
      createTab({ id: 1, index: 0, pinned: true, title: 'Zulu pinned' }),
      createTab({ id: 2, index: 1, pinned: true, title: 'Alpha pinned' }),
      createTab({ id: 3, index: 2, title: 'Alpha' }),
      createTab({ id: 4, index: 3, title: 'Zulu' }),
    ];

    expect(isTabOrderSorted(tabs, DEFAULT_OPTIONS)).toBe(true);
  });

  it('detects when sortable tabs no longer match the requested direction', () => {
    const tabs = [
      createTab({ id: 1, index: 0, title: 'Zulu' }),
      createTab({ id: 2, index: 1, title: 'Alpha' }),
    ];

    expect(isTabOrderSorted(tabs, DEFAULT_OPTIONS)).toBe(false);
    expect(isTabOrderSorted(tabs, { ...DEFAULT_OPTIONS, direction: 'desc' })).toBe(true);
  });

  it('checks order within preserved group segments instead of moving those segments', () => {
    const tabs = [
      createTab({ groupId: 7, id: 1, index: 0, title: 'Alpha' }),
      createTab({ groupId: 7, id: 2, index: 1, title: 'Zulu' }),
      createTab({ id: 3, index: 2, title: 'Alpha' }),
    ];

    expect(isTabOrderSorted(tabs, DEFAULT_OPTIONS)).toBe(true);
    expect(isTabOrderSorted(tabs, { ...DEFAULT_OPTIONS, preserveGroups: false })).toBe(false);
  });

  it('treats an unchanged association-protected group as sorted even when its members are not', () => {
    const tabs = [
      createTab({ id: 1, index: 0, title: 'Alpha before' }),
      createTab({ agentAssociated: true, groupId: 7, id: 2, index: 1, title: 'Zulu agent' }),
      createTab({ agentAssociated: true, groupId: 7, id: 3, index: 2, title: 'Alpha agent' }),
      createTab({ id: 4, index: 3, title: 'Zulu after' }),
    ];

    expect(isTabOrderSorted(tabs, DEFAULT_OPTIONS)).toBe(true);
    expect(isTabOrderSorted(tabs, { ...DEFAULT_OPTIONS, preserveGroups: false })).toBe(true);
  });

  it('uses browser indices rather than input array order and treats an empty window as sorted', () => {
    const tabs = [
      createTab({ id: 2, index: 1, title: 'Alpha' }),
      createTab({ id: 1, index: 0, title: 'Zulu' }),
    ];

    expect(isTabOrderSorted(tabs, DEFAULT_OPTIONS)).toBe(false);
    expect(isTabOrderSorted(tabs, { ...DEFAULT_OPTIONS, direction: 'desc' })).toBe(true);
    expect(isTabOrderSorted([], DEFAULT_OPTIONS)).toBe(true);
  });
});
