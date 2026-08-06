export type AgentActivity =
  | 'awaiting-permission'
  | 'idle'
  | 'output-ready'
  | 'unknown'
  | 'waiting-to-continue'
  | 'working';
export type AgentProviderHint = 'claude' | 'codex' | 'unknown';
export type AgentTabEvidence =
  | 'claude-known-group'
  | 'claude-status-group'
  | 'codex-favicon'
  | 'conflicting-signals';

export interface AgentTabDetection {
  activity: AgentActivity;
  evidence: AgentTabEvidence;
  providerHint: AgentProviderHint;
}

const OPENAI_FAVICON_PREFIX = 'data:image/svg+xml,';
const OPENAI_FAVICON_ATTRIBUTE = 'data-codex-favicon-badge';
const OPENAI_FAVICON_ATTRIBUTE_VALUE = 'codex-favicon-badge';
const OPENAI_ACTIVE_PATH_ATTRIBUTES: Readonly<Record<string, string>> = {
  d: 'M3.04536 4.45259C2.7582 3.60299 3.60299 2.7582 4.45259 3.04536L14.1828 6.33403C15.1637 6.66558 15.0872 8.08006 14.0715 8.39045L10.2994 9.54319C9.93919 9.65327 9.65327 9.93919 9.54319 10.2994L8.39046 14.0715C8.08007 15.0872 6.66558 15.1637 6.33404 14.1828L3.04536 4.45259Z',
  fill: 'black',
  'paint-order': 'stroke fill',
  stroke: 'white',
  'stroke-linejoin': 'round',
  'stroke-width': '1.5',
  transform: 'translate(-2 -2) scale(2.1)',
};
const OPENAI_DELIVERABLE_CIRCLE_ATTRIBUTES: Readonly<Record<string, string>> = {
  cx: '24',
  cy: '24',
  fill: '#22c55e',
  r: '7',
};
const OPENAI_HANDOFF_CIRCLE_ATTRIBUTES: Readonly<Record<string, string>> = {
  cx: '24',
  cy: '24',
  fill: '#facc15',
  r: '7',
};

type AgentTabCandidate = Pick<chrome.tabs.Tab, 'favIconUrl' | 'groupId' | 'windowId'>;
type AgentTabGroupCandidate = Pick<
  chrome.tabGroups.TabGroup,
  'color' | 'id' | 'title' | 'windowId'
>;

function hasDirectChildWithAttributes(
  root: Element,
  localName: string,
  expectedAttributes: Readonly<Record<string, string>>,
): boolean {
  return Array.from(root.children).some(
    (child) =>
      child.localName === localName &&
      Object.entries(expectedAttributes).every(
        ([attribute, value]) => child.getAttribute(attribute) === value,
      ),
  );
}

function detectOpenAiBrowserControlActivity(favIconUrl: string | undefined): AgentActivity | null {
  if (!favIconUrl?.startsWith(OPENAI_FAVICON_PREFIX)) {
    return null;
  }

  try {
    const svg = decodeURIComponent(favIconUrl.slice(OPENAI_FAVICON_PREFIX.length));
    if (!svg.includes(OPENAI_FAVICON_ATTRIBUTE)) {
      return null;
    }

    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    if (
      root.localName !== 'svg' ||
      root.getAttribute(OPENAI_FAVICON_ATTRIBUTE) !== OPENAI_FAVICON_ATTRIBUTE_VALUE
    ) {
      return null;
    }

    const activities: AgentActivity[] = [];
    if (
      hasDirectChildWithAttributes(root, 'image', { opacity: '0.3' }) &&
      hasDirectChildWithAttributes(root, 'path', OPENAI_ACTIVE_PATH_ATTRIBUTES)
    ) {
      activities.push('working');
    }
    if (hasDirectChildWithAttributes(root, 'circle', OPENAI_DELIVERABLE_CIRCLE_ATTRIBUTES)) {
      activities.push('output-ready');
    }
    if (hasDirectChildWithAttributes(root, 'circle', OPENAI_HANDOFF_CIRCLE_ATTRIBUTES)) {
      activities.push('waiting-to-continue');
    }

    return activities.length === 1 ? (activities[0] ?? 'unknown') : 'unknown';
  } catch {
    return null;
  }
}

function detectClaudeGroup(group: AgentTabGroupCandidate | null): AgentTabDetection | null {
  if (!group) {
    return null;
  }

  const title = group.title?.trim() ?? '';
  if (title === 'Claude' && group.color === 'orange') {
    return {
      activity: 'working',
      evidence: 'claude-known-group',
      providerHint: 'claude',
    };
  }
  if (title === 'Claude (MCP)' && group.color === 'yellow') {
    return {
      activity: 'unknown',
      evidence: 'claude-known-group',
      providerHint: 'claude',
    };
  }

  const statusPrefix = /^(⌛|🔔|✅)\uFE0F?(?=\S)/u.exec(title)?.[1];
  if (!statusPrefix) {
    return null;
  }

  const activityByPrefix: Record<string, AgentActivity> = {
    '⌛': 'working',
    '🔔': 'awaiting-permission',
    '✅': 'idle',
  };
  return {
    activity: activityByPrefix[statusPrefix] ?? 'unknown',
    evidence: 'claude-status-group',
    providerHint: 'claude',
  };
}

export function detectAgentAssociatedTab(
  tab: AgentTabCandidate,
  group: AgentTabGroupCandidate | null,
): AgentTabDetection | null {
  const openAiActivity = detectOpenAiBrowserControlActivity(tab.favIconUrl);
  const hasCodexMarker = openAiActivity !== null;
  const groupMatchesTab =
    tab.groupId >= 0 && group?.id === tab.groupId && group.windowId === tab.windowId;
  const claudeDetection = groupMatchesTab ? detectClaudeGroup(group) : null;

  if (hasCodexMarker && claudeDetection) {
    return {
      activity: 'unknown',
      evidence: 'conflicting-signals',
      providerHint: 'unknown',
    };
  }
  if (hasCodexMarker) {
    return {
      activity: openAiActivity,
      evidence: 'codex-favicon',
      providerHint: 'codex',
    };
  }

  if (!claudeDetection) {
    return null;
  }

  return claudeDetection;
}

export function isAgentAssociatedTab(
  tab: AgentTabCandidate,
  group: AgentTabGroupCandidate | null,
): boolean {
  return detectAgentAssociatedTab(tab, group) !== null;
}
