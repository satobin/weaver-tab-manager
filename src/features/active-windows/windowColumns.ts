import { type ManagedWindow } from './model';

const DEFAULT_COLUMN_GAP = 16;
const DEFAULT_MIN_COLUMN_WIDTH = 460;
const WINDOW_CARD_HEADER_HEIGHT = 55;
const GROUP_HEADER_HEIGHT = 30;
const TAB_ROW_HEIGHT = 46;
const COMPACT_TAB_ROW_HEIGHT = 36;

export function getWindowColumnCount(
  containerWidth: number,
  itemCount: number,
  minColumnWidth = DEFAULT_MIN_COLUMN_WIDTH,
  gap = DEFAULT_COLUMN_GAP,
): number {
  if (itemCount <= 0) {
    return 1;
  }
  const availableColumns = Math.max(1, Math.floor((containerWidth + gap) / (minColumnWidth + gap)));
  return Math.min(itemCount, availableColumns);
}

export function distributeAcrossWindowColumns<T>(
  items: readonly T[],
  requestedColumnCount: number,
  getItemHeight: (item: T) => number = () => 1,
): T[][] {
  if (items.length === 0) {
    return [];
  }
  const columnCount = Math.max(1, Math.min(items.length, Math.floor(requestedColumnCount)));
  const columns = Array.from({ length: columnCount }, () => [] as T[]);
  const columnHeights = Array.from({ length: columnCount }, () => 0);

  items.forEach((item) => {
    let targetColumn = 0;
    for (let index = 1; index < columnCount; index += 1) {
      if ((columnHeights[index] ?? 0) < (columnHeights[targetColumn] ?? 0)) {
        targetColumn = index;
      }
    }
    const column = columns[targetColumn];
    if (!column) {
      return;
    }
    const gap = column.length > 0 ? DEFAULT_COLUMN_GAP : 0;
    column.push(item);
    columnHeights[targetColumn] =
      (columnHeights[targetColumn] ?? 0) + gap + Math.max(0, getItemHeight(item));
  });
  return columns;
}

export function estimateWindowCardHeight(
  window: ManagedWindow,
  showTabUrls: boolean,
  collapsed = false,
): number {
  if (collapsed) {
    return 88;
  }
  const groupHeaderCount = window.tabs.reduce(
    (count, tab, index) =>
      tab.groupId !== null && window.tabs[index - 1]?.groupId !== tab.groupId ? count + 1 : count,
    0,
  );
  const tabRowsHeight =
    window.tabs.length * (showTabUrls ? TAB_ROW_HEIGHT : COMPACT_TAB_ROW_HEIGHT);
  return Math.max(
    88,
    WINDOW_CARD_HEADER_HEIGHT + tabRowsHeight + groupHeaderCount * GROUP_HEADER_HEIGHT,
  );
}
