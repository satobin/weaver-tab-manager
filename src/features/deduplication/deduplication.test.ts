import { describe, expect, it } from 'vitest';

import {
  canonicalizeTabUrl,
  DEFAULT_DEDUPLICATION_RULES,
  deriveItemIdPathSegmentCount,
  isDedupeRuleValid,
  parseDedupeRules,
  planDuplicateTabs,
  type DedupeRule,
  type DuplicateTabCandidate,
  validateDedupeRule,
} from './deduplication';

const ENABLED_PUBLIC_RULES = DEFAULT_DEDUPLICATION_RULES.map((rule) => ({
  ...rule,
  enabled: true,
}));

function createRule(overrides: Partial<DedupeRule> = {}): DedupeRule {
  return {
    comparisonMode: 'full-path',
    enabled: true,
    glob: 'example.com/*',
    id: 'rule-1',
    ...overrides,
  };
}

function createTab(overrides: Partial<DuplicateTabCandidate> = {}): DuplicateTabCandidate {
  return {
    id: 1,
    index: 0,
    url: 'https://example.com/path',
    windowId: 1,
    ...overrides,
  };
}

describe('deduplication rules', () => {
  it('validates patterns and required path-prefix counts', () => {
    expect(isDedupeRuleValid(createRule())).toBe(true);
    expect(validateDedupeRule(createRule({ glob: 'https://example.com/*' })).glob).toBe(
      'Omit the URL scheme.',
    );
    expect(validateDedupeRule(createRule({ glob: 'example.com/*?x=1' })).glob).not.toBeNull();
    expect(validateDedupeRule(createRule({ glob: '/path/*' })).glob).toBe(
      'Start the pattern with a hostname.',
    );
    expect(validateDedupeRule(createRule({ glob: 'example.com' })).glob).toBe(
      'Add a path such as /* after the hostname.',
    );
    expect(validateDedupeRule(createRule({ glob: 'example.com*' })).glob).toBe(
      'Add a path such as /* after the hostname.',
    );
    expect(validateDedupeRule(createRule({ glob: 'example.com*/*' })).glob).toBe(
      'Use an exact hostname or a whole-label wildcard such as *.example.com/*.',
    );
    expect(isDedupeRuleValid(createRule({ glob: '*.example.com/*' }))).toBe(true);
    expect(
      validateDedupeRule(createRule({ comparisonMode: 'path-prefix', pathSegmentCount: 0 }))
        .pathSegmentCount,
    ).not.toBeNull();
  });

  it('sanitizes stored rules, removes duplicate IDs, and preserves an empty list', () => {
    expect(
      parseDedupeRules([
        createRule(),
        createRule({ glob: 'other.test/*' }),
        { ...createRule({ id: 'rule-2' }), comparisonMode: 'unknown' },
      ]),
    ).toEqual([createRule()]);
    expect(parseDedupeRules([])).toEqual([]);
    expect(parseDedupeRules('invalid')).toBeNull();
  });

  it('derives the item-ID cutoff from the last wildcard in a custom path', () => {
    expect(deriveItemIdPathSegmentCount('app.example.com/items/*')).toBe(2);
    expect(deriveItemIdPathSegmentCount('app.example.com/workspaces/*/items/*')).toBe(4);
    expect(deriveItemIdPathSegmentCount('app.example.com')).toBe(1);
  });
});

