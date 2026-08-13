import { describe, expect, it } from 'vitest';

import { DEFAULT_DEDUPLICATION_RULES, type DedupeRule } from '../deduplication/deduplication';
import { parseSavedWindow, type SavedWindow } from './savedWindowModel';
import {
  deduplicateSavedWindows,
  isSavedWindowTabOrderSorted,
  mergeSavedWindows,
  moveSelectedSavedTabsToNewWindow,
  planSavedWindowDeduplication,
  removeSelectedSavedTabs,
  sortSavedWindows,
  type SavedTabSelectionReference,
} from './savedWindowOperations';

function createSavedWindow(overrides: Partial<SavedWindow> = {}): SavedWindow {
  return {
    createdAt: '2026-08-10T10:00:00.000Z',
    groups: [],
    id: 'saved-1',
    name: 'Research',
    tabs: [
      {
        active: true,
        order: 0,
        pinned: false,
        title: 'Plan',
        url: 'https://example.com/plan',
      },
    ],
    updatedAt: '2026-08-10T10:00:00.000Z',
    ...overrides,
  };
}

function selectTab(savedWindow: SavedWindow, tabOrder: number): SavedTabSelectionReference {
  const tab = savedWindow.tabs[tabOrder];
  if (!tab) {
    throw new Error('Missing fixture tab');
  }
  return {
    expectedTab: { ...tab },
    expectedWindowUpdatedAt: savedWindow.updatedAt,
    tabOrder,
    windowId: savedWindow.id,
  };
}

function createSortableSavedWindow(id = 'sortable'): SavedWindow {
  return createSavedWindow({
    createdAt: '2026-08-09T10:00:00.000Z',
    groups: [{ collapsed: true, color: 'purple', key: 'group-1', title: 'Planning' }],
    id,
    name: 'Sortable research',
    tabs: [
      {
        active: false,
        order: 0,
        pinned: true,
        savedAt: '2026-08-09T10:01:00.000Z',
        title: 'Zulu pinned',
        url: 'https://zulu-pinned.example.com/',
      },
      {
        active: false,
        order: 1,
        pinned: true,
        savedAt: '2026-08-09T10:02:00.000Z',
        title: 'Alpha pinned',
        url: 'https://alpha-pinned.example.com/',
      },
      {
        active: true,
        groupKey: 'group-1',
        order: 2,
        pinned: false,
        savedAt: '2026-08-09T10:03:00.000Z',
        title: 'Zulu grouped',
        url: 'https://a-grouped.example.com/',
      },
      {
        active: false,
        groupKey: 'group-1',
        order: 3,
        pinned: false,
        savedAt: '2026-08-09T10:04:00.000Z',
        title: 'Alpha grouped',
        url: 'https://z-grouped.example.com/',
      },
      {
        active: false,
        order: 4,
        pinned: false,
        savedAt: '2026-08-09T10:05:00.000Z',
        title: 'Zulu loose',
        url: 'https://b-loose.example.com/',
      },
      {
        active: false,
        order: 5,
        pinned: false,
        savedAt: '2026-08-09T10:06:00.000Z',
        title: 'Alpha loose',
        url: 'https://c-loose.example.com/',
      },
    ],
    updatedAt: '2026-08-09T10:00:00.000Z',
  });
}

