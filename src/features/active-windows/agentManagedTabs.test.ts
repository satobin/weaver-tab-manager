import { describe, expect, it } from 'vitest';

import { detectAgentAssociatedTab, isAgentAssociatedTab } from './agentManagedTabs';

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

const OPENAI_ACTIVE_PATH_MARKER =
  '<path d="M3.04536 4.45259C2.7582 3.60299 3.60299 2.7582 4.45259 3.04536L14.1828 6.33403C15.1637 6.66558 15.0872 8.08006 14.0715 8.39045L10.2994 9.54319C9.93919 9.65327 9.65327 9.93919 9.54319 10.2994L8.39046 14.0715C8.08007 15.0872 6.66558 15.1637 6.33404 14.1828L3.04536 4.45259Z" fill="black" stroke="white" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke fill" transform="translate(-2 -2) scale(2.1)" />';
const OPENAI_ACTIVE_BADGE_MARKER =
  '<image href="data:image/bmp;base64,AA==" width="32" height="32" opacity="0.3" />' +
  OPENAI_ACTIVE_PATH_MARKER;
const OPENAI_DELIVERABLE_BADGE_MARKER = '<circle cx="24" cy="24" r="7" fill="#22c55e" />';
const OPENAI_HANDOFF_BADGE_MARKER = '<circle cx="24" cy="24" r="7" fill="#facc15" />';

function createOpenAiMarkerUrl(stateMarker = '') {
  const svg = `<svg data-codex-favicon-badge="codex-favicon-badge">${stateMarker}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

describe('agent-managed tab detection', () => {
  it('recognizes the Codex browser-control favicon marker with provider evidence', () => {
    const tab = createTab({ favIconUrl: createOpenAiMarkerUrl() });

    expect(detectAgentAssociatedTab(tab, null)).toEqual({
      activity: 'unknown',
      evidence: 'codex-favicon',
      providerHint: 'codex',
    });
    expect(isAgentAssociatedTab(tab, null)).toBe(true);
  });

  it.each([
    ['active pointer', OPENAI_ACTIVE_BADGE_MARKER, 'working'],
    ['green deliverable dot', OPENAI_DELIVERABLE_BADGE_MARKER, 'output-ready'],
    ['yellow handoff dot', OPENAI_HANDOFF_BADGE_MARKER, 'waiting-to-continue'],
  ] as const)('recognizes the Codex %s state', (_label, marker, activity) => {
    expect(
      detectAgentAssociatedTab(createTab({ favIconUrl: createOpenAiMarkerUrl(marker) }), null),
    ).toEqual({
      activity,
      evidence: 'codex-favicon',
      providerHint: 'codex',
    });
  });

  it('keeps an unfamiliar or ambiguous Codex marker protected with unknown activity', () => {
    expect(
      detectAgentAssociatedTab(
        createTab({ favIconUrl: createOpenAiMarkerUrl('<rect width="4" height="4" />') }),
        null,
      ),
    ).toEqual({
      activity: 'unknown',
      evidence: 'codex-favicon',
      providerHint: 'codex',
    });
    expect(
      detectAgentAssociatedTab(
        createTab({
          favIconUrl: createOpenAiMarkerUrl(
            `${OPENAI_DELIVERABLE_BADGE_MARKER}${OPENAI_HANDOFF_BADGE_MARKER}`,
          ),
        }),
        null,
      ),
    ).toEqual({
      activity: 'unknown',
      evidence: 'codex-favicon',
      providerHint: 'codex',
    });
  });

  it('requires exact direct Codex state artwork and a sentinel on the outer SVG', () => {
    expect(
      detectAgentAssociatedTab(
        createTab({ favIconUrl: createOpenAiMarkerUrl(OPENAI_ACTIVE_PATH_MARKER) }),
        null,
      ),
    ).toMatchObject({ activity: 'unknown', providerHint: 'codex' });
    expect(
      detectAgentAssociatedTab(
        createTab({
          favIconUrl: createOpenAiMarkerUrl(`<g>${OPENAI_DELIVERABLE_BADGE_MARKER}</g>`),
        }),
        null,
      ),
    ).toMatchObject({ activity: 'unknown', providerHint: 'codex' });
    expect(
      detectAgentAssociatedTab(
        createTab({
          favIconUrl: createOpenAiMarkerUrl('<circle cx="24" cy="24" r="6" fill="#22c55e" />'),
        }),
        null,
      ),
    ).toMatchObject({ activity: 'unknown', providerHint: 'codex' });

    const nestedSentinel =
      '<svg><g data-codex-favicon-badge="codex-favicon-badge">' +
      `${OPENAI_DELIVERABLE_BADGE_MARKER}</g></svg>`;
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
      providerHint: 'claude',
    });
    expect(
      detectAgentAssociatedTab(tab, createGroup({ color: 'yellow', title: 'Claude (MCP)' })),
    ).toEqual({
      activity: 'unknown',
      evidence: 'claude-known-group',
      providerHint: 'claude',
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
        providerHint: 'claude',
      });
    },
  );

  it('rejects embedded, bare, and lookalike status emoji group titles', () => {
    const tab = createTab({ groupId: 7 });

    expect(isAgentAssociatedTab(tab, createGroup({ title: 'Research ✅done' }))).toBe(false);
    expect(isAgentAssociatedTab(tab, createGroup({ title: '⌛' }))).toBe(false);
    expect(isAgentAssociatedTab(tab, createGroup({ title: '⏳Research' }))).toBe(false);
  });

  it('keeps conflicting Claude and Codex signals protected without claiming a provider', () => {
    const tab = createTab({ favIconUrl: createOpenAiMarkerUrl(), groupId: 7 });

    expect(detectAgentAssociatedTab(tab, createGroup({ title: '⌛Browser research' }))).toEqual({
      activity: 'unknown',
      evidence: 'conflicting-signals',
      providerHint: 'unknown',
    });
  });

  it('ignores Claude evidence from a group that does not contain the Codex tab', () => {
    const tab = createTab({ favIconUrl: createOpenAiMarkerUrl(), groupId: 8 });

    expect(detectAgentAssociatedTab(tab, createGroup({ id: 7 }))).toEqual({
      activity: 'unknown',
      evidence: 'codex-favicon',
      providerHint: 'codex',
    });
  });
});
