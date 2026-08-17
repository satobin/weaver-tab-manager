import { describe, expect, it } from 'vitest';

import { type SavedWindow } from './savedWindowModel';
import { resolveSavedWindowReveal, type SavedWindowRevealRequest } from './savedWindowReveal';

const UPDATED_AT = '2026-08-16T12:00:00.000Z';

function createSavedWindow(): SavedWindow {
  return {
    createdAt: '2026-08-16T11:00:00.000Z',
    groups: [
      { collapsed: false, color: 'blue', key: 'planning', title: 'Planning' },
      { collapsed: true, color: 'green', key: 'later', title: 'Later' },
    ],
    id: 'saved-1',
    name: 'Research',
    tabs: [
      {
        active: true,
        groupKey: 'planning',
        order: 0,
        pinned: false,
        title: 'Plan',
        url: 'https://example.com/plan',
      },
      {
        active: false,
        groupKey: 'later',
        order: 1,
        pinned: false,
        title: 'Backlog',
        url: 'https://example.com/backlog',
      },
      {
        active: false,
        order: 2,
        pinned: true,
        title: 'Inbox',
        url: 'https://example.com/inbox',
      },
    ],
    updatedAt: UPDATED_AT,
  };
}

describe('resolveSavedWindowReveal', () => {
  it.each([
    {
      expectedKind: 'window',
      request: {
        kind: 'window',
        savedWindowId: 'saved-1',
        savedWindowUpdatedAt: UPDATED_AT,
      } satisfies SavedWindowRevealRequest,
    },
    {
      expectedKind: 'group',
      request: {
        groupKey: 'planning',
        kind: 'group',
        savedWindowId: 'saved-1',
        savedWindowUpdatedAt: UPDATED_AT,
      } satisfies SavedWindowRevealRequest,
    },
    {
      expectedKind: 'tab',
      request: {
        kind: 'tab',
        savedWindowId: 'saved-1',
        savedWindowUpdatedAt: UPDATED_AT,
        tabOrder: 0,
      } satisfies SavedWindowRevealRequest,
    },
  ] as const)('resolves an exact $expectedKind request', ({ expectedKind, request }) => {
    const sourceWindow = createSavedWindow();

    const result = resolveSavedWindowReveal([sourceWindow], request);

    expect(result.kind).toBe(expectedKind);
    if (result.kind === 'missing-window') {
      throw new Error('Expected the saved window to resolve');
    }
    expect(result.sourceWindow).toBe(sourceWindow);
    if (result.kind === 'window') {
      expect(result.reason).toBe('requested');
      expect(result.displayWindow).toBe(sourceWindow);
    } else if (result.kind === 'group') {
      expect(result.group).toBe(sourceWindow.groups[0]);
      expect(result.displayWindow).not.toBe(sourceWindow);
      expect(result.displayWindow.groups).toEqual([sourceWindow.groups[0]]);
      expect(result.displayWindow.tabs).toEqual([sourceWindow.tabs[0]]);
    } else {
      expect(result.tab).toBe(sourceWindow.tabs[0]);
      expect(result.displayWindow).toBe(sourceWindow);
    }
  });

  it.each([
    {
      expectedReason: 'missing-group',
      request: {
        groupKey: 'missing',
        kind: 'group',
        savedWindowId: 'saved-1',
        savedWindowUpdatedAt: UPDATED_AT,
      } satisfies SavedWindowRevealRequest,
    },
    {
      expectedReason: 'missing-tab',
      request: {
        kind: 'tab',
        savedWindowId: 'saved-1',
        savedWindowUpdatedAt: UPDATED_AT,
        tabOrder: 99,
      } satisfies SavedWindowRevealRequest,
    },
  ] as const)(
    'falls back to the full window for a $expectedReason',
    ({ expectedReason, request }) => {
      const sourceWindow = createSavedWindow();

      const result = resolveSavedWindowReveal([sourceWindow], request);

      expect(result).toMatchObject({ kind: 'window', reason: expectedReason });
      if (result.kind !== 'window') {
        throw new Error('Expected a window fallback');
      }
      expect(result.sourceWindow).toBe(sourceWindow);
      expect(result.displayWindow).toBe(sourceWindow);
    },
  );

  it('falls back to the full window when the requested version is stale', () => {
    const sourceWindow = createSavedWindow();

    const result = resolveSavedWindowReveal([sourceWindow], {
      kind: 'tab',
      savedWindowId: sourceWindow.id,
      savedWindowUpdatedAt: '2026-08-16T11:59:00.000Z',
      tabOrder: 0,
    });

    expect(result).toMatchObject({ kind: 'window', reason: 'version-mismatch' });
    if (result.kind !== 'window') {
      throw new Error('Expected a window fallback');
    }
    expect(result.sourceWindow).toBe(sourceWindow);
    expect(result.displayWindow).toBe(sourceWindow);
  });

  it('reports a missing window without a display projection', () => {
    const request = {
      kind: 'window',
      savedWindowId: 'missing',
      savedWindowUpdatedAt: UPDATED_AT,
    } satisfies SavedWindowRevealRequest;

    expect(resolveSavedWindowReveal([createSavedWindow()], request)).toEqual({
      kind: 'missing-window',
      request,
    });
  });

  it('accepts the current child when a versionless route is resolved', () => {
    const sourceWindow = createSavedWindow();

    const result = resolveSavedWindowReveal([sourceWindow], {
      groupKey: 'planning',
      kind: 'group',
      savedWindowId: sourceWindow.id,
      savedWindowUpdatedAt: null,
    });

    expect(result.kind).toBe('group');
    if (result.kind !== 'group') {
      throw new Error('Expected the group to resolve');
    }
    expect(result.group).toBe(sourceWindow.groups[0]);
  });

  it('makes a combined group and tab request invalid', () => {
    // @ts-expect-error -- A reveal request must identify exactly one child kind.
    const request: SavedWindowRevealRequest = {
      groupKey: 'planning',
      kind: 'tab',
      savedWindowId: 'saved-1',
      savedWindowUpdatedAt: UPDATED_AT,
      tabOrder: 0,
    };

    expect(request).toBeDefined();
  });
});