describe('saved-window sorting', () => {
  it('sorts titles within group and loose runs while keeping the pinned prefix unchanged', () => {
    const savedWindow = createSortableSavedWindow();
    const original = structuredClone(savedWindow);

    const transformed = sortSavedWindows(
      [savedWindow],
      [savedWindow.id],
      { criterion: 'title', direction: 'asc' },
      '2026-08-12T10:00:00.000Z',
    );

    expect(transformed.result.sortedWindowIds).toEqual([savedWindow.id]);
    expect(transformed.windows[0]?.tabs.map((tab) => tab.title)).toEqual([
      'Zulu pinned',
      'Alpha pinned',
      'Alpha grouped',
      'Zulu grouped',
      'Alpha loose',
      'Zulu loose',
    ]);
    expect(transformed.windows[0]).toMatchObject({
      createdAt: savedWindow.createdAt,
      groups: savedWindow.groups,
      id: savedWindow.id,
      name: savedWindow.name,
      updatedAt: '2026-08-12T10:00:00.000Z',
    });
    expect(
      transformed.windows[0]?.tabs.map(({ active, groupKey, pinned, savedAt, title }) => ({
        active,
        groupKey,
        pinned,
        savedAt,
        title,
      })),
    ).toEqual(
      [
        original.tabs[0]!,
        original.tabs[1]!,
        original.tabs[3]!,
        original.tabs[2]!,
        original.tabs[5]!,
        original.tabs[4]!,
      ].map(({ active, groupKey, pinned, savedAt, title }) => ({
        active,
        groupKey,
        pinned,
        savedAt,
        title,
      })),
    );
    expect(parseSavedWindow(transformed.windows[0])).not.toBeNull();
    expect(savedWindow).toEqual(original);
    expect(
      isSavedWindowTabOrderSorted(transformed.windows[0]!, {
        criterion: 'title',
        direction: 'asc',
      }),
    ).toBe(true);
  });

  it('supports descending title and both URL directions with stable ties', () => {
    const savedWindow = createSavedWindow({
      id: 'directions',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Alpha',
          url: 'https://b.example.com/',
        },
        {
          active: false,
          order: 1,
          pinned: false,
          title: 'Zulu',
          url: 'https://a.example.com/',
        },
        {
          active: false,
          order: 2,
          pinned: false,
          title: 'Middle',
          url: 'https://b.example.com/',
        },
      ],
    });

    expect(
      sortSavedWindows(
        [savedWindow],
        null,
        { criterion: 'title', direction: 'desc' },
        '2026-08-12T10:00:00.000Z',
      ).windows[0]?.tabs.map((tab) => tab.title),
    ).toEqual(['Zulu', 'Middle', 'Alpha']);
    expect(
      sortSavedWindows(
        [savedWindow],
        null,
        { criterion: 'url', direction: 'asc' },
        '2026-08-12T10:00:00.000Z',
      ).windows[0]?.tabs.map((tab) => tab.title),
    ).toEqual(['Zulu', 'Alpha', 'Middle']);
    expect(
      sortSavedWindows(
        [savedWindow],
        null,
        { criterion: 'url', direction: 'desc' },
        '2026-08-12T10:00:00.000Z',
      ).windows[0]?.tabs.map((tab) => tab.title),
    ).toEqual(['Alpha', 'Middle', 'Zulu']);
  });

  it('sorts only requested windows or every window and advances changed revisions monotonically', () => {
    const operationTimestamp = '2026-08-12T10:00:00.000Z';
    const first = createSortableSavedWindow('first');
    const second = createSortableSavedWindow('second');
    second.updatedAt = operationTimestamp;

    const oneWindow = sortSavedWindows(
      [first, second],
      ['second'],
      { criterion: 'title', direction: 'asc' },
      operationTimestamp,
    );
    expect(oneWindow.result.sortedWindowIds).toEqual(['second']);
    expect(oneWindow.windows[0]).toEqual(first);
    expect(oneWindow.windows[1]?.updatedAt).toBe('2026-08-12T10:00:00.001Z');

    const allWindows = sortSavedWindows(
      [first, second],
      null,
      { criterion: 'title', direction: 'asc' },
      operationTimestamp,
    );
    expect(allWindows.result.sortedWindowIds).toEqual(['first', 'second']);
  });

  it('reports an already sorted target without changing it and rejects stale IDs or invalid options', () => {
    const savedWindow = createSavedWindow({
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Alpha',
          url: 'https://a.example.com/',
        },
        {
          active: false,
          order: 1,
          pinned: false,
          title: 'Zulu',
          url: 'https://z.example.com/',
        },
      ],
    });

    const unchanged = sortSavedWindows(
      [savedWindow],
      [savedWindow.id],
      { criterion: 'title', direction: 'asc' },
      '2026-08-12T10:00:00.000Z',
    );
    expect(unchanged).toEqual({ result: { sortedWindowIds: [] }, windows: [savedWindow] });
    expect(isSavedWindowTabOrderSorted(savedWindow, { criterion: 'title', direction: 'asc' })).toBe(
      true,
    );
    expect(() =>
      sortSavedWindows(
        [savedWindow],
        ['missing'],
        { criterion: 'title', direction: 'asc' },
        '2026-08-12T10:00:00.000Z',
      ),
    ).toThrow('A selected saved window no longer exists.');
    expect(() =>
      sortSavedWindows(
        [savedWindow],
        [savedWindow.id],
        { criterion: 'hostname', direction: 'asc' } as never,
        '2026-08-12T10:00:00.000Z',
      ),
    ).toThrow('Choose a valid saved-tab sort order.');
  });

  it('treats a pinned-only window as sorted without alphabetizing the pinned tabs', () => {
    const pinnedOnly = createSavedWindow({
      tabs: [
        {
          active: true,
          order: 0,
          pinned: true,
          title: 'Zulu pinned',
          url: 'https://z.example.com/',
        },
        {
          active: false,
          order: 1,
          pinned: true,
          title: 'Alpha pinned',
          url: 'https://a.example.com/',
        },
      ],
    });

    expect(isSavedWindowTabOrderSorted(pinnedOnly, { criterion: 'title', direction: 'asc' })).toBe(
      true,
    );
    expect(
      sortSavedWindows(
        [pinnedOnly],
        null,
        { criterion: 'url', direction: 'asc' },
        '2026-08-12T10:00:00.000Z',
      ),
    ).toEqual({ result: { sortedWindowIds: [] }, windows: [pinnedOnly] });
  });
});

