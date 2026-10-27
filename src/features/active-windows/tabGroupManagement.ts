import {
  type ActiveWindowsChromeApi,
  type TabOperationFailure,
} from './chromeActiveWindowsService';
import { type ManagedTab, type ManagedTabGroup, type TabGroupColor } from './model';

export type GroupSelectionTab = Pick<ManagedTab, 'id' | 'windowId' | 'groupId' | 'pinned'>;
export type GroupDetails = Pick<ManagedTabGroup, 'title' | 'color'>;

export interface GroupMembershipResult {
  affectedTabIds: number[];
  failures: TabOperationFailure[];
  groupId: number | null;
  warnings: string[];
}

export interface TabGroupManagementService {
  createTabGroup: (
    tabs: readonly GroupSelectionTab[],
    details: GroupDetails,
    windowId: number,
  ) => Promise<GroupMembershipResult>;
  addTabsToGroup: (
    tabs: readonly GroupSelectionTab[],
    group: ManagedTabGroup,
  ) => Promise<GroupMembershipResult>;
  removeTabsFromGroups: (tabs: readonly GroupSelectionTab[]) => Promise<GroupMembershipResult>;
  updateTabGroup: (group: ManagedTabGroup, details: GroupDetails) => Promise<void>;
}

export const TAB_GROUP_COLORS: readonly TabGroupColor[] = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
];

export function groupDetailsMatch(group: ManagedTabGroup, expected: ManagedTabGroup): boolean {
  return (
    group.id === expected.id &&
    group.windowId === expected.windowId &&
    group.title === expected.title &&
    group.color === expected.color
  );
}

export function groupSelectionMatches(
  tabs: readonly GroupSelectionTab[],
  expected: readonly GroupSelectionTab[],
): boolean {
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  return (
    tabs.length === expected.length &&
    expected.every((tab) => {
      const current = byId.get(tab.id);
      return (
        current?.windowId === tab.windowId &&
        current.groupId === tab.groupId &&
        current.pinned === tab.pinned
      );
    })
  );
}

function validateDetails(details: GroupDetails): GroupDetails {
  if (details.title.trim().length > 120 || !TAB_GROUP_COLORS.includes(details.color)) {
    throw new Error('Use a group name of up to 120 characters and one of the available colors.');
  }
  return { title: details.title.trim(), color: details.color };
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The browser could not complete the group change.';
}

type TabGroupManagementApi = {
  tabs: Pick<ActiveWindowsChromeApi['tabs'], 'get' | 'group' | 'ungroup'>;
  tabGroups: Pick<ActiveWindowsChromeApi['tabGroups'], 'get' | 'update'>;
};

