import { describe, expect, it } from 'vitest';

import { type DedupeRule, DEFAULT_DEDUPLICATION_RULES } from './deduplication';
import {
  BUILT_IN_DEDUPE_PRESETS,
  buildDedupePreview,
  findDedupeRuleExample,
  formatDedupeExampleUrl,
  getDedupeRuleDisplayName,
  getDedupeStrategyLabel,
  type DedupePreviewTab,
} from './dedupeRulePresentation';

function createRule(overrides: Partial<DedupeRule> = {}): DedupeRule {
  return {
    comparisonMode: 'full-path',
    enabled: true,
    glob: 'app.example.com/*',
    id: 'custom',
    ...overrides,
  };
}

function createTab(overrides: Partial<DedupePreviewTab> = {}): DedupePreviewTab {
  return {
    id: 1,
    index: 0,
    title: 'Example',
    url: 'https://app.example.com/projects/42?view=one',
    windowId: 1,
    windowLabel: 'Current Window',
    ...overrides,
  };
}

describe('dedupe rule presentation', () => {
  it('gives built-in and custom rules outcome-based names', () => {
    expect(getDedupeRuleDisplayName(DEFAULT_DEDUPLICATION_RULES[0] as DedupeRule)).toBe(
      'Google Docs, Sheets & Slides',
    );
    expect(
      getDedupeRuleDisplayName(
        DEFAULT_DEDUPLICATION_RULES.find((rule) => rule.id === 'builtin-notion-com') as DedupeRule,
      ),
    ).toBe('Notion');
    expect(getDedupeRuleDisplayName(createRule())).toBe('app.example.com - Same page');
    expect(
      getDedupeRuleDisplayName(
        createRule({ comparisonMode: 'host', glob: 'app.example.com/*', id: 'broad' }),
      ),
    ).toBe('app.example.com - One tab per site');
    expect(getDedupeStrategyLabel('host')).toBe('One tab per site (high impact)');
    expect(getDedupeStrategyLabel('full-path')).toBe('Ignore query and page section');
    expect(getDedupeStrategyLabel('path-prefix')).toBe('Stop after the item ID');
    expect(BUILT_IN_DEDUPE_PRESETS.map((preset) => preset.name)).toEqual([
      'Google Docs, Sheets & Slides',
      'Notion',
    ]);
  });

  it('formats an open URL for the Original and Compared as explanation', () => {
    expect(formatDedupeExampleUrl('https://app.example.com/projects/42?view=one#summary')).toBe(
      'app.example.com/projects/42?view=one#summary',
    );
  });

  it('shows when an earlier broad rule handles a matching open tab first', () => {
    const broad = createRule({ comparisonMode: 'host', glob: 'app.example.com/*', id: 'broad' });
    const narrow = createRule({ glob: 'app.example.com/projects/*', id: 'narrow' });

    expect(findDedupeRuleExample(narrow, [broad, narrow], [createTab()])).toEqual({
      identity: 'app.example.com/projects/42',
      shadowedByRuleId: 'broad',
      tab: createTab(),
    });
  });

  it('previews the keeper and tabs that would close', () => {
    const rule = createRule();
    const tabs = [
      createTab({ id: 1, windowId: 2, windowLabel: 'Window 1' }),
      createTab({ id: 2, index: 1, title: 'Active copy' }),
      createTab({ id: 3, index: 2, title: 'Another copy' }),
    ];

    expect(buildDedupePreview(tabs, [rule], { tabId: 2, windowId: 1 })).toEqual([
      {
        closeTabs: [tabs[0], tabs[2]],
        identity: 'app.example.com/projects/42',
        keepTab: tabs[1],
        matchType: 'site-rule',
        ruleId: 'custom',
        ruleName: 'app.example.com - Same page',
      },
    ]);
  });
});
