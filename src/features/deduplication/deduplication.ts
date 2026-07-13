type DuplicateComparisonMode = 'host' | 'path-prefix' | 'full-path';

export interface DedupeRule {
  comparisonMode: DuplicateComparisonMode;
  enabled: boolean;
  glob: string;
  id: string;
  pathSegmentCount?: number;
}

export interface DedupeRuleValidation {
  glob: string | null;
  id: string | null;
  pathSegmentCount: string | null;
}

export interface CanonicalizedTabUrl {
  key: string;
  matchType: 'exact' | 'site-rule';
  ruleId: string | null;
}

export interface DuplicateTabCandidate {
  id: number;
  index: number;
  url: string;
  windowId: number;
}

interface DuplicateTabGroup {
  duplicateTabIds: number[];
  keeperTabId: number;
  key: string;
  matchType: 'exact' | 'site-rule';
  ruleId: string | null;
}

export interface DuplicateTabPlan {
  duplicateGroups: DuplicateTabGroup[];
  duplicateTabIds: number[];
  keeperTabIds: number[];
}

export interface DuplicateKeeperPreference {
  tabId?: number | undefined;
  windowId?: number | undefined;
}

const COMPARISON_MODES = new Set<DuplicateComparisonMode>(['host', 'path-prefix', 'full-path']);

export const GOOGLE_WORKSPACE_DEDUPE_RULE_IDS = [
  'builtin-google-docs',
  'builtin-google-sheets',
  'builtin-google-slides',
] as const;

export const NOTION_DEDUPE_RULE_IDS = [
  'builtin-notion-root',
  'builtin-notion-subdomains',
  'builtin-notion-com',
] as const;

export const DEFAULT_DEDUPLICATION_RULES: readonly DedupeRule[] = Object.freeze([
  Object.freeze({
    comparisonMode: 'path-prefix',
    enabled: false,
    glob: 'docs.google.com/document/d/*',
    id: GOOGLE_WORKSPACE_DEDUPE_RULE_IDS[0],
    pathSegmentCount: 3,
  }),
  Object.freeze({
    comparisonMode: 'path-prefix',
    enabled: false,
    glob: 'docs.google.com/spreadsheets/d/*',
    id: GOOGLE_WORKSPACE_DEDUPE_RULE_IDS[1],
    pathSegmentCount: 3,
  }),
  Object.freeze({
    comparisonMode: 'path-prefix',
    enabled: false,
    glob: 'docs.google.com/presentation/d/*',
    id: GOOGLE_WORKSPACE_DEDUPE_RULE_IDS[2],
    pathSegmentCount: 3,
  }),
  Object.freeze({
    comparisonMode: 'full-path',
    enabled: false,
    glob: 'notion.so/*',
    id: NOTION_DEDUPE_RULE_IDS[0],
  }),
  Object.freeze({
    comparisonMode: 'full-path',
    enabled: false,
    glob: '*.notion.so/*',
    id: NOTION_DEDUPE_RULE_IDS[1],
  }),
  Object.freeze({
    comparisonMode: 'full-path',
    enabled: false,
    glob: 'notion.com/*',
    id: NOTION_DEDUPE_RULE_IDS[2],
  }),
]);

const DEFAULT_RULES_BY_ID = new Map(DEFAULT_DEDUPLICATION_RULES.map((rule) => [rule.id, rule]));

export function cloneDedupeRules(rules: readonly DedupeRule[]): DedupeRule[] {
  return rules.map((rule) => ({ ...rule }));
}

function rulesHaveSameShape(first: DedupeRule, second: DedupeRule): boolean {
  return (
    first.comparisonMode === second.comparisonMode &&
    first.glob === second.glob &&
    first.id === second.id &&
    first.pathSegmentCount === second.pathSegmentCount
  );
}

export function isBuiltInDedupeRule(rule: DedupeRule): boolean {
  const defaultRule = DEFAULT_RULES_BY_ID.get(rule.id);
  return defaultRule !== undefined && rulesHaveSameShape(rule, defaultRule);
}

export function orderBuiltInDedupeRulesFirst(rules: readonly DedupeRule[]): DedupeRule[] {
  const builtInsById = new Map(
    rules.filter(isBuiltInDedupeRule).map((rule) => [rule.id, { ...rule }]),
  );
  const customRules = rules
    .filter((rule) => !isBuiltInDedupeRule(rule))
    .map((rule) => ({ ...rule }));
  return [
    ...DEFAULT_DEDUPLICATION_RULES.flatMap((defaultRule) => {
      const rule = builtInsById.get(defaultRule.id);
      return rule ? [rule] : [];
    }),
    ...customRules,
  ];
}