describe('saved-tab selection operations', () => {
  it('removes selected tabs atomically, repairs sources, and removes empty windows', () => {
    const first = createSavedWindow({
      groups: [{ collapsed: false, color: 'blue', key: 'group-1', title: 'Planning' }],
      id: 'first',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Remove active',
          url: 'https://example.com/remove',
        },
        {
          active: false,
          groupKey: 'group-1',
          order: 1,
          pinned: false,
          title: 'Keep grouped',
          url: 'https://example.com/keep',
        },
      ],
    });
    const second = createSavedWindow({ id: 'second', name: 'Delete entirely' });

    const transformed = removeSelectedSavedTabs(
      [first, second],
      [selectTab(second, 0), selectTab(first, 0), selectTab(first, 0)],
      '2026-08-12T10:00:00.000Z',
    );

    expect(transformed.result).toEqual({
      removedTabCount: 2,
      removedWindowIds: ['second'],
    });
    expect(transformed.windows).toHaveLength(1);
    expect(transformed.windows[0]?.tabs).toMatchObject([
      { active: true, order: 0, title: 'Keep grouped' },
    ]);
    expect(parseSavedWindow(transformed.windows[0])).not.toBeNull();
    expect(first.tabs).toHaveLength(2);
  });

  it('moves selected tabs into a new named snapshot with pins, groups, and provenance intact', () => {
    const first = createSavedWindow({
      createdAt: '2026-08-09T10:00:00.000Z',
      groups: [{ collapsed: false, color: 'blue', key: 'group-1', title: 'First group' }],
      id: 'first',
      tabs: [
        {
          active: false,
          order: 0,
          pinned: true,
          title: 'Pinned',
          url: 'https://example.com/pinned',
        },
        {
          active: true,
          groupKey: 'group-1',
          order: 1,
          pinned: false,
          title: 'Move active',
          url: 'https://example.com/active',
        },
        {
          active: false,
          groupKey: 'group-1',
          order: 2,
          pinned: false,
          title: 'Keep in source',
          url: 'https://example.com/source',
        },
      ],
      updatedAt: '2026-08-09T10:00:00.000Z',
    });
    const second = createSavedWindow({
      groups: [{ collapsed: true, color: 'purple', key: 'group-1', title: 'Second group' }],
      id: 'second',
      tabs: [
        {
          active: true,
          groupKey: 'group-1',
          order: 0,
          pinned: false,
          title: 'Second active',
          url: 'https://example.com/second',
        },
      ],
    });

    const transformed = moveSelectedSavedTabsToNewWindow(
      [first, second],
      [selectTab(second, 0), selectTab(first, 1), selectTab(first, 0)],
      '  Follow-up  ',
      'new-window',
      '2026-08-12T10:00:00.000Z',
    );

    expect(transformed.result).toMatchObject({
      movedTabCount: 3,
      removedSourceWindowIds: ['second'],
    });
    expect(transformed.result.createdWindow).toMatchObject({
      id: 'new-window',
      name: 'Follow-up',
    });
    expect(transformed.result.createdWindow.tabs).toMatchObject([
      { active: false, order: 0, pinned: true, savedAt: first.createdAt, title: 'Pinned' },
      { active: true, groupKey: 'group-1', order: 1, title: 'Move active' },
      { active: false, groupKey: 'group-1-2', order: 2, title: 'Second active' },
    ]);
    expect(transformed.result.createdWindow.groups.map((group) => group.key)).toEqual([
      'group-1',
      'group-1-2',
    ]);
    expect(transformed.windows.map((window) => window.id)).toEqual(['new-window', 'first']);
    expect(transformed.windows.every((window) => parseSavedWindow(window) !== null)).toBe(true);
    expect(transformed.windows[1]?.tabs).toMatchObject([
      { active: true, groupKey: 'group-1', order: 0, title: 'Keep in source' },
    ]);
  });

  it('rejects a stale revision or tab fingerprint before changing any source window', () => {
    const savedWindow = createSavedWindow();
    const staleRevision = {
      ...selectTab(savedWindow, 0),
      expectedWindowUpdatedAt: '2026-08-11T00:00:00.000Z',
    };
    const staleTab = {
      ...selectTab(savedWindow, 0),
      expectedTab: { ...savedWindow.tabs[0]!, url: 'https://changed.example.com/' },
    };

    expect(() =>
      removeSelectedSavedTabs([savedWindow], [staleRevision], '2026-08-12T10:00:00.000Z'),
    ).toThrow('selected saved tabs changed');
    expect(() =>
      moveSelectedSavedTabsToNewWindow(
        [savedWindow],
        [staleTab],
        'Moved',
        'new-window',
        '2026-08-12T10:00:00.000Z',
      ),
    ).toThrow('selected saved tabs changed');
    expect(savedWindow.tabs[0]?.url).toBe('https://example.com/plan');
  });

  it('advances a source revision when the operation happens in the same millisecond', () => {
    const operationTimestamp = '2026-08-12T10:00:00.000Z';
    const savedWindow = createSavedWindow({
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Remove',
          url: 'https://example.com/remove',
        },
        {
          active: false,
          order: 1,
          pinned: false,
          title: 'Keep',
          url: 'https://example.com/keep',
        },
      ],
      updatedAt: operationTimestamp,
    });

    const transformed = removeSelectedSavedTabs(
      [savedWindow],
      [selectTab(savedWindow, 0)],
      operationTimestamp,
    );

    expect(transformed.windows[0]?.updatedAt).toBe('2026-08-12T10:00:00.001Z');
  });
});

