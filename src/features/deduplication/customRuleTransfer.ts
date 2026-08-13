import {
  type DedupeRule,
  deriveItemIdPathSegmentCount,
  isBuiltInDedupeRule,
  validateDedupeRule,
} from './deduplication';

export const CUSTOM_RULE_TRANSFER_FORMAT = 'weaver.custom-deduplication-rules';
export const CUSTOM_RULE_TRANSFER_VERSION = 1;
export const CUSTOM_RULE_TRANSFER_FILENAME = 'weaver-custom-deduplication-rules.json';
export const MAX_CUSTOM_RULE_TRANSFER_BYTES = 1024 * 1024;
export const MAX_IMPORTED_CUSTOM_RULES = 500;

type TransferComparisonMode = DedupeRule['comparisonMode'];

interface CustomRuleTransferEntry {
  enabled: boolean;
  matchPagesBy: TransferComparisonMode;
  pattern: string;
}

interface CustomRuleTransferFile {
  format: typeof CUSTOM_RULE_TRANSFER_FORMAT;
  rules: CustomRuleTransferEntry[];
  version: typeof CUSTOM_RULE_TRANSFER_VERSION;
}

export type CustomRuleImportResult =
  | { ok: true; rules: CustomRuleTransferEntry[] }
  | { error: string; ok: false };

const COMPARISON_MODES = new Set<TransferComparisonMode>(['host', 'path-prefix', 'full-path']);

function getTransferSize(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function hasItemIdPathWildcard(pattern: string): boolean {
  const pathStart = pattern.indexOf('/');
  return pathStart >= 0 && pattern.slice(pathStart + 1).includes('*');
}

function createRuleForValidation(entry: CustomRuleTransferEntry, index: number): DedupeRule {
  const rule: DedupeRule = {
    comparisonMode: entry.matchPagesBy,
    enabled: entry.enabled,
    glob: entry.pattern,
    id: `imported-custom-rule-${index + 1}`,
  };
  if (entry.matchPagesBy === 'path-prefix') {
    rule.pathSegmentCount = deriveItemIdPathSegmentCount(entry.pattern);
  }
  return rule;
}

function getRuleError(entry: CustomRuleTransferEntry, index: number): string | null {
  const rule = createRuleForValidation(entry, index);
  const validation = validateDedupeRule(rule);
  const firstError = validation.glob ?? validation.pathSegmentCount ?? validation.id;
  if (firstError) {
    return `Rule ${index + 1}: ${firstError}`;
  }
  if (entry.matchPagesBy === 'path-prefix' && !hasItemIdPathWildcard(entry.pattern)) {
    return `Rule ${index + 1}: Add * in the path where the item ID appears.`;
  }
  return null;
}

function parseEntry(value: unknown): CustomRuleTransferEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.enabled !== 'boolean' ||
    typeof candidate.matchPagesBy !== 'string' ||
    !COMPARISON_MODES.has(candidate.matchPagesBy as TransferComparisonMode) ||
    typeof candidate.pattern !== 'string'
  ) {
    return null;
  }
  return {
    enabled: candidate.enabled,
    matchPagesBy: candidate.matchPagesBy as TransferComparisonMode,
    pattern: candidate.pattern.trim(),
  };
}

export function parseCustomRuleTransfer(text: string): CustomRuleImportResult {
  if (
    text.length > MAX_CUSTOM_RULE_TRANSFER_BYTES ||
    getTransferSize(text) > MAX_CUSTOM_RULE_TRANSFER_BYTES
  ) {
    return {
      error: 'The file is too large. Custom rule files must be 1 MB or smaller.',
      ok: false,
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return {
      error: 'That file is not valid JSON. Choose a Weaver custom rules file.',
      ok: false,
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'This is not a supported Weaver custom rules file.', ok: false };
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.format !== CUSTOM_RULE_TRANSFER_FORMAT ||
    candidate.version !== CUSTOM_RULE_TRANSFER_VERSION ||
    !Array.isArray(candidate.rules)
  ) {
    return { error: 'This is not a supported Weaver custom rules file.', ok: false };
  }
  if (candidate.rules.length > MAX_IMPORTED_CUSTOM_RULES) {
    return {
      error: `The file contains more than ${MAX_IMPORTED_CUSTOM_RULES} custom rules.`,
      ok: false,
    };
  }

  const rules: CustomRuleTransferEntry[] = [];
  for (const [index, entryValue] of candidate.rules.entries()) {
    const entry = parseEntry(entryValue);
    if (!entry) {
      return { error: `Rule ${index + 1}: Required fields are missing or invalid.`, ok: false };
    }
    const error = getRuleError(entry, index);
    if (error) {
      return { error, ok: false };
    }
    rules.push(entry);
  }

  return { ok: true, rules };
}

export function materializeImportedCustomRules(
  entries: readonly CustomRuleTransferEntry[],
  createId: () => string,
): DedupeRule[] {
  return entries.map((entry) => {
    const rule: DedupeRule = {
      comparisonMode: entry.matchPagesBy,
      enabled: entry.enabled,
      glob: entry.pattern,
      id: createId(),
    };
    if (entry.matchPagesBy === 'path-prefix') {
      rule.pathSegmentCount = deriveItemIdPathSegmentCount(entry.pattern);
    }
    return rule;
  });
}

export function serializeCustomRuleTransfer(rules: readonly DedupeRule[]): string {
  const customRules = rules.filter((rule) => !isBuiltInDedupeRule(rule));
  if (customRules.length > MAX_IMPORTED_CUSTOM_RULES) {
    throw new Error(`Export is limited to ${MAX_IMPORTED_CUSTOM_RULES} custom rules.`);
  }
  const entries = customRules.map(
    (rule): CustomRuleTransferEntry => ({
      enabled: rule.enabled,
      matchPagesBy: rule.comparisonMode,
      pattern: rule.glob.trim(),
    }),
  );
  entries.forEach((entry, index) => {
    const error = getRuleError(entry, index);
    if (error) {
      throw new Error(error);
    }
  });

  const transferFile: CustomRuleTransferFile = {
    format: CUSTOM_RULE_TRANSFER_FORMAT,
    version: CUSTOM_RULE_TRANSFER_VERSION,
    rules: entries,
  };
  const serialized = `${JSON.stringify(transferFile, null, 2)}\n`;
  if (getTransferSize(serialized) > MAX_CUSTOM_RULE_TRANSFER_BYTES) {
    throw new Error('Export is limited to 1 MB.');
  }
  return serialized;
}