export function deriveItemIdPathSegmentCount(glob: string): number {
  const pathSegments = glob.trim().split('/').slice(1).filter(Boolean);
  let itemIdIndex = -1;
  pathSegments.forEach((segment, index) => {
    if (segment.includes('*')) {
      itemIdIndex = index;
    }
  });
  const count = itemIdIndex >= 0 ? itemIdIndex + 1 : pathSegments.length;
  return Math.min(20, Math.max(1, count));
}

interface ParsedDedupePattern {
  hostname: string;
  hostnameWildcard: boolean;
  path: string;
}

function isValidHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253) {
    return false;
  }
  return hostname.split('.').every((label) => {
    if (!label || label.length > 63) {
      return false;
    }
    return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label);
  });
}

function parseDedupePattern(glob: string): ParsedDedupePattern | null {
  const normalized = glob.trim();
  const pathStart = normalized.indexOf('/');
  if (pathStart <= 0) {
    return null;
  }

  const hostnamePattern = normalized.slice(0, pathStart).toLowerCase();
  const path = normalized.slice(pathStart);
  const hostnameWildcard = hostnamePattern.startsWith('*.');
  const hostname = hostnameWildcard ? hostnamePattern.slice(2) : hostnamePattern;
  if (
    hostname.includes('*') ||
    (!hostnameWildcard && hostnamePattern.includes('*')) ||
    !isValidHostname(hostname)
  ) {
    return null;
  }

  return { hostname, hostnameWildcard, path };
}

export function validateDedupeRule(rule: DedupeRule): DedupeRuleValidation {
  const id = rule.id.trim();
  const glob = rule.glob.trim();
  let globError: string | null = null;
  let pathSegmentCountError: string | null = null;

  if (!glob) {
    globError = 'Enter a hostname and optional path pattern.';
  } else if (glob.length > 512) {
    globError = 'Keep the pattern under 512 characters.';
  } else if (glob.includes('://')) {
    globError = 'Omit the URL scheme.';
  } else if (/[\s\\?#]/u.test(glob)) {
    globError = 'Patterns cannot contain spaces, query strings, fragments, or backslashes.';
  } else if (glob.startsWith('/')) {
    globError = 'Start the pattern with a hostname.';
  } else if (!glob.includes('/')) {
    globError = 'Add a path such as /* after the hostname.';
  } else if (!parseDedupePattern(glob)) {
    globError = 'Use an exact hostname or a whole-label wildcard such as *.example.com/*.';
  }

  if (
    rule.comparisonMode === 'path-prefix' &&
    (!Number.isInteger(rule.pathSegmentCount) ||
      (rule.pathSegmentCount ?? 0) < 1 ||
      (rule.pathSegmentCount ?? 0) > 20)
  ) {
    pathSegmentCountError = 'Choose between 1 and 20 path segments.';
  }

  return {
    glob: globError,
    id: id && id.length <= 128 ? null : 'The rule ID is invalid.',
    pathSegmentCount: pathSegmentCountError,
  };
}

export function isDedupeRuleValid(rule: DedupeRule): boolean {
  const validation = validateDedupeRule(rule);
  return Object.values(validation).every((error) => error === null);
}

function parseDedupeRule(value: unknown): DedupeRule | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.enabled !== 'boolean' ||
    typeof candidate.glob !== 'string' ||
    typeof candidate.comparisonMode !== 'string' ||
    !COMPARISON_MODES.has(candidate.comparisonMode as DuplicateComparisonMode)
  ) {
    return null;
  }

  const rule: DedupeRule = {
    comparisonMode: candidate.comparisonMode as DuplicateComparisonMode,
    enabled: candidate.enabled,
    glob: candidate.glob.trim(),
    id: candidate.id.trim(),
  };
  if (rule.comparisonMode === 'path-prefix') {
    rule.pathSegmentCount =
      typeof candidate.pathSegmentCount === 'number' ? candidate.pathSegmentCount : 0;
  }

  return isDedupeRuleValid(rule) ? rule : null;
}

