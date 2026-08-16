import { describe, expect, it } from 'vitest';

import {
  createActiveWindowsSnapshot,
  createManagedTab,
  createManagedWindow,
} from '../../test/activeWindowsFixtures';
import { type SavedWindow } from '../saved-windows/savedWindowModel';
import { buildCommandPaletteSections, COMMAND_PALETTE_SECTION_ORDER } from './commandPaletteModel';

function createSavedWindow(overrides: Partial<SavedWindow> = {}): SavedWindow {
  return {
    createdAt: '2026-08-16T12:00:00.000Z',
    groups: [
      {
        collapsed: false,
        color: 'purple',
        key: 'research',
        title: 'Research',
      },
    ],
    id: 'saved-1',
    name: 'Research planning',
    tabs: [
      {
        active: true,
        groupKey: 'research',
        order: 0,
        pinned: true,
        title: 'Weaver ideas — Notion',
        url: 'https://www.notion.so/weaver-ideas',
      },
    ],
    updatedAt: '2026-08-16T12:00:00.000Z',
    ...overrides,
  };
}

function createSources() {
  const activeSnapshot = createActiveWindowsSnapshot({
    windows: [
      createManagedWindow({
        groups: [
          {
            collapsed: false,
            color: 'blue',
            id: 10,
            title: 'Planning',
            windowId: 1,
          },
        ],
        tabs: [
          createManagedTab({
            active: false,
            groupId: 10,
            id: 102,
            index: 2,
            title: 'Project roadmap — Notion',
            url: 'https://www.notion.so/project-roadmap',
          }),
          createManagedTab({
            active: true,
            agentAssociated: true,
            agentDedupeProtected: true,
            groupId: 10,
            id: 101,
            index: 0,
            pinned: true,
            title: 'Fleet capacity plan — Notion',
            url: 'https://www.notion.so/fleet-capacity',
          }),
          createManagedTab({
            discarded: true,
            id: 103,
            index: 3,
            title: 'Notion release notes',
            url: 'https://www.notion.so/releases',
          }),
        ],
      }),
    ],
  });
  return { activeSnapshot, savedWindows: [createSavedWindow()] };
}

describe('buildCommandPaletteSections', () => {
  it('keeps the approved section order and builds context-rich Notion results', () => {
    const sources = createSources();
    const sections = buildCommandPaletteSections({ ...sources, query: '  NoTiOn  ' });

    expect(COMMAND_PALETTE_SECTION_ORDER).toEqual([
      'open-tabs',
      'tab-groups',
      'saved',
      'settings',
      'actions',
      'go-to',
    ]);
    expect(sections.map((section) => section.label)).toEqual([
      'Open tabs',
      'Tab groups',
      'Saved',
      'Settings',
    ]);

    const results = sections.flatMap((section) => section.results);
    const activeTab = results.find((result) => result.id === 'active-tab:1:101');
    expect(activeTab).toMatchObject({
      subtitle: 'Planning · notion.so',
      state: {
        active: true,
        agentAssociated: true,
        agentDedupeProtected: true,
        pinned: true,
        suspended: false,
      },
    });
    expect(results.find((result) => result.id === 'active-tab:1:103')?.state?.suspended).toBe(true);
    expect(results.some((result) => /Window \d+/u.test(result.subtitle))).toBe(false);
    expect(results).toContainEqual(
      expect.objectContaining({
        id: 'setting:notion-url-matching',
        subtitle: 'Advanced duplicate matching',
      }),
    );
  });

  it('surfaces live and saved groups from descendant matches', () => {
    const sources = createSources();
    const groupResults = buildCommandPaletteSections({
      ...sources,
      query: 'fleet capacity',
    }).find((section) => section.id === 'tab-groups')?.results;

    expect(groupResults).toEqual([
      expect.objectContaining({
        action: { tabId: 101, type: 'focus-active-tab', windowId: 1 },
        id: 'active-group:1:10',
        subtitle: 'Tab group · 1 matching tab',
        title: 'Planning',
      }),
    ]);

    const savedGroupResults = buildCommandPaletteSections({
      ...sources,
      query: 'weaver ideas',
    }).find((section) => section.id === 'tab-groups')?.results;
    const savedGroup = savedGroupResults?.find(
      (result) => result.id === 'saved-group:saved-1:research',
    );
    expect(savedGroup).toMatchObject({
      id: 'saved-group:saved-1:research',
      subtitle: 'Saved tab group · 1 matching tab',
    });
    expect(savedGroup?.action.type).toBe('navigate');
  });

  it('chooses the first browser-order child when a group title matches', () => {
    const sources = createSources();
    const group = buildCommandPaletteSections({ ...sources, query: 'planning' })
      .find((section) => section.id === 'tab-groups')
      ?.results.find((result) => result.id === 'active-group:1:10');

    expect(group?.action).toEqual({ tabId: 101, type: 'focus-active-tab', windowId: 1 });

    const descendantMatch = buildCommandPaletteSections({
      ...sources,
      query: 'project roadmap',
    })
      .find((section) => section.id === 'tab-groups')
      ?.results.find((result) => result.id === 'active-group:1:10');
    expect(descendantMatch?.action).toEqual({
      tabId: 101,
      type: 'focus-active-tab',
      windowId: 1,
    });
  });

  it('keeps duplicate result names distinct by source identity', () => {
    const sources = createSources();
    const secondWindow = createManagedWindow({
      id: 2,
      label: 'Window 2',
      tabs: [
        createManagedTab({
          id: 201,
          title: 'Fleet capacity plan — Notion',
          windowId: 2,
        }),
      ],
    });
    const sections = buildCommandPaletteSections({
      ...sources,
      activeSnapshot: createActiveWindowsSnapshot({
        windows: [...sources.activeSnapshot.windows, secondWindow],
      }),
      query: 'fleet capacity',
    });
    const matchingTabs = sections
      .find((section) => section.id === 'open-tabs')
      ?.results.filter((result) => result.title === 'Fleet capacity plan — Notion');

    expect(matchingTabs?.map((result) => result.id)).toEqual([
      'active-tab:1:101',
      'active-tab:2:201',
    ]);
  });

  it('shows safe navigation and review commands before a query', () => {
    const sections = buildCommandPaletteSections({
      activeSnapshot: null,
      query: '',
      savedWindows: [],
    });

    expect(sections.map((section) => section.label)).toEqual(['Actions', 'Go to']);
    expect(
      sections
        .flatMap((section) => section.results)
        .every((result) => result.action.type === 'navigate'),
    ).toBe(true);
  });
});
