import { type SavedWindow } from './savedWindowModel';

interface SavedWindowRevealRequestBase {
  savedWindowId: string;
  savedWindowUpdatedAt: string | null;
}

export type SavedWindowRevealRequest =
  | (SavedWindowRevealRequestBase & {
      groupKey?: never;
      kind: 'window';
      tabOrder?: never;
    })
  | (SavedWindowRevealRequestBase & {
      groupKey: string;
      kind: 'group';
      tabOrder?: never;
    })
  | (SavedWindowRevealRequestBase & {
      groupKey?: never;
      kind: 'tab';
      tabOrder: number;
    });

type SavedWindowRevealFallbackReason =
  | 'missing-group'
  | 'missing-tab'
  | 'requested'
  | 'version-mismatch';

export type SavedWindowRevealResolution =
  | {
      kind: 'missing-window';
      request: SavedWindowRevealRequest;
    }
  | {
      displayWindow: SavedWindow;
      kind: 'window';
      reason: SavedWindowRevealFallbackReason;
      sourceWindow: SavedWindow;
    }
  | {
      displayWindow: SavedWindow;
      group: SavedWindow['groups'][number];
      kind: 'group';
      sourceWindow: SavedWindow;
    }
  | {
      displayWindow: SavedWindow;
      kind: 'tab';
      sourceWindow: SavedWindow;
      tab: SavedWindow['tabs'][number];
    };

function resolveWindow(
  sourceWindow: SavedWindow,
  reason: SavedWindowRevealFallbackReason,
): SavedWindowRevealResolution {
  return {
    displayWindow: sourceWindow,
    kind: 'window',
    reason,
    sourceWindow,
  };
}

export function resolveSavedWindowReveal(
  windows: readonly SavedWindow[],
  request: SavedWindowRevealRequest,
): SavedWindowRevealResolution {
  const sourceWindow = windows.find((candidate) => candidate.id === request.savedWindowId);
  if (!sourceWindow) {
    return { kind: 'missing-window', request };
  }

  if (
    request.savedWindowUpdatedAt !== null &&
    request.savedWindowUpdatedAt !== sourceWindow.updatedAt
  ) {
    return resolveWindow(sourceWindow, 'version-mismatch');
  }

  if (request.kind === 'window') {
    return resolveWindow(sourceWindow, 'requested');
  }

  if (request.kind === 'group') {
    const group = sourceWindow.groups.find((candidate) => candidate.key === request.groupKey);
    if (!group) {
      return resolveWindow(sourceWindow, 'missing-group');
    }
    return {
      displayWindow: {
        ...sourceWindow,
        groups: [group],
        tabs: sourceWindow.tabs.filter((tab) => tab.groupKey === group.key),
      },
      group,
      kind: 'group',
      sourceWindow,
    };
  }

  const tab = sourceWindow.tabs.find((candidate) => candidate.order === request.tabOrder);
  if (!tab) {
    return resolveWindow(sourceWindow, 'missing-tab');
  }
  return {
    displayWindow: sourceWindow,
    kind: 'tab',
    sourceWindow,
    tab,
  };
}