export function createTabGroupManagement(api: TabGroupManagementApi): TabGroupManagementService {
  const readSelection = async (
    requested: readonly GroupSelectionTab[],
    action: 'create' | 'move' | 'remove',
  ) => {
    if (
      requested.length === 0 ||
      new Set(requested.map((tab) => tab.id)).size !== requested.length
    ) {
      throw new Error('Select at least one tab to manage its group.');
    }
    const windowIds = [...new Set(requested.map((tab) => tab.windowId))];
    const tabs = await Promise.all(requested.map((tab) => api.tabs.get(tab.id)));
    if (
      !groupSelectionMatches(
        tabs.map((tab) => ({
          id: tab.id ?? -1,
          windowId: tab.windowId,
          pinned: tab.pinned,
          groupId: tab.groupId < 0 ? null : tab.groupId,
        })),
        requested,
      )
    ) {
      throw new Error(
        'The selected tabs changed in the browser. Review the selection and try again.',
      );
    }
    if (action !== 'remove' && tabs.some((tab) => tab.pinned)) {
      throw new Error('Pinned tabs cannot be added to tab groups. Unpin the tab first.');
    }
    const windowOrder = new Map(windowIds.map((id, index) => [id, index]));
    return tabs.sort(
      (a, b) => windowOrder.get(a.windowId)! - windowOrder.get(b.windowId)! || a.index - b.index,
    );
  };

  const readGroup = async (expected: ManagedTabGroup) => {
    const group = await api.tabGroups.get(expected.id);
    if (!groupDetailsMatch({ ...group, title: group.title?.trim() ?? '' }, expected)) {
      throw new Error(
        'The group changed in the browser. Close this panel and reopen it to try again.',
      );
    }
    return group;
  };

  const verifyMembership = async (
    expected: readonly Pick<GroupSelectionTab, 'id' | 'windowId'>[],
    groupId: number | null,
    failure?: unknown,
  ): Promise<GroupMembershipResult> => {
    const result: GroupMembershipResult = {
      affectedTabIds: [],
      failures: [],
      groupId,
      warnings: [],
    };
    for (const { id: tabId, windowId } of expected) {
      try {
        const tab = await api.tabs.get(tabId);
        if (tab.windowId !== windowId || tab.groupId !== (groupId ?? -1)) {
          throw new Error(
            failure ? message(failure) : 'The browser did not apply the requested group change.',
          );
        }
        result.affectedTabIds.push(tabId);
      } catch (error) {
        result.failures.push({ tabId, message: message(error) });
      }
    }
    return result;
  };

  return {
    async createTabGroup(requested, input, windowId) {
      const details = validateDetails(input);
      const tabs = await readSelection(requested, 'create');
      const tabIds = tabs.map((tab) => tab.id!);
      let groupId: number;
      try {
        groupId = await api.tabs.group({
          createProperties: { windowId },
          tabIds: [tabIds[0]!, ...tabIds.slice(1)],
        });
      } catch (error) {
        if (tabs.some((tab) => tab.windowId !== windowId)) {
          throw new Error(
            `${message(error)} Some tabs may have moved to the destination window. Review the tabs before trying to create the group again.`,
          );
        }
        throw error;
      }
      const warnings: string[] = [];
      try {
        const group = await api.tabGroups.get(groupId);
        if (group.windowId !== windowId) {
          throw new Error('The new group moved to another window.');
        }
        await api.tabGroups.update(groupId, details);
        const updated = await api.tabGroups.get(groupId);
        if (
          updated.windowId !== windowId ||
          (updated.title?.trim() ?? '') !== details.title ||
          updated.color !== details.color
        ) {
          throw new Error('The browser did not apply the name and color.');
        }
      } catch (error) {
        warnings.push(
          `The group was created, but its name and color could not be saved. Edit the existing group to retry. ${message(error)}`,
        );
      }
      return {
        ...(await verifyMembership(
          tabIds.map((id) => ({ id, windowId })),
          groupId,
        )),
        warnings,
      };
    },
    async addTabsToGroup(requested, group) {
      const tabs = await readSelection(requested, 'move');
      await readGroup(group);
      const tabIds = tabs.map((tab) => tab.id!);
      const toAdd = tabs.filter((tab) => tab.groupId !== group.id).map((tab) => tab.id!);
      let failure: unknown;
      try {
        if (toAdd[0] !== undefined) {
          await api.tabs.group({ groupId: group.id, tabIds: [toAdd[0], ...toAdd.slice(1)] });
        }
      } catch (error) {
        failure = error;
      }
      return verifyMembership(
        tabIds.map((id) => ({ id, windowId: group.windowId })),
        group.id,
        failure,
      );
    },
    async removeTabsFromGroups(requested) {
      const tabs = await readSelection(requested, 'remove');
      const groupedTabs = tabs
        .filter((tab) => tab.groupId >= 0)
        .map((tab) => ({ id: tab.id!, windowId: tab.windowId }));
      const tabIds = groupedTabs.map((tab) => tab.id);
      let failure: unknown;
      try {
        const firstId = tabIds[0];
        if (firstId !== undefined) {
          await api.tabs.ungroup([firstId, ...tabIds.slice(1)]);
        }
      } catch (error) {
        failure = error;
      }
      return verifyMembership(groupedTabs, null, failure);
    },
    async updateTabGroup(expected, input) {
      const details = validateDetails(input);
      await readGroup(expected);
      await api.tabGroups.update(expected.id, details);
      const group = await api.tabGroups.get(expected.id);
      if (
        group.windowId !== expected.windowId ||
        (group.title?.trim() ?? '') !== details.title ||
        group.color !== details.color
      ) {
        throw new Error(
          'The browser did not confirm the name and color change. Review the group before trying again.',
        );
      }
    },
  };
}