describe('canonicalizeTabUrl', () => {
  it('matches hostname plus path and ignores query and fragment in site-rule modes', () => {
    const rule = createRule();
    expect(canonicalizeTabUrl('https://example.com/path?view=1#section', [rule])).toEqual({
      key: 'site-rule:rule-1:example.com/path',
      matchType: 'site-rule',
      ruleId: 'rule-1',
    });
  });

  it('supports host-only and first-N-path-segment comparisons', () => {
    expect(
      canonicalizeTabUrl('https://example.com/a/b/c?view=1', [
        createRule({ comparisonMode: 'host' }),
      ]).key,
    ).toBe('site-rule:rule-1:example.com');
    expect(
      canonicalizeTabUrl('https://example.com/a/b/c?view=1', [
        createRule({ comparisonMode: 'path-prefix', pathSegmentCount: 2 }),
      ]).key,
    ).toBe('site-rule:rule-1:example.com/a/b');
  });

  it('uses the first enabled matching rule', () => {
    const broad = createRule({ comparisonMode: 'host', glob: 'example.com/*', id: 'broad' });
    const narrow = createRule({ glob: 'example.com/projects/*', id: 'narrow' });
    expect(canonicalizeTabUrl('https://example.com/projects/one', [broad, narrow]).ruleId).toBe(
      'broad',
    );
    expect(
      canonicalizeTabUrl('https://example.com/projects/one', [{ ...broad, enabled: false }, narrow])
        .ruleId,
    ).toBe('narrow');
  });

  it('keeps exact and wildcard hostname matches on label boundaries', () => {
    const exact = createRule({ glob: 'example.com/*', id: 'exact-host' });
    const wildcard = createRule({ glob: '*.example.com/*', id: 'subdomains' });

    expect(canonicalizeTabUrl('https://example.com/path', [exact]).ruleId).toBe('exact-host');
    expect(canonicalizeTabUrl('https://example.com.evil/path', [exact]).matchType).toBe('exact');
    expect(canonicalizeTabUrl('https://sub.example.com/path', [wildcard]).ruleId).toBe(
      'subdomains',
    );
    expect(canonicalizeTabUrl('https://deep.sub.example.com/path', [wildcard]).ruleId).toBe(
      'subdomains',
    );
    expect(canonicalizeTabUrl('https://example.com/path', [wildcard]).matchType).toBe('exact');
    expect(canonicalizeTabUrl('https://notexample.com/path', [wildcard]).matchType).toBe('exact');
  });

  it('falls back to the exact raw URL for unmatched, non-web, and invalid URLs', () => {
    expect(canonicalizeTabUrl('https://other.test/?x=1#top', []).key).toBe(
      'exact:https://other.test/?x=1#top',
    );
    expect(canonicalizeTabUrl('chrome://settings/', [createRule({ glob: '*' })]).matchType).toBe(
      'exact',
    );
    expect(canonicalizeTabUrl('not a URL', [createRule({ glob: '*' })]).key).toBe(
      'exact:not a URL',
    );
  });

  it('ships opt-in Google and Notion rules without site-specific private tooling', () => {
    expect(DEFAULT_DEDUPLICATION_RULES.every((rule) => !rule.enabled)).toBe(true);
    const googleEdit = canonicalizeTabUrl(
      'https://docs.google.com/document/d/doc-id/edit?tab=t.0',
      ENABLED_PUBLIC_RULES,
    );
    const googleHeading = canonicalizeTabUrl(
      'https://docs.google.com/document/d/doc-id/edit#heading=h.one',
      ENABLED_PUBLIC_RULES,
    );
    expect(googleEdit.key).toBe(googleHeading.key);
    expect(googleEdit.ruleId).toBe('builtin-google-docs');
    expect(
      canonicalizeTabUrl('https://docs.google.com/forms/d/form-id/edit', ENABLED_PUBLIC_RULES)
        .matchType,
    ).toBe('exact');
    expect(
      canonicalizeTabUrl('https://mail.google.com/mail/u/0/', ENABLED_PUBLIC_RULES).matchType,
    ).toBe('exact');

    const notionOne = canonicalizeTabUrl(
      'https://www.notion.so/workspace/Page-abc?pvs=4#block',
      ENABLED_PUBLIC_RULES,
    );
    const notionTwo = canonicalizeTabUrl(
      'https://www.notion.so/workspace/Page-abc?source=copy_link',
      ENABLED_PUBLIC_RULES,
    );
    expect(notionOne.key).toBe(notionTwo.key);

    const notionComOne = canonicalizeTabUrl(
      'https://notion.com/p/acme/Project-Plan-3098e50b62b080f9a0a7f74cb093713f?showMoveTo=true#block-one',
      ENABLED_PUBLIC_RULES,
    );
    const notionComTwo = canonicalizeTabUrl(
      'https://notion.com/p/acme/Project-Plan-3098e50b62b080f9a0a7f74cb093713f?saveParent=true#block-two',
      ENABLED_PUBLIC_RULES,
    );
    expect(notionComOne.key).toBe(notionComTwo.key);
    expect(notionComOne.ruleId).toBe('builtin-notion-com');

    expect(
      canonicalizeTabUrl(
        'https://ci.example.com/acme/widgets/builds/42/list?tab=output',
        ENABLED_PUBLIC_RULES,
      ).matchType,
    ).toBe('exact');
  });

  it.each([
    ['document', 'builtin-google-docs'],
    ['spreadsheets', 'builtin-google-sheets'],
    ['presentation', 'builtin-google-slides'],
  ] as const)('matches Google %s document identities with %s', (kind, ruleId) => {
    const first = canonicalizeTabUrl(
      `https://docs.google.com/${kind}/d/item-id/edit?view=one`,
      ENABLED_PUBLIC_RULES,
    );
    const second = canonicalizeTabUrl(
      `https://docs.google.com/${kind}/d/item-id/preview#section`,
      ENABLED_PUBLIC_RULES,
    );
    expect(first.key).toBe(second.key);
    expect(first.ruleId).toBe(ruleId);
  });
});

describe('planDuplicateTabs', () => {
  it('prefers the active matching tab in the current window and preserves close order', () => {
    const tabs = [
      createTab({ id: 1, windowId: 2 }),
      createTab({ id: 2, index: 0, windowId: 1 }),
      createTab({ id: 3, index: 1, windowId: 1 }),
      createTab({ id: 4, url: 'https://unique.test', windowId: 2 }),
    ];

    expect(planDuplicateTabs(tabs, [], { tabId: 3, windowId: 1 })).toEqual({
      duplicateGroups: [
        {
          duplicateTabIds: [1, 2],
          keeperTabId: 3,
          key: 'exact:https://example.com/path',
          matchType: 'exact',
          ruleId: null,
        },
      ],
      duplicateTabIds: [1, 2],
      keeperTabIds: [3],
    });
  });

  it('uses input order without a preferred-window match and skips tabs without URLs', () => {
    const plan = planDuplicateTabs(
      [
        createTab({ id: 8, windowId: 8 }),
        createTab({ id: 9, windowId: 9 }),
        createTab({ id: 10, url: '' }),
      ],
      [],
      { windowId: 99 },
    );
    expect(plan.keeperTabIds).toEqual([8]);
    expect(plan.duplicateTabIds).toEqual([9]);
  });

  it('groups site-rule matches while keeping exact fallback query-sensitive', () => {
    const rule = createRule({ comparisonMode: 'host' });
    const plan = planDuplicateTabs(
      [
        createTab({ id: 1, url: 'https://example.com/a?x=1' }),
        createTab({ id: 2, url: 'https://example.com/b?x=2' }),
        createTab({ id: 3, url: 'https://other.test/?x=1' }),
        createTab({ id: 4, url: 'https://other.test/?x=2' }),
      ],
      [rule],
    );
    expect(plan.duplicateTabIds).toEqual([2]);
    expect(plan.duplicateGroups[0]).toMatchObject({ matchType: 'site-rule', ruleId: 'rule-1' });
  });
});
