import { describe, expect, it, vi } from 'vitest';

import { type DedupeRule, DEFAULT_DEDUPLICATION_RULES } from './deduplication';
import {
  CUSTOM_RULE_TRANSFER_FORMAT,
  CUSTOM_RULE_TRANSFER_VERSION,
  MAX_CUSTOM_RULE_TRANSFER_BYTES,
  MAX_IMPORTED_CUSTOM_RULES,
  materializeImportedCustomRules,
  parseCustomRuleTransfer,
  serializeCustomRuleTransfer,
} from './customRuleTransfer';

function transferFile(rules: unknown[]) {
  return JSON.stringify({
    format: CUSTOM_RULE_TRANSFER_FORMAT,
    version: CUSTOM_RULE_TRANSFER_VERSION,
    rules,
  });
}

describe('custom rule transfer', () => {
  it('serializes only custom behavior without internal rule IDs', () => {
    const customRules: DedupeRule[] = [
      {
        comparisonMode: 'full-path',
        enabled: true,
        glob: 'app.example.com/items/*',
        id: 'private-custom-id',
      },
      {
        comparisonMode: 'host',
        enabled: false,
        glob: 'mail.example.com/*',
        id: 'another-private-id',
      },
    ];

    const serialized = serializeCustomRuleTransfer([
      { ...(DEFAULT_DEDUPLICATION_RULES[0] as DedupeRule), enabled: true },
      ...customRules,
    ]);

    expect(JSON.parse(serialized)).toEqual({
      format: CUSTOM_RULE_TRANSFER_FORMAT,
      version: CUSTOM_RULE_TRANSFER_VERSION,
      rules: [
        {
          enabled: true,
          matchPagesBy: 'full-path',
          pattern: 'app.example.com/items/*',
        },
        {
          enabled: false,
          matchPagesBy: 'host',
          pattern: 'mail.example.com/*',
        },
      ],
    });
    expect(serialized.endsWith('\n')).toBe(true);
    expect(serialized).not.toContain('private-custom-id');
    expect(serialized).not.toContain('builtin-google-docs');
  });

  it('round-trips every matching mode with fresh IDs and a derived item cutoff', () => {
    const parsed = parseCustomRuleTransfer(
      transferFile([
        {
          enabled: true,
          id: 'builtin-google-docs',
          matchPagesBy: 'full-path',
          pattern: 'app.example.com/projects/*',
        },
        {
          enabled: false,
          matchPagesBy: 'path-prefix',
          pattern: 'app.example.com/workspaces/*/items/*',
        },
        {
          enabled: true,
          matchPagesBy: 'host',
          pattern: '*.example.net/*',
        },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('fresh-1')
      .mockReturnValueOnce('fresh-2')
      .mockReturnValueOnce('fresh-3');

    expect(materializeImportedCustomRules(parsed.rules, createId)).toEqual([
      {
        comparisonMode: 'full-path',
        enabled: true,
        glob: 'app.example.com/projects/*',
        id: 'fresh-1',
      },
      {
        comparisonMode: 'path-prefix',
        enabled: false,
        glob: 'app.example.com/workspaces/*/items/*',
        id: 'fresh-2',
        pathSegmentCount: 4,
      },
      {
        comparisonMode: 'host',
        enabled: true,
        glob: '*.example.net/*',
        id: 'fresh-3',
      },
    ]);
  });

  it.each([
    ['malformed JSON', '{', 'That file is not valid JSON'],
    [
      'wrong format',
      JSON.stringify({ format: 'other', version: 1, rules: [] }),
      'not a supported Weaver custom rules file',
    ],
    [
      'future version',
      JSON.stringify({ format: CUSTOM_RULE_TRANSFER_FORMAT, version: 2, rules: [] }),
      'not a supported Weaver custom rules file',
    ],
    [
      'invalid member',
      transferFile([
        {
          enabled: true,
          matchPagesBy: 'full-path',
          pattern: 'valid.example.com/*',
        },
        { enabled: true, matchPagesBy: 'full-path', pattern: 'https://bad.example.com/*' },
      ]),
      'Rule 2: Omit the URL scheme',
    ],
    [
      'missing item wildcard',
      transferFile([
        {
          enabled: true,
          matchPagesBy: 'path-prefix',
          pattern: 'app.example.com/items/',
        },
      ]),
      'Rule 1: Add * in the path where the item ID appears',
    ],
  ])('rejects %s atomically', (_name, text, expectedError) => {
    const result = parseCustomRuleTransfer(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(expectedError);
    }
  });

  it('caps transfer size and rule count', () => {
    const oversized = parseCustomRuleTransfer('x'.repeat(MAX_CUSTOM_RULE_TRANSFER_BYTES + 1));
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) {
      expect(oversized.error).toContain('1 MB or smaller');
    }
    const tooMany = parseCustomRuleTransfer(
      transferFile(
        Array.from({ length: MAX_IMPORTED_CUSTOM_RULES + 1 }, () => ({
          enabled: true,
          matchPagesBy: 'full-path',
          pattern: 'app.example.com/*',
        })),
      ),
    );
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.error).toContain(`more than ${MAX_IMPORTED_CUSTOM_RULES}`);
    }
  });

  it('allows an empty import to stage clearing custom rules', () => {
    expect(parseCustomRuleTransfer(transferFile([]))).toEqual({ ok: true, rules: [] });
  });

  it('only exports files that the importer can accept', () => {
    const boundaryRules = Array.from({ length: MAX_IMPORTED_CUSTOM_RULES }, (_, index) => ({
      comparisonMode: 'full-path' as const,
      enabled: true,
      glob: `app${index}.example.com/*`,
      id: `custom-${index}`,
    }));
    const serialized = serializeCustomRuleTransfer(boundaryRules);

    expect(parseCustomRuleTransfer(serialized)).toMatchObject({ ok: true });
    expect(() =>
      serializeCustomRuleTransfer([
        ...boundaryRules,
        {
          comparisonMode: 'full-path',
          enabled: true,
          glob: 'overflow.example.com/*',
          id: 'overflow',
        },
      ]),
    ).toThrow(`Export is limited to ${MAX_IMPORTED_CUSTOM_RULES} custom rules.`);
  });
});
