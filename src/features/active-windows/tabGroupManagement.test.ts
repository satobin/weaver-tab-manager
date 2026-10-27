// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createManagedTab } from '../../test/activeWindowsFixtures';
import { type ManagedTabGroup } from './model';
import { createTabGroupManagement } from './tabGroupManagement';

function setup() {
  const selected = [
    createManagedTab({ id: 1, index: 0 }),
    createManagedTab({ id: 2, index: 1, groupId: 7 }),
  ];
  const group: ManagedTabGroup = {
    id: 7,
    windowId: 1,
    title: 'Research',
    color: 'purple',
    collapsed: true,
  };
  const tabs = new Map(
    selected.map((tab) => [
      tab.id,
      {
        ...tab,
        groupId: tab.groupId ?? -1,
        highlighted: false,
        incognito: false,
        autoDiscardable: true,
        selected: false,
        lastAccessed: 0,
      } satisfies chrome.tabs.Tab,
    ]),
  );
  tabs.set(3, { ...tabs.get(2)!, id: 3, index: 2 });
  const groups = new Map<number, chrome.tabGroups.TabGroup>([[7, { ...group, shared: false }]]);
  const api = {
    tabs: {
      get: vi.fn((id: number) => {
        const tab = tabs.get(id);
        if (!tab) return Promise.reject(new Error('Tab closed'));
        return Promise.resolve({ ...tab });
      }),
      group: vi.fn((options: chrome.tabs.GroupOptions) => {
        const id = options.groupId ?? 99;
        if (options.groupId === undefined) {
          groups.set(id, {
            id,
            windowId: options.createProperties?.windowId ?? 1,
            title: '',
            color: 'grey',
            collapsed: false,
            shared: false,
          });
        }
        for (const tabId of Array.isArray(options.tabIds) ? options.tabIds : [options.tabIds]) {
          if (tabId !== undefined && tabs.has(tabId)) {
            tabs.get(tabId)!.groupId = id;
            tabs.get(tabId)!.windowId = groups.get(id)!.windowId;
          }
        }
        return Promise.resolve(id);
      }),
      ungroup: vi.fn((tabIds: number | [number, ...number[]]) => {
        for (const id of Array.isArray(tabIds) ? tabIds : [tabIds]) tabs.get(id)!.groupId = -1;
        return Promise.resolve();
      }),
    },
    tabGroups: {
      get: vi.fn((id: number) => {
        const value = groups.get(id);
        if (!value) return Promise.reject(new Error('Group closed'));
        return Promise.resolve({ ...value });
      }),
      update: vi.fn((id: number, details: chrome.tabGroups.UpdateProperties) => {
        const value = groups.get(id);
        if (!value) return Promise.reject(new Error('Group closed'));
        Object.assign(value, details);
        return Promise.resolve({ ...value });
      }),
    },
  };
  return { api, group, groups, selected, service: createTabGroupManagement(api), tabs };
}