describe('saved-window duplicate cleanup', () => {
  it('finds byte-identical URLs without advanced matching', () => {
    const exactUrl = 'https://app.notion.com/p/acme/Project-Plan-00000000000000000000000000000000';
    const savedWindow = createSavedWindow({
      tabs: [
        { active: false, order: 0, pinned: false, title: 'First copy', url: exactUrl },
        { active: true, order: 1, pinned: false, title: 'Active copy', url: exactUrl },
        { active: false, order: 2, pinned: false, title: 'Third copy', url: exactUrl },
      ],
    });

    expect(planSavedWindowDeduplication([savedWindow], [])).toMatchObject({
      duplicateGroupCount: 1,
      duplicateTabCount: 2,
    });
  });

  it('finds app.notion.com query and page-section variants with the Notion preset', () => {
    const pageUrl = 'https://app.notion.com/p/acme/Project-Plan-00000000000000000000000000000000';
    const savedWindow = createSavedWindow({
      tabs: [
        { active: false, order: 0, pinned: false, title: 'Base page', url: pageUrl },
        {
          active: true,
          order: 1,
          pinned: false,
          title: 'Move view',
          url: `${pageUrl}?showMoveTo=true#block-one`,
        },
        {
          active: false,
          order: 2,
          pinned: false,
          title: 'Parent view',
          url: `${pageUrl}?saveParent=true#block-two`,
        },
      ],
    });
    const notionRules = DEFAULT_DEDUPLICATION_RULES.filter((rule) =>
      rule.id.startsWith('builtin-notion-'),
    ).map((rule) => ({ ...rule, enabled: true }));

    expect(planSavedWindowDeduplication([savedWindow], notionRules)).toMatchObject({
      duplicateGroupCount: 1,
      duplicateTabCount: 2,
    });
    expect(
      deduplicateSavedWindows([savedWindow], notionRules, '2026-08-12T10:00:00.000Z').windows[0]
        ?.tabs,
    ).toHaveLength(1);
  });

  it('keeps the newest saved occurrence even when the older window is listed first', () => {
    const older = createSavedWindow({
      createdAt: '2026-08-09T10:00:00.000Z',
      id: 'older',
      name: 'Older',
      updatedAt: '2026-08-09T10:00:00.000Z',
    });
    const newer = createSavedWindow({
      createdAt: '2026-08-11T10:00:00.000Z',
      id: 'newer',
      name: 'Newer',
      updatedAt: '2026-08-11T10:00:00.000Z',
    });

    expect(planSavedWindowDeduplication([older, newer], [])).toEqual({
      duplicateGroups: [
        {
          keepTab: { tabOrder: 0, windowId: 'newer' },
          removeTabs: [{ tabOrder: 0, windowId: 'older' }],
        },
      ],
      duplicateGroupCount: 1,
      duplicateTabCount: 1,
    });
    const transformed = deduplicateSavedWindows([older, newer], [], '2026-08-12T10:00:00.000Z');

    expect(transformed.result).toEqual({
      duplicateGroupCount: 1,
      removedTabCount: 1,
      removedWindowIds: ['older'],
      updatedWindowIds: [],
    });
    expect(transformed.windows.map((window) => window.id)).toEqual(['newer']);
  });

  it('prefers the active tab for same-snapshot ties and preserves its group', () => {
    const savedWindow = createSavedWindow({
      groups: [
        {
          collapsed: false,
          color: 'blue',
          key: 'group-1',
          title: 'Duplicate only',
        },
      ],
      tabs: [
        {
          active: false,
          order: 0,
          pinned: false,
          title: 'First copy',
          url: 'https://example.com/plan',
        },
        {
          active: true,
          groupKey: 'group-1',
          order: 1,
          pinned: false,
          title: 'Second copy',
          url: 'https://example.com/plan',
        },
      ],
    });

    const transformed = deduplicateSavedWindows([savedWindow], [], '2026-08-12T10:00:00.000Z');

    expect(transformed.windows[0]?.tabs).toMatchObject([
      { active: true, order: 0, title: 'Second copy' },
    ]);
    expect(transformed.windows[0]?.groups).toEqual(savedWindow.groups);
    expect(parseSavedWindow(transformed.windows[0])).not.toBeNull();
  });

  it('preserves a pinned tab before active state when same-snapshot copies tie', () => {
    const savedWindow = createSavedWindow({
      tabs: [
        {
          active: false,
          order: 0,
          pinned: true,
          title: 'Pinned copy',
          url: 'https://example.com/plan',
        },
        {
          active: true,
          order: 1,
          pinned: false,
          title: 'Active copy',
          url: 'https://example.com/plan',
        },
      ],
    });

    const transformed = deduplicateSavedWindows([savedWindow], [], '2026-08-12T10:00:00.000Z');

    expect(transformed.windows[0]?.tabs).toMatchObject([
      { active: true, order: 0, pinned: true, title: 'Pinned copy' },
    ]);
  });

  it('uses custom rules and ignores pin state when choosing the newer saved copy', () => {
    const rule: DedupeRule = {
      comparisonMode: 'path-prefix',
      enabled: true,
      glob: 'workspace.example.com/*',
      id: 'first-section',
      pathSegmentCount: 1,
    };
    const olderPinned = createSavedWindow({
      createdAt: '2026-08-09T10:00:00.000Z',
      id: 'older',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: true,
          title: 'Pinned old view',
          url: 'https://workspace.example.com/projects/old',
        },
      ],
      updatedAt: '2026-08-09T10:00:00.000Z',
    });
    const newer = createSavedWindow({
      createdAt: '2026-08-11T10:00:00.000Z',
      id: 'newer',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'New view',
          url: 'https://workspace.example.com/projects/new',
        },
      ],
      updatedAt: '2026-08-11T10:00:00.000Z',
    });

    const transformed = deduplicateSavedWindows(
      [olderPinned, newer],
      [rule],
      '2026-08-12T10:00:00.000Z',
    );

    expect(transformed.windows).toHaveLength(1);
    expect(transformed.windows[0]).toMatchObject({ id: 'newer' });
  });
});

