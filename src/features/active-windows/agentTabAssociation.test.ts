import { describe, expect, it } from 'vitest';

import {
  detectAgentAssociatedTab,
  getRestoredGroupTitleWithProvenance,
  hasClaudeAgentGroupSignal,
  isAgentAssociatedTab,
} from './agentTabAssociation';

function createTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
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

function createGroup(
  overrides: Partial<chrome.tabGroups.TabGroup> = {},
): chrome.tabGroups.TabGroup {
  return {
    collapsed: false,
    color: 'orange',
    id: 7,
    shared: false,
    title: 'Claude',
    windowId: 1,
    ...overrides,
  };
}

const CODEX_EXTENSION_ACTIVE_PATH_MARKER =
  '<path d="M3.04536 4.45259C2.7582 3.60299 3.60299 2.7582 4.45259 3.04536L14.1828 6.33403C15.1637 6.66558 15.0872 8.08006 14.0715 8.39045L10.2994 9.54319C9.93919 9.65327 9.65327 9.93919 9.54319 10.2994L8.39046 14.0715C8.08007 15.0872 6.66558 15.1637 6.33404 14.1828L3.04536 4.45259Z" fill="black" stroke="white" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke fill" transform="translate(-2 -2) scale(2.1)" />';
const CODEX_EXTENSION_ACTIVE_BADGE_MARKER =
  '<image href="data:image/bmp;base64,AA==" width="32" height="32" opacity="0.3" />' +
  CODEX_EXTENSION_ACTIVE_PATH_MARKER;
const CODEX_EXTENSION_DELIVERABLE_BADGE_MARKER = '<circle cx="24" cy="24" r="7" fill="#22c55e" />';
const CODEX_EXTENSION_HANDOFF_BADGE_MARKER = '<circle cx="24" cy="24" r="7" fill="#facc15" />';

