const OPENAI_FAVICON_PREFIX = 'data:image/svg+xml,';
const OPENAI_FAVICON_MARKER = 'data-codex-favicon-badge="codex-favicon-badge"';

type AgentTabCandidate = Pick<chrome.tabs.Tab, 'favIconUrl' | 'groupId' | 'windowId'>;
type AgentTabGroupCandidate = Pick<
  chrome.tabGroups.TabGroup,
  'color' | 'id' | 'title' | 'windowId'
>;

function hasOpenAiBrowserControlMarker(favIconUrl: string | undefined): boolean {
  if (!favIconUrl?.startsWith(OPENAI_FAVICON_PREFIX)) {
    return false;
  }

  try {
    return decodeURIComponent(favIconUrl.slice(OPENAI_FAVICON_PREFIX.length)).includes(
      OPENAI_FAVICON_MARKER,
    );
  } catch {
    return false;
  }
}

function isKnownClaudeGroup(group: AgentTabGroupCandidate | null): boolean {
  if (!group) {
    return false;
  }

  return (
    (group.title?.trim() === 'Claude' && group.color === 'orange') ||
    (group.title?.trim() === 'Claude (MCP)' && group.color === 'yellow')
  );
}

export function isAgentAssociatedTab(
  tab: AgentTabCandidate,
  group: AgentTabGroupCandidate | null,
): boolean {
  if (hasOpenAiBrowserControlMarker(tab.favIconUrl)) {
    return true;
  }

  return (
    tab.groupId >= 0 &&
    group?.id === tab.groupId &&
    group.windowId === tab.windowId &&
    isKnownClaudeGroup(group)
  );
}