describe('native tab group management', () => {
  it('creates a same-window group in browser order and saves only name/color', async () => {
    const { api, selected, service, tabs } = setup();
    const result = await service.createTabGroup(
      [...selected].reverse(),
      { title: '  Work  ', color: 'orange' },
      1,
    );
    expect(api.tabs.group).toHaveBeenCalledExactlyOnceWith({
      createProperties: { windowId: 1 },
      tabIds: [1, 2],
    });
    expect(api.tabGroups.update).toHaveBeenCalledExactlyOnceWith(99, {
      title: 'Work',
      color: 'orange',
    });
    expect(result).toEqual({ affectedTabIds: [1, 2], failures: [], groupId: 99, warnings: [] });
    expect(tabs.get(3)?.groupId).toBe(7);
  });

  it('allows an unnamed group', async () => {
    const { service, selected } = setup();
    expect(
      (await service.createTabGroup(selected, { title: ' ', color: 'blue' }, 1)).warnings,
    ).toEqual([]);
  });

  it.each(['window', 'group', 'pin', 'closed'] as const)(
    'refuses a stale %s before any mutation',
    async (change) => {
      const { service, selected, tabs, api } = setup();
      if (change === 'window') tabs.get(1)!.windowId = 2;
      if (change === 'group') tabs.get(1)!.groupId = 8;
      if (change === 'pin') tabs.get(1)!.pinned = true;
      if (change === 'closed') tabs.delete(1);
      await expect(
        service.createTabGroup(selected, { title: 'Work', color: 'blue' }, 1),
      ).rejects.toThrow();
      expect(api.tabs.group).not.toHaveBeenCalled();
      expect(api.tabGroups.update).not.toHaveBeenCalled();
    },
  );

  it('creates a new group from several windows in a destination without selected tabs', async () => {
    const { service, selected, tabs, api, groups, group } = setup();
    Object.assign(selected[1]!, { windowId: 2, groupId: 8 });
    Object.assign(tabs.get(2)!, { windowId: 2, groupId: 8 });
    groups.set(8, { ...group, id: 8, windowId: 2, shared: false });
    const result = await service.createTabGroup(selected, { title: 'Combined', color: 'green' }, 3);
    expect(api.tabs.group).toHaveBeenCalledExactlyOnceWith({
      createProperties: { windowId: 3 },
      tabIds: [1, 2],
    });
    expect(result).toEqual({ affectedTabIds: [1, 2], failures: [], groupId: 99, warnings: [] });
    expect(tabs.get(1)).toMatchObject({ windowId: 3, groupId: 99 });
    expect(tabs.get(2)).toMatchObject({ windowId: 3, groupId: 99 });
    expect(tabs.get(3)).toMatchObject({ windowId: 1, groupId: 7 });
    expect(groups.get(7)).toMatchObject(group);
    expect(groups.get(99)).toMatchObject({ windowId: 3, title: 'Combined', color: 'green' });
  });

  it('moves multiple sources in window order and browser order while skipping selected destination members', async () => {
    const { service, selected, api, group, tabs, groups } = setup();
    const remoteTabs = [
      createManagedTab({ id: 4, windowId: 2, index: 0 }),
      createManagedTab({ id: 5, windowId: 2, index: 3 }),
      createManagedTab({ id: 6, windowId: 3, index: 0 }),
    ];
    remoteTabs.forEach((tab) => tabs.set(tab.id, { ...tabs.get(1)!, ...tab, groupId: -1 }));
    const result = await service.addTabsToGroup(
      [remoteTabs[1]!, remoteTabs[0]!, ...selected, remoteTabs[2]!],
      group,
    );
    expect(api.tabs.group).toHaveBeenCalledExactlyOnceWith({ groupId: 7, tabIds: [4, 5, 1, 6] });
    expect(result).toEqual({
      affectedTabIds: [4, 5, 1, 2, 6],
      failures: [],
      groupId: 7,
      warnings: [],
    });
    remoteTabs.forEach((tab) =>
      expect(tabs.get(tab.id)).toMatchObject({ windowId: 1, groupId: 7 }),
    );
    expect(tabs.get(3)).toMatchObject({ windowId: 1, groupId: 7 });
    expect(groups.get(7)).toMatchObject(group);
    expect(api.tabGroups.update).not.toHaveBeenCalled();
  });

  it.each(['window', 'group', 'pin', 'closed'] as const)(
    'refuses a stale %s in a secondary source before moving any tabs',
    async (change) => {
      const { service, selected, tabs, api, group } = setup();
      Object.assign(selected[1]!, { windowId: 2, groupId: null });
      Object.assign(tabs.get(2)!, { windowId: 2, groupId: -1 });
      if (change === 'window') tabs.get(2)!.windowId = 3;
      if (change === 'group') tabs.get(2)!.groupId = 8;
      if (change === 'pin') tabs.get(2)!.pinned = true;
      if (change === 'closed') tabs.delete(2);
      await expect(service.addTabsToGroup(selected, group)).rejects.toThrow();
      expect(api.tabs.group).not.toHaveBeenCalled();
    },
  );

  it('refuses a currently pinned tab in a secondary source without moving any tabs', async () => {
    const { service, selected, tabs, api, group } = setup();
    Object.assign(selected[1]!, { windowId: 2, groupId: null, pinned: true });
    Object.assign(tabs.get(2)!, { windowId: 2, groupId: -1, pinned: true });
    await expect(service.addTabsToGroup(selected, group)).rejects.toThrow('Unpin');
    expect(api.tabs.group).not.toHaveBeenCalled();
  });

  it('never unpins tabs to create or join a group', async () => {
    const { service, selected, tabs, api, group } = setup();
    selected[0]!.pinned = true;
    tabs.get(1)!.pinned = true;
    await expect(
      service.createTabGroup(selected, { title: 'Work', color: 'blue' }, 1),
    ).rejects.toThrow('Unpin');
    await expect(service.addTabsToGroup(selected, group)).rejects.toThrow('Unpin');
    expect(api.tabs.group).not.toHaveBeenCalled();
    expect(tabs.get(1)?.pinned).toBe(true);
  });

  it('reports a created group when saving its metadata fails, without a second create', async () => {
    const { service, selected, api, tabs } = setup();
    api.tabGroups.update.mockRejectedValueOnce(new Error('Update failed'));
    const result = await service.createTabGroup(selected, { title: 'Work', color: 'blue' }, 1);
    expect(result.affectedTabIds).toEqual([1, 2]);
    expect(result.groupId).toBe(99);
    expect(result.warnings[0]).toContain('Edit the existing group to retry');
    expect(api.tabs.group).toHaveBeenCalledOnce();
    expect(tabs.get(1)?.groupId).toBe(99);
  });

  it('reports a rejected creation and does not try metadata writes or rollbacks', async () => {
    const { service, selected, api } = setup();
    api.tabs.group.mockRejectedValueOnce(new Error('Cannot group tabs'));
    await expect(
      service.createTabGroup(selected, { title: 'Work', color: 'blue' }, 1),
    ).rejects.toThrow('Cannot group');
    expect(api.tabGroups.update).not.toHaveBeenCalled();
    expect(api.tabs.ungroup).not.toHaveBeenCalled();
  });

  it('explains a rejected cross-window creation after partial relocation without retrying or guessing a group', async () => {
    const { service, selected, api, tabs } = setup();
    api.tabs.group.mockImplementationOnce(() => {
      Object.assign(tabs.get(1)!, { windowId: 3, groupId: -1 });
      return Promise.reject(new Error('Second tab is busy.'));
    });
    await expect(
      service.createTabGroup(selected, { title: 'Combined', color: 'blue' }, 3),
    ).rejects.toThrow('Some tabs may have moved');
    expect(api.tabs.group).toHaveBeenCalledOnce();
    expect(api.tabGroups.update).not.toHaveBeenCalled();
    expect(api.tabs.ungroup).not.toHaveBeenCalled();
    expect(tabs.get(1)).toMatchObject({ windowId: 3, groupId: -1 });
    expect(tabs.get(2)).toMatchObject({ windowId: 1, groupId: 7 });
  });

  it('checks membership after metadata saves so tabs moved during creation are reported', async () => {
    const { service, selected, api, tabs, groups } = setup();
    api.tabGroups.update.mockImplementationOnce((id, details) => {
      Object.assign(groups.get(id)!, details);
      tabs.get(1)!.windowId = 2;
      return Promise.resolve(groups.get(id)!);
    });
    const result = await service.createTabGroup(selected, { title: 'Work', color: 'blue' }, 1);
    expect(result.affectedTabIds).toEqual([2]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.tabId).toBe(1);
    expect(result.failures[0]?.message).toContain('did not apply');
  });

  it('adds only nonmembers and preserves the group metadata and unselected members', async () => {
    const { service, selected, api, tabs, group, groups } = setup();
    const result = await service.addTabsToGroup(selected, group);
    expect(api.tabs.group).toHaveBeenCalledExactlyOnceWith({ groupId: 7, tabIds: [1] });
    expect(api.tabGroups.update).not.toHaveBeenCalled();
    expect(groups.get(7)).toMatchObject(group);
    expect(tabs.get(3)?.groupId).toBe(7);
    expect(result.affectedTabIds).toEqual([1, 2]);
  });

  it.each(['closed', 'moved', 'renamed'] as const)(
    'refuses a %s destination group',
    async (change) => {
      const { service, selected, api, group, groups } = setup();
      if (change === 'closed') groups.delete(7);
      if (change === 'moved') groups.get(7)!.windowId = 2;
      if (change === 'renamed') groups.get(7)!.title = 'Different group';
      await expect(service.addTabsToGroup(selected, group)).rejects.toThrow();
      expect(api.tabs.group).not.toHaveBeenCalled();
    },
  );

  it('moves selected tabs to a group in another window while preserving both groups and unselected tabs', async () => {
    const { service, selected, api, group, groups, tabs } = setup();
    const destination = {
      ...group,
      id: 8,
      windowId: 2,
      title: 'Destination',
      color: 'blue' as const,
    };
    groups.set(8, { ...destination, shared: false });
    tabs.set(4, { ...tabs.get(3)!, id: 4, windowId: 2, groupId: 8 });
    const result = await service.addTabsToGroup([...selected].reverse(), destination);
    expect(api.tabs.group).toHaveBeenCalledExactlyOnceWith({ groupId: 8, tabIds: [1, 2] });
    expect(result).toEqual({ affectedTabIds: [1, 2], failures: [], groupId: 8, warnings: [] });
    expect(tabs.get(1)).toMatchObject({ windowId: 2, groupId: 8 });
    expect(tabs.get(2)).toMatchObject({ windowId: 2, groupId: 8 });
    expect(tabs.get(3)).toMatchObject({ windowId: 1, groupId: 7 });
    expect(tabs.get(4)).toMatchObject({ windowId: 2, groupId: 8 });
    expect(groups.get(7)).toMatchObject(group);
    expect(groups.get(8)).toMatchObject(destination);
    expect(api.tabGroups.update).not.toHaveBeenCalled();
  });

  it('reports a partial move from multiple sources without treating an ungrouped moved tab as success', async () => {
    const { service, selected, api, group, groups, tabs } = setup();
    selected[1]!.windowId = 3;
    tabs.get(2)!.windowId = 3;
    const destination = { ...group, id: 8, windowId: 2 };
    groups.set(8, { ...destination, shared: false });
    api.tabs.group.mockImplementationOnce(() => {
      Object.assign(tabs.get(1)!, { windowId: 2, groupId: 8 });
      Object.assign(tabs.get(2)!, { windowId: 2, groupId: -1 });
      return Promise.reject(new Error('Second tab changed'));
    });
    const result = await service.addTabsToGroup(selected, destination);
    expect(result.affectedTabIds).toEqual([1]);
    expect(result.failures).toEqual([{ tabId: 2, message: 'Second tab changed' }]);
    expect(api.tabs.group).toHaveBeenCalledOnce();
    expect(api.tabs.ungroup).not.toHaveBeenCalled();
  });

  it('requires both the destination window and group to match after a cross-window move', async () => {
    const { service, selected, api, group, groups, tabs } = setup();
    const destination = { ...group, id: 8, windowId: 2 };
    groups.set(8, { ...destination, shared: false });
    api.tabs.group.mockImplementationOnce(() => {
      tabs.get(1)!.groupId = 8;
      Object.assign(tabs.get(2)!, { windowId: 2, groupId: 8 });
      return Promise.resolve(8);
    });
    const result = await service.addTabsToGroup(selected, destination);
    expect(result.affectedTabIds).toEqual([2]);
    expect(result.failures).toEqual([
      { tabId: 1, message: 'The browser did not apply the requested group change.' },
    ]);
  });

  it('reconciles partial grouping even if the browser rejects the call', async () => {
    const { service, selected, api, tabs, group } = setup();
    selected[1]!.groupId = null;
    tabs.get(2)!.groupId = -1;
    api.tabs.group.mockImplementationOnce(() => {
      tabs.get(1)!.groupId = 7;
      return Promise.reject(new Error('Second tab changed'));
    });
    const result = await service.addTabsToGroup(selected, group);
    expect(result.affectedTabIds).toEqual([1]);
    expect(result.failures).toEqual([{ tabId: 2, message: 'Second tab changed' }]);
  });

  it('does not report a successful API response as success without matching membership', async () => {
    const { service, selected, api, group } = setup();
    api.tabs.group.mockResolvedValueOnce(7);
    const result = await service.addTabsToGroup(selected, group);
    expect(result.affectedTabIds).toEqual([2]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.tabId).toBe(1);
    expect(result.failures[0]?.message).toContain('did not apply');
  });

  it('ungroups only selected group members, keeping tabs and other members open', async () => {
    const { service, selected, api, tabs } = setup();
    const result = await service.removeTabsFromGroups(selected);
    expect(api.tabs.ungroup).toHaveBeenCalledExactlyOnceWith([2]);
    expect(result.affectedTabIds).toEqual([2]);
    expect(tabs.size).toBe(3);
    expect(tabs.get(3)?.groupId).toBe(7);
  });

  it('reports an unsuccessful ungroup without losing the selection target', async () => {
    const { service, selected, api } = setup();
    api.tabs.ungroup.mockRejectedValueOnce(new Error('Tab is busy'));
    const result = await service.removeTabsFromGroups(selected);
    expect(result.affectedTabIds).toEqual([]);
    expect(result.failures).toEqual([{ tabId: 2, message: 'Tab is busy' }]);
  });

  it('ungroups across windows while keeping tabs in their original windows and preserving unselected members', async () => {
    const { service, selected, api, tabs } = setup();
    selected[0]!.groupId = 7;
    tabs.get(1)!.groupId = 7;
    Object.assign(selected[1]!, { windowId: 2, groupId: 8 });
    Object.assign(tabs.get(2)!, { windowId: 2, groupId: 8 });
    const result = await service.removeTabsFromGroups(selected);
    expect(api.tabs.ungroup).toHaveBeenCalledExactlyOnceWith([1, 2]);
    expect(result).toEqual({ affectedTabIds: [1, 2], failures: [], groupId: null, warnings: [] });
    expect(tabs.get(1)).toMatchObject({ windowId: 1, groupId: -1 });
    expect(tabs.get(2)).toMatchObject({ windowId: 2, groupId: -1 });
    expect(tabs.get(3)).toMatchObject({ windowId: 1, groupId: 7 });
    expect(api.tabs.group).not.toHaveBeenCalled();
  });

  it.each(['still grouped', 'moved'] as const)(
    'reports partial removal across windows when a tab is %s',
    async (failure) => {
      const { service, selected, api, tabs } = setup();
      selected[0]!.groupId = 7;
      tabs.get(1)!.groupId = 7;
      Object.assign(selected[1]!, { windowId: 2, groupId: 8 });
      Object.assign(tabs.get(2)!, { windowId: 2, groupId: 8 });
      api.tabs.ungroup.mockImplementationOnce(() => {
        tabs.get(1)!.groupId = -1;
        if (failure === 'moved') Object.assign(tabs.get(2)!, { windowId: 3, groupId: -1 });
        return Promise.reject(new Error('Second tab changed'));
      });
      const result = await service.removeTabsFromGroups(selected);
      expect(result.affectedTabIds).toEqual([1]);
      expect(result.failures).toEqual([{ tabId: 2, message: 'Second tab changed' }]);
      expect(api.tabs.ungroup).toHaveBeenCalledOnce();
      expect(api.tabs.group).not.toHaveBeenCalled();
    },
  );

  it('renames and recolors while preserving native collapse and membership', async () => {
    const { service, group, groups, tabs, api } = setup();
    await service.updateTabGroup(group, { title: '  New name ', color: 'cyan' });
    expect(api.tabGroups.update).toHaveBeenCalledExactlyOnceWith(7, {
      title: 'New name',
      color: 'cyan',
    });
    expect(groups.get(7)?.collapsed).toBe(true);
    expect(tabs.get(2)?.groupId).toBe(7);
    expect(api.tabs.group).not.toHaveBeenCalled();
  });

  it('does not overwrite an external name/color edit', async () => {
    const { service, group, groups, api } = setup();
    groups.get(7)!.color = 'red';
    await expect(service.updateTabGroup(group, { title: 'Draft', color: 'blue' })).rejects.toThrow(
      'changed',
    );
    expect(api.tabGroups.update).not.toHaveBeenCalled();
  });

  it('verifies metadata writes instead of assuming a resolved update succeeded', async () => {
    const { service, group, api } = setup();
    api.tabGroups.update.mockResolvedValueOnce(undefined as unknown as chrome.tabGroups.TabGroup);
    await expect(service.updateTabGroup(group, { title: 'Draft', color: 'blue' })).rejects.toThrow(
      'did not confirm',
    );
  });
});