function createCodexExtensionMarkerUrl(stateMarker = '') {
  const svg = `<svg data-codex-favicon-badge="codex-favicon-badge">${stateMarker}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

describe('agent-associated tab detection', () => {
  it('recognizes the Codex extension favicon marker without inferring the controller', () => {
    const tab = createTab({ favIconUrl: createCodexExtensionMarkerUrl() });

    expect(detectAgentAssociatedTab(tab, null)).toEqual({
      activity: 'unknown',
      evidence: 'codex-extension-badge',
    });
    expect(isAgentAssociatedTab(tab, null)).toBe(true);
  });

  it.each([
    ['active pointer', CODEX_EXTENSION_ACTIVE_BADGE_MARKER, 'working'],
    ['green deliverable dot', CODEX_EXTENSION_DELIVERABLE_BADGE_MARKER, 'output-ready'],
    ['yellow handoff dot', CODEX_EXTENSION_HANDOFF_BADGE_MARKER, 'waiting-to-continue'],
  ] as const)('recognizes the Codex %s state', (_label, marker, activity) => {
    expect(
      detectAgentAssociatedTab(
        createTab({ favIconUrl: createCodexExtensionMarkerUrl(marker) }),
        null,
      ),
    ).toEqual({
      activity,
      evidence: 'codex-extension-badge',
    });
  });

  it('keeps an unfamiliar or ambiguous Codex marker protected with unknown activity', () => {
    expect(
      detectAgentAssociatedTab(
        createTab({ favIconUrl: createCodexExtensionMarkerUrl('<rect width="4" height="4" />') }),
        null,
      ),
    ).toEqual({
      activity: 'unknown',
      evidence: 'codex-extension-badge',
    });
    expect(
      detectAgentAssociatedTab(
        createTab({
          favIconUrl: createCodexExtensionMarkerUrl(
            `${CODEX_EXTENSION_DELIVERABLE_BADGE_MARKER}${CODEX_EXTENSION_HANDOFF_BADGE_MARKER}`,
          ),
        }),
        null,
      ),
    ).toEqual({
      activity: 'unknown',
      evidence: 'codex-extension-badge',
    });
  });

  it('requires exact direct Codex state artwork and a sentinel on the outer SVG', () => {
    expect(
      detectAgentAssociatedTab(
        createTab({
          favIconUrl: createCodexExtensionMarkerUrl(CODEX_EXTENSION_ACTIVE_PATH_MARKER),
        }),
        null,
      ),
    ).toMatchObject({ activity: 'unknown', evidence: 'codex-extension-badge' });
    expect(
      detectAgentAssociatedTab(
        createTab({
          favIconUrl: createCodexExtensionMarkerUrl(
            `<g>${CODEX_EXTENSION_DELIVERABLE_BADGE_MARKER}</g>`,
          ),
        }),
        null,
      ),
    ).toMatchObject({ activity: 'unknown', evidence: 'codex-extension-badge' });
    expect(
      detectAgentAssociatedTab(
        createTab({
          favIconUrl: createCodexExtensionMarkerUrl(
            '<circle cx="24" cy="24" r="6" fill="#22c55e" />',
          ),
        }),
        null,
      ),
    ).toMatchObject({ activity: 'unknown', evidence: 'codex-extension-badge' });

    const nestedSentinel =
      '<svg><g data-codex-favicon-badge="codex-favicon-badge">' +
      `${CODEX_EXTENSION_DELIVERABLE_BADGE_MARKER}</g></svg>`;
    expect(
      detectAgentAssociatedTab(
        createTab({
          favIconUrl: `data:image/svg+xml,${encodeURIComponent(nestedSentinel)}`,
        }),
        null,
      ),
    ).toBeNull();
  });

  it('does not treat arbitrary or malformed SVG favicons as agent signals', () => {
    expect(
      isAgentAssociatedTab(
        createTab({ favIconUrl: `data:image/svg+xml,${encodeURIComponent('<svg></svg>')}` }),
        null,
      ),
    ).toBe(false);
    expect(
      isAgentAssociatedTab(createTab({ favIconUrl: 'data:image/svg+xml,%not-valid' }), null),
    ).toBe(false);
  });

  it('recognizes the known Claude group title and color pairs', () => {
    const tab = createTab({ groupId: 7 });

    expect(detectAgentAssociatedTab(tab, createGroup())).toEqual({
      activity: 'working',
      evidence: 'claude-known-group',
    });
    expect(
      detectAgentAssociatedTab(tab, createGroup({ color: 'yellow', title: 'Claude (MCP)' })),
    ).toEqual({
      activity: 'unknown',
      evidence: 'claude-known-group',
    });
    expect(isAgentAssociatedTab(tab, createGroup({ color: 'blue' }))).toBe(false);
    expect(isAgentAssociatedTab(tab, createGroup({ title: 'Research task' }))).toBe(false);
    expect(isAgentAssociatedTab(tab, createGroup({ id: 8 }))).toBe(false);
  });

  it.each([
    ['⌛Browser research', 'blue', 'working'],
    ['🔔Approval needed', 'pink', 'awaiting-permission'],
    ['✅Browser research', 'green', 'idle'],
    ['  ⌛\uFE0FNintendo research', 'grey', 'working'],
  ] as const)(
    'recognizes Claude status group %s independently of its generated title and color',
    (title, color, activity) => {
      const detection = detectAgentAssociatedTab(
        createTab({ groupId: 7 }),
        createGroup({ color, title }),
      );

      expect(detection).toEqual({
        activity,
        evidence: 'claude-status-group',
      });
    },
  );

  it('exposes the canonical Claude group matcher for restore provenance decisions', () => {
    expect(hasClaudeAgentGroupSignal(createGroup())).toBe(true);
    expect(hasClaudeAgentGroupSignal(createGroup({ color: 'yellow', title: 'Claude (MCP)' }))).toBe(
      true,
    );
    expect(
      hasClaudeAgentGroupSignal(createGroup({ color: 'blue', title: '✅Browser research' })),
    ).toBe(true);
    expect(hasClaudeAgentGroupSignal(createGroup({ title: 'Restored · Claude' }))).toBe(false);
    expect(hasClaudeAgentGroupSignal(createGroup({ title: 'Restored · ✅Browser research' }))).toBe(
      false,
    );
    expect(hasClaudeAgentGroupSignal(createGroup({ title: 'Planning' }))).toBe(false);
  });

  it('adds durable provenance only when restoring a group with a Claude signal', () => {
    expect(getRestoredGroupTitleWithProvenance(createGroup())).toBe('Restored · Claude');
    expect(
      getRestoredGroupTitleWithProvenance(
        createGroup({ color: 'blue', title: '✅Browser research' }),
      ),
    ).toBe('Restored · ✅Browser research');
    expect(getRestoredGroupTitleWithProvenance(createGroup({ title: 'Planning' }))).toBe(
      'Planning',
    );
    expect(getRestoredGroupTitleWithProvenance(createGroup({ title: 'Restored · Claude' }))).toBe(
      'Restored · Claude',
    );
  });

  it('rejects embedded, bare, and lookalike status emoji group titles', () => {
    const tab = createTab({ groupId: 7 });

    expect(isAgentAssociatedTab(tab, createGroup({ title: 'Research ✅done' }))).toBe(false);
    expect(isAgentAssociatedTab(tab, createGroup({ title: '⌛' }))).toBe(false);
    expect(isAgentAssociatedTab(tab, createGroup({ title: '⏳Research' }))).toBe(false);
  });

  it('keeps conflicting Claude and Codex extension signals protected', () => {
    const tab = createTab({ favIconUrl: createCodexExtensionMarkerUrl(), groupId: 7 });

    expect(detectAgentAssociatedTab(tab, createGroup({ title: '⌛Browser research' }))).toEqual({
      activity: 'unknown',
      evidence: 'conflicting-signals',
    });
  });

  it('ignores Claude evidence from a group that does not contain the marked tab', () => {
    const tab = createTab({ favIconUrl: createCodexExtensionMarkerUrl(), groupId: 8 });

    expect(detectAgentAssociatedTab(tab, createGroup({ id: 7 }))).toEqual({
      activity: 'unknown',
      evidence: 'codex-extension-badge',
    });
  });
});
