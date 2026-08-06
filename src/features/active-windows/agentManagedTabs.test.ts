import { describe, expect, it } from 'vitest';

import { isAgentAssociatedTab } from './agentManagedTabs';

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

function createOpenAiMarkerUrl() {
  const svg = '<svg data-codex-favicon-badge="codex-favicon-badge"></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

describe('agent-managed tab detection', () => {
  it('recognizes the OpenAI browser-control favicon marker', () => {
    expect(isAgentAssociatedTab(createTab({ favIconUrl: createOpenAiMarkerUrl() }), null)).toBe(
      true,
    );
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

  it('recognizes only the known Claude group title and color pairs', () => {
    const tab = createTab({ groupId: 7 });

    expect(isAgentAssociatedTab(tab, createGroup())).toBe(true);
    expect(isAgentAssociatedTab(tab, createGroup({ color: 'yellow', title: 'Claude (MCP)' }))).toBe(
      true,
    );
    expect(isAgentAssociatedTab(tab, createGroup({ color: 'blue' }))).toBe(false);
    expect(isAgentAssociatedTab(tab, createGroup({ title: 'Research task' }))).toBe(false);
    expect(isAgentAssociatedTab(tab, createGroup({ id: 8 }))).toBe(false);
  });
});
