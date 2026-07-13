import {
  type DedupeRule,
  type CanonicalizedTabUrl,
  canonicalizeTabUrl,
  GOOGLE_WORKSPACE_DEDUPE_RULE_IDS,
  type DuplicateKeeperPreference,
  type DuplicateTabCandidate,
  isBuiltInDedupeRule,
  isDedupeRuleValid,
  NOTION_DEDUPE_RULE_IDS,
  planDuplicateTabs,
} from './deduplication';

type BuiltInDedupePresetId = 'google-workspace' | 'notion';

export interface BuiltInDedupePreset {
  comparedAs: string;
  description: string;
  id: BuiltInDedupePresetId;
  name: string;
  ruleIds: readonly string[];
}

export const BUILT_IN_DEDUPE_PRESETS: readonly BuiltInDedupePreset[] = Object.freeze([
  Object.freeze({
    comparedAs: 'docs.google.com/document/d/FILE_ID',
    description:
      'Treat tabs with the same file ID as duplicates. Ignores /edit, query parameters, and page sections.',
    id: 'google-workspace',
    name: 'Google Docs, Sheets & Slides',
    ruleIds: GOOGLE_WORKSPACE_DEDUPE_RULE_IDS,
  }),
  Object.freeze({
    comparedAs: 'notion.com/your-page-path',
    description:
      'Treat tabs with the same page path as duplicates. Ignores query parameters and page sections on notion.so, its subdomains, and notion.com.',
    id: 'notion',
    name: 'Notion',
    ruleIds: NOTION_DEDUPE_RULE_IDS,
  }),
]);

const BUILT_IN_PRESETS_BY_RULE_ID = new Map(
  BUILT_IN_DEDUPE_PRESETS.flatMap((preset) =>
    preset.ruleIds.map((ruleId) => [ruleId, preset] as const),
  ),
);

const STRATEGY_LABELS: Readonly<Record<DedupeRule['comparisonMode'], string>> = {
  'full-path': 'Ignore query and page section',
  host: 'One tab per site (high impact)',
  'path-prefix': 'Stop after the item ID',
};

const STRATEGY_SHORT_NAMES: Readonly<Record<DedupeRule['comparisonMode'], string>> = {
  'full-path': 'Same page',
  host: 'One tab per site',
  'path-prefix': 'Same item',
};

const STRATEGY_DESCRIPTIONS: Readonly<Record<DedupeRule['comparisonMode'], string>> = {
  'full-path': 'Compares the page path and ignores anything beginning with ? or #.',
  host: 'Treats every matching page on the same hostname as one tab.',
  'path-prefix':
    'Uses the last * in the path as the item ID and ignores later path parts, query parameters, and page sections.',
};

function getBuiltInDedupePresetForRule(rule: DedupeRule): BuiltInDedupePreset | null {
  return isBuiltInDedupeRule(rule) ? (BUILT_IN_PRESETS_BY_RULE_ID.get(rule.id) ?? null) : null;
}

export function formatDedupeExampleUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.hostname}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return rawUrl;
  }
}

export interface DedupePreviewTab extends DuplicateTabCandidate {
  title: string;
  windowLabel: string;
}

interface DedupeRuleExample {
  identity: string;
  shadowedByRuleId: string | null;
  tab: DedupePreviewTab;
}

interface DedupePreviewGroup {
  closeTabs: DedupePreviewTab[];
  identity: string;
  keepTab: DedupePreviewTab;
  matchType: 'exact' | 'site-rule';
  ruleId: string | null;
  ruleName: string;
}

function patternHostname(glob: string): string {
  const hostname = glob.trim().split('/')[0]?.replace(/^\*\./u, '').replace(/\*+$/u, '') ?? '';
  return hostname || 'New site rule';
}

export function getDedupeStrategyLabel(comparisonMode: DedupeRule['comparisonMode']): string {
  return STRATEGY_LABELS[comparisonMode];
}

export function getDedupeStrategyDescription(comparisonMode: DedupeRule['comparisonMode']): string {
  return STRATEGY_DESCRIPTIONS[comparisonMode];
}

export function getDedupeRuleDisplayName(rule: DedupeRule): string {
  const builtInPreset = getBuiltInDedupePresetForRule(rule);
  if (builtInPreset) {
    return builtInPreset.name;
  }
  return `${patternHostname(rule.glob)} - ${STRATEGY_SHORT_NAMES[rule.comparisonMode]}`;
}

function getCanonicalIdentity(canonical: CanonicalizedTabUrl): string {
  if (canonical.matchType === 'exact') {
    return canonical.key.slice('exact:'.length);
  }
  const prefix = `site-rule:${canonical.ruleId ?? ''}:`;
  return canonical.key.startsWith(prefix) ? canonical.key.slice(prefix.length) : canonical.key;
}

export function findDedupeRuleExample(
  rule: DedupeRule,
  rules: readonly DedupeRule[],
  tabs: readonly DedupePreviewTab[],
): DedupeRuleExample | null {
  if (!rule.enabled || !isDedupeRuleValid(rule)) {
    return null;
  }
  const tab = tabs.find(
    (candidate) => canonicalizeTabUrl(candidate.url, [rule]).ruleId === rule.id,
  );
  if (!tab) {
    return null;
  }
  const directCanonical = canonicalizeTabUrl(tab.url, [rule]);
  const effectiveCanonical = canonicalizeTabUrl(tab.url, rules);
  return {
    identity: getCanonicalIdentity(directCanonical),
    shadowedByRuleId:
      effectiveCanonical.ruleId === rule.id ? null : (effectiveCanonical.ruleId ?? null),
    tab,
  };
}

export function buildDedupePreview(
  tabs: readonly DedupePreviewTab[],
  rules: readonly DedupeRule[],
  keeperPreference: DuplicateKeeperPreference,
): DedupePreviewGroup[] {
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  return planDuplicateTabs(tabs, rules, keeperPreference).duplicateGroups.flatMap((group) => {
    const keepTab = tabsById.get(group.keeperTabId);
    const closeTabs = group.duplicateTabIds.flatMap((tabId) => {
      const tab = tabsById.get(tabId);
      return tab ? [tab] : [];
    });
    if (!keepTab || closeTabs.length === 0) {
      return [];
    }
    const rule = group.ruleId
      ? rules.find((candidate) => candidate.id === group.ruleId)
      : undefined;
    const canonical = canonicalizeTabUrl(keepTab.url, rules);
    return [
      {
        closeTabs,
        identity: getCanonicalIdentity(canonical),
        keepTab,
        matchType: group.matchType,
        ruleId: group.ruleId,
        ruleName: rule ? getDedupeRuleDisplayName(rule) : 'Exact URL match',
      },
    ];
  });
}
