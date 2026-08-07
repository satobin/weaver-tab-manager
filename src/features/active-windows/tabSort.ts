export type SortCriterion = 'title' | 'url';
export type SortDirection = 'asc' | 'desc';

export interface TabSortOptions {
  criterion: SortCriterion;
  direction: SortDirection;
  preserveGroups: boolean;
}

export interface SortableTab {
  agentAssociated: boolean;
  groupId: number | null;
  id: number;
  index: number;
  pinned: boolean;
  title: string;
  url: string;
}

function compareTabs(left: SortableTab, right: SortableTab, options: TabSortOptions): number {
  const leftValue = left[options.criterion].toLocaleLowerCase();
  const rightValue = right[options.criterion].toLocaleLowerCase();
  const comparison = leftValue.localeCompare(rightValue);

  if (comparison !== 0) {
    return options.direction === 'asc' ? comparison : -comparison;
  }

  return left.index - right.index;
}

function sortPartition(tabs: readonly SortableTab[], options: TabSortOptions): SortableTab[] {
  if (!options.preserveGroups) {
    return [...tabs].sort((left, right) => compareTabs(left, right, options));
  }

  const sorted: SortableTab[] = [];
  let chunk: SortableTab[] = [];

  tabs.forEach((tab) => {
    if (chunk.length > 0 && chunk[0]?.groupId !== tab.groupId) {
      sorted.push(...chunk.sort((left, right) => compareTabs(left, right, options)));
      chunk = [];
    }
    chunk.push(tab);
  });

  sorted.push(...chunk.sort((left, right) => compareTabs(left, right, options)));
  return sorted;
}

function sortAroundAssociationProtectedGroups(
  tabs: readonly SortableTab[],
  options: TabSortOptions,
): SortableTab[] {
  const sorted: SortableTab[] = [];
  const associationProtectedGroupIds = new Set(
    tabs.flatMap((tab) => (tab.agentAssociated && tab.groupId !== null ? [tab.groupId] : [])),
  );
  let partitionStart = 0;
  let index = 0;

  while (index < tabs.length) {
    const tab = tabs[index];
    if (!tab || tab.groupId === null || !associationProtectedGroupIds.has(tab.groupId)) {
      index += 1;
      continue;
    }

    sorted.push(...sortPartition(tabs.slice(partitionStart, index), options));

    const associationProtectedGroupId = tab.groupId;
    let groupEnd = index + 1;
    while (groupEnd < tabs.length && tabs[groupEnd]?.groupId === associationProtectedGroupId) {
      groupEnd += 1;
    }
    sorted.push(...tabs.slice(index, groupEnd));

    index = groupEnd;
    partitionStart = groupEnd;
  }

  sorted.push(...sortPartition(tabs.slice(partitionStart), options));
  return sorted;
}

export function planTabSort(tabs: readonly SortableTab[], options: TabSortOptions): SortableTab[] {
  const browserOrder = [...tabs].sort((left, right) => left.index - right.index);
  const pinned = browserOrder.filter((tab) => tab.pinned);
  const unpinned = browserOrder.filter((tab) => !tab.pinned);

  return [...pinned, ...sortAroundAssociationProtectedGroups(unpinned, options)];
}

export function isTabOrderSorted(tabs: readonly SortableTab[], options: TabSortOptions): boolean {
  const browserOrder = [...tabs].sort((left, right) => left.index - right.index);
  const plannedOrder = planTabSort(browserOrder, options);

  return browserOrder.every((tab, index) => tab.id === plannedOrder[index]?.id);
}
