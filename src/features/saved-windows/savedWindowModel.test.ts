import { describe, expect, it } from 'vitest';

import {
  captureSavedWindow,
  createSavedWindowRecovery,
  parseSavedWindow,
  planSavedWindowRestore,
  salvageSavedWindowsCollection,
  type SavedWindow,
} from './savedWindowModel';

function createChromeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    active: false,
    audible: false,
    autoDiscardable: true,
    discarded: false,
    frozen: false,
    groupId: -1,
    highlighted: false,
    incognito: false,
    index: 0,
    pinned: false,
    selected: false,
    windowId: 1,
    ...overrides,
  };
}

function createChromeWindow(overrides: Partial<chrome.windows.Window> = {}): chrome.windows.Window {
  return {
    alwaysOnTop: false,
    focused: true,
    id: 1,
    incognito: false,
    type: 'normal',
    ...overrides,
  };
}

function createGroup(
  overrides: Partial<chrome.tabGroups.TabGroup> = {},
): chrome.tabGroups.TabGroup {
  return {
    collapsed: false,
    color: 'blue',
    id: 7,
    shared: false,
    title: 'Planning',
    windowId: 1,
    ...overrides,
  };
}

function createSavedWindow(overrides: Partial<SavedWindow> = {}): SavedWindow {
  return {
    createdAt: '2026-07-11T06:00:00.000Z',
    groups: [],
    id: 'saved-1',
    name: 'Research',
    tabs: [
      {
        active: true,
        order: 0,
        pinned: false,
        title: 'Example',
        url: 'https://example.test',
      },
    ],
    updatedAt: '2026-07-11T06:00:00.000Z',
    ...overrides,
  };
}

describe('captureSavedWindow', () => {
  it('captures browser order, pins, active state, and local group metadata', () => {
    const result = captureSavedWindow(
      createChromeWindow({
        tabs: [
          createChromeTab({
            id: 11,
            index: 0,
            pinned: true,
            title: 'Pinned',
            url: 'https://p.test',
          }),
          createChromeTab({
            active: true,
            groupId: 7,
            id: 12,
            index: 1,
            title: 'Plan',
            url: 'https://plan.test',
          }),
          createChromeTab({ groupId: 7, id: 13, index: 2, url: 'https://plan.test/two' }),
        ],
      }),
      [createGroup({ collapsed: true, color: 'purple' })],
      '  Project tabs  ',
      'saved-1',
      '2026-07-11T06:00:00.000Z',
    );

    expect(result.warnings).toEqual([]);
    expect(result.savedWindow).toMatchObject({
      groups: [{ collapsed: true, color: 'purple', key: 'group-1', title: 'Planning' }],
      name: 'Project tabs',
      tabs: [
        { active: false, order: 0, pinned: true, title: 'Pinned' },
        { active: true, groupKey: 'group-1', order: 1, pinned: false },
        { active: false, groupKey: 'group-1', order: 2, pinned: false },
      ],
    });
  });

  it('skips unavailable URLs, degrades missing groups, and preserves one active tab', () => {
    const result = captureSavedWindow(
      createChromeWindow({
        tabs: [
          createChromeTab({ active: true, id: 11 }),
          createChromeTab({ groupId: 99, id: 12, index: 1, url: 'https://saved.test' }),
        ],
      }),
      [],
      'Saved',
      'saved-2',
      '2026-07-11T06:00:00.000Z',
    );

    expect(result.savedWindow.tabs).toEqual([
      {
        active: true,
        order: 0,
        pinned: false,
        title: 'https://saved.test',
        url: 'https://saved.test',
      },
    ]);
    expect(result.warnings).toHaveLength(2);
  });

  it('rejects incognito and empty captures', () => {
    expect(() =>
      captureSavedWindow(
        createChromeWindow({ incognito: true, tabs: [] }),
        [],
        'Private',
        'saved-3',
        '2026-07-11T06:00:00.000Z',
      ),
    ).toThrow('Incognito windows cannot be saved.');
    expect(() =>
      captureSavedWindow(
        createChromeWindow({ tabs: [createChromeTab({ id: 1 })] }),
        [],
        'Empty',
        'saved-4',
        '2026-07-11T06:00:00.000Z',
      ),
    ).toThrow('no tabs with restorable URLs');
  });
});