export function parseDedupeRules(value: unknown): DedupeRule[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const ids = new Set<string>();
  const rules: DedupeRule[] = [];
  value.forEach((candidate) => {
    const rule = parseDedupeRule(candidate);
    if (rule && !ids.has(rule.id)) {
      ids.add(rule.id);
      rules.push(rule);
    }
  });
  return rules;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function compileGlob(glob: string): RegExp {
  const parsed = parseDedupePattern(glob);
  if (!parsed) {
    throw new Error('Cannot compile an invalid duplicate-rule pattern.');
  }
  const hostnameSource = parsed.hostnameWildcard
    ? `(?:[^./]+\\.)+${escapeRegularExpression(parsed.hostname)}`
    : escapeRegularExpression(parsed.hostname);
  const pathSource = parsed.path.split('*').map(escapeRegularExpression).join('.*');
  return new RegExp(`^${hostnameSource}${pathSource}$`, 'u');
}

interface CompiledRule {
  expression: RegExp;
  rule: DedupeRule;
}

function compileRules(rules: readonly DedupeRule[]): CompiledRule[] {
  return rules.flatMap((rule) =>
    rule.enabled && isDedupeRuleValid(rule) ? [{ expression: compileGlob(rule.glob), rule }] : [],
  );
}

function canonicalizeWithRules(
  rawUrl: string,
  rules: readonly CompiledRule[],
): CanonicalizedTabUrl {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { key: `exact:${rawUrl}`, matchType: 'exact', ruleId: null };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { key: `exact:${rawUrl}`, matchType: 'exact', ruleId: null };
  }

  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname || '/';
  const target = `${hostname}${pathname}`;
  const compiledRule = rules.find(({ expression }) => expression.test(target));
  if (!compiledRule) {
    return { key: `exact:${rawUrl}`, matchType: 'exact', ruleId: null };
  }

  const { rule } = compiledRule;
  let comparisonValue: string;
  switch (rule.comparisonMode) {
    case 'host':
      comparisonValue = hostname;
      break;
    case 'path-prefix': {
      const pathSegments = pathname.split('/').filter(Boolean);
      comparisonValue = `${hostname}/${pathSegments.slice(0, rule.pathSegmentCount).join('/')}`;
      break;
    }
    case 'full-path':
      comparisonValue = `${hostname}${pathname}`;
      break;
  }

  return {
    key: `site-rule:${rule.id}:${comparisonValue}`,
    matchType: 'site-rule',
    ruleId: rule.id,
  };
}

export function canonicalizeTabUrl(
  rawUrl: string,
  rules: readonly DedupeRule[],
): CanonicalizedTabUrl {
  return canonicalizeWithRules(rawUrl, compileRules(rules));
}

export function planDuplicateTabs(
  tabs: readonly DuplicateTabCandidate[],
  rules: readonly DedupeRule[],
  keeperPreference: DuplicateKeeperPreference = {},
): DuplicateTabPlan {
  const compiledRules = compileRules(rules);
  const buckets = new Map<
    string,
    { canonical: CanonicalizedTabUrl; tabs: DuplicateTabCandidate[] }
  >();

  tabs.forEach((tab) => {
    if (!tab.url) {
      return;
    }
    const canonical = canonicalizeWithRules(tab.url, compiledRules);
    const bucket = buckets.get(canonical.key) ?? { canonical, tabs: [] };
    bucket.tabs.push(tab);
    buckets.set(canonical.key, bucket);
  });

  const duplicateGroups: DuplicateTabGroup[] = [];
  const duplicateIds = new Set<number>();
  const keeperTabIds: number[] = [];
  buckets.forEach(({ canonical, tabs: matchingTabs }) => {
    if (matchingTabs.length < 2) {
      return;
    }
    const keeper =
      matchingTabs.find((tab) => tab.id === keeperPreference.tabId) ??
      matchingTabs.find((tab) => tab.windowId === keeperPreference.windowId) ??
      matchingTabs[0];
    if (!keeper) {
      return;
    }
    const duplicateTabIds = matchingTabs.filter((tab) => tab.id !== keeper.id).map((tab) => tab.id);
    duplicateTabIds.forEach((tabId) => duplicateIds.add(tabId));
    keeperTabIds.push(keeper.id);
    duplicateGroups.push({
      duplicateTabIds,
      keeperTabId: keeper.id,
      key: canonical.key,
      matchType: canonical.matchType,
      ruleId: canonical.ruleId,
    });
  });

  return {
    duplicateGroups,
    duplicateTabIds: tabs.flatMap((tab) => (duplicateIds.has(tab.id) ? [tab.id] : [])),
    keeperTabIds,
  };
}