describe('saved-window merge', () => {
  it('uses the requested name, resolves group keys, and places pinned tabs first', () => {
    const destination = createSavedWindow({
      groups: [
        {
          collapsed: false,
          color: 'blue',
          key: 'group-1',
          title: 'Destination group',
        },
      ],
      id: 'destination',
      name: 'Keeps this name',
      tabs: [
        {
          active: true,
          groupKey: 'group-1',
          order: 0,
          pinned: false,
          title: 'Destination tab',
          url: 'https://example.com/destination',
        },
      ],
    });
    const source = createSavedWindow({
      createdAt: '2026-08-11T10:00:00.000Z',
      groups: [
        {
          collapsed: true,
          color: 'purple',
          key: 'group-1',
          title: 'Source group',
        },
      ],
      id: 'source',
      name: 'Removed source',
      tabs: [
        {
          active: false,
          order: 0,
          pinned: true,
          title: 'Source pinned',
          url: 'https://example.com/pinned',
        },
        {
          active: true,
          groupKey: 'group-1',
          order: 1,
          pinned: false,
          title: 'Source grouped',
          url: 'https://example.com/source',
        },
      ],
      updatedAt: '2026-08-11T10:00:00.000Z',
    });

    const transformed = mergeSavedWindows(
      [destination, source],
      ['destination', 'source'],
      '  Combined research  ',
      '2026-08-12T10:00:00.000Z',
    );
    const merged = transformed.result.destinationWindow;

    expect(merged).toMatchObject({ id: 'destination', name: 'Combined research' });
    expect(merged.tabs.map((tab) => [tab.title, tab.pinned, tab.active])).toEqual([
      ['Source pinned', true, false],
      ['Destination tab', false, true],
      ['Source grouped', false, false],
    ]);
    expect(merged.groups.map((group) => group.key)).toEqual(['group-1', 'group-1-2']);
    expect(merged.tabs[2]?.groupKey).toBe('group-1-2');
    expect(transformed.windows).toHaveLength(1);
    expect(parseSavedWindow(merged)).not.toBeNull();
  });

  it('preserves per-tab save age so a later cleanup keeps the newer merged occurrence', () => {
    const destination = createSavedWindow({
      createdAt: '2026-08-09T10:00:00.000Z',
      id: 'destination',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'Old copy',
          url: 'https://example.com/plan',
        },
      ],
      updatedAt: '2026-08-09T10:00:00.000Z',
    });
    const source = createSavedWindow({
      createdAt: '2026-08-11T10:00:00.000Z',
      id: 'source',
      tabs: [
        {
          active: true,
          order: 0,
          pinned: false,
          title: 'New copy',
          url: 'https://example.com/plan',
        },
      ],
      updatedAt: '2026-08-11T10:00:00.000Z',
    });

    const merged = mergeSavedWindows(
      [destination, source],
      ['destination', 'source'],
      'Merged research',
      '2026-08-12T10:00:00.000Z',
    ).windows;
    const deduplicated = deduplicateSavedWindows(merged, [], '2026-08-12T11:00:00.000Z');

    expect(deduplicated.windows[0]?.tabs).toMatchObject([{ title: 'New copy' }]);
  });

  it('rejects a stale selection without changing the source collection', () => {
    const savedWindow = createSavedWindow();

    expect(() =>
      mergeSavedWindows(
        [savedWindow],
        [savedWindow.id, 'missing'],
        'Merged research',
        '2026-08-12T10:00:00.000Z',
      ),
    ).toThrow('A selected saved window no longer exists.');
    expect(savedWindow.tabs).toHaveLength(1);
  });

  it('requires a valid new name before changing the source collection', () => {
    const first = createSavedWindow({ id: 'first' });
    const second = createSavedWindow({ id: 'second' });

    expect(() =>
      mergeSavedWindows([first, second], ['first', 'second'], '   ', '2026-08-12T10:00:00.000Z'),
    ).toThrow('Enter a name for this saved window.');
    expect(first.name).toBe('Research');
    expect(second.name).toBe('Research');
  });
});