describe('saved window schema', () => {
  it('parses and canonicalizes a valid saved window', () => {
    const savedWindow = createSavedWindow({
      groups: [{ collapsed: true, color: 'green', key: 'group-1', title: 'Docs' }],
      tabs: [
        {
          active: false,
          groupKey: 'group-1',
          order: 1,
          pinned: false,
          title: 'Two',
          url: 'https://two.test',
        },
        {
          active: true,
          groupKey: 'group-1',
          order: 0,
          pinned: false,
          title: 'One',
          url: 'https://one.test',
        },
      ],
    });
    expect(parseSavedWindow(savedWindow)?.tabs.map((tab) => tab.order)).toEqual([0, 1]);
  });

  it('rejects invalid active, pin, order, group-reference, and group-contiguity states', () => {
    const baseTabs = createSavedWindow().tabs;
    expect(
      parseSavedWindow(createSavedWindow({ tabs: [{ ...baseTabs[0]!, active: false }] })),
    ).toBeNull();
    expect(
      parseSavedWindow(
        createSavedWindow({
          tabs: [
            { ...baseTabs[0]!, active: true, order: 0, pinned: false },
            { ...baseTabs[0]!, active: false, order: 1, pinned: true },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseSavedWindow(createSavedWindow({ tabs: [{ ...baseTabs[0]!, order: 2 }] })),
    ).toBeNull();
    expect(
      parseSavedWindow(createSavedWindow({ tabs: [{ ...baseTabs[0]!, groupKey: 'missing' }] })),
    ).toBeNull();
    expect(
      parseSavedWindow(
        createSavedWindow({
          groups: [{ collapsed: false, color: 'blue', key: 'group-1', title: '' }],
          tabs: [
            { ...baseTabs[0]!, active: true, groupKey: 'group-1', order: 0 },
            { ...baseTabs[0]!, active: false, order: 1 },
            { ...baseTabs[0]!, active: false, groupKey: 'group-1', order: 2 },
          ],
        }),
      ),
    ).toBeNull();
  });

  it('salvages valid records while identifying corrupt and duplicate records', () => {
    const first = createSavedWindow();
    const duplicate = createSavedWindow({ name: 'Duplicate' });
    const invalid = { id: 'broken' };

    expect(
      salvageSavedWindowsCollection({
        schemaVersion: 1,
        windows: [first, invalid, duplicate],
      }),
    ).toEqual({
      collection: { schemaVersion: 1, windows: [first] },
      invalidRecordCount: 2,
    });
  });

  it('creates a valid recovery snapshot containing only failed tabs', () => {
    const savedWindow = createSavedWindow({
      groups: [{ collapsed: true, color: 'purple', key: 'group-1', title: 'Planning' }],
      tabs: [
        {
          active: false,
          order: 0,
          pinned: true,
          title: 'Pinned',
          url: 'https://pinned.test',
        },
        {
          active: true,
          groupKey: 'group-1',
          order: 1,
          pinned: false,
          title: 'Active group tab',
          url: 'https://group.test/active',
        },
        {
          active: false,
          groupKey: 'group-1',
          order: 2,
          pinned: false,
          title: 'Failed group tab',
          url: 'https://group.test/failed',
        },
      ],
    });

    const recovery = createSavedWindowRecovery(
      savedWindow,
      new Set([0, 2]),
      '2026-07-11T07:00:00.000Z',
    );

    expect(recovery).toEqual({
      ...savedWindow,
      groups: savedWindow.groups,
      tabs: [
        { ...savedWindow.tabs[0], active: true, order: 0 },
        { ...savedWindow.tabs[2], active: false, order: 1 },
      ],
      updatedAt: '2026-07-11T07:00:00.000Z',
    });
    expect(parseSavedWindow(recovery)).toEqual(recovery);
  });
});

describe('planSavedWindowRestore', () => {
  it('plans tab order, active order, and group memberships without mutating the snapshot', () => {
    const savedWindow = createSavedWindow({
      groups: [{ collapsed: false, color: 'blue', key: 'group-1', title: 'Work' }],
      tabs: [
        {
          active: false,
          groupKey: 'group-1',
          order: 0,
          pinned: false,
          title: 'One',
          url: 'https://one.test',
        },
        {
          active: true,
          groupKey: 'group-1',
          order: 1,
          pinned: false,
          title: 'Two',
          url: 'https://two.test',
        },
      ],
    });

    expect(planSavedWindowRestore(savedWindow)).toEqual({
      activeTabOrder: 1,
      groups: [
        {
          group: { collapsed: false, color: 'blue', key: 'group-1', title: 'Work' },
          tabOrders: [0, 1],
        },
      ],
      tabs: savedWindow.tabs,
    });
  });
});
