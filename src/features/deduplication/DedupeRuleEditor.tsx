import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Eye,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { SettingSwitch } from '../settings/SettingSwitch';
import {
  type DedupeRule,
  cloneDedupeRules,
  DEFAULT_DEDUPLICATION_RULES,
  deriveItemIdPathSegmentCount,
  type DuplicateKeeperPreference,
  isBuiltInDedupeRule,
  orderBuiltInDedupeRulesFirst,
  validateDedupeRule,
} from './deduplication';
import { DedupePreviewGroups } from './DedupePreviewGroups';
import {
  BUILT_IN_DEDUPE_PRESETS,
  type BuiltInDedupePreset,
  buildDedupePreview,
  type DedupePreviewTab,
  findDedupeRuleExample,
  formatDedupeExampleUrl,
  getDedupeRuleDisplayName,
  getDedupeStrategyDescription,
  getDedupeStrategyLabel,
} from './dedupeRulePresentation';
import { DedupeRuleHelpPopover } from './DedupeRuleHelpPopover';

interface DedupeRulePreviewInput {
  errorMessage: string | null;
  isLoading: boolean;
  keeperPreference: DuplicateKeeperPreference;
  tabs: readonly DedupePreviewTab[];
}

interface DedupeRuleEditorProps {
  advancedDuplicateMatchingEnabled?: boolean | undefined;
  advancedDuplicateMatchingToggleDisabled?: boolean | undefined;
  disabled: boolean;
  onAdvancedDuplicateMatchingEnabledChange?: ((enabled: boolean) => Promise<boolean>) | undefined;
  onSave: (rules: readonly DedupeRule[]) => Promise<boolean>;
  preview?: DedupeRulePreviewInput | undefined;
  rules: readonly DedupeRule[];
}

const EMPTY_PREVIEW: DedupeRulePreviewInput = {
  errorMessage: null,
  isLoading: false,
  keeperPreference: {},
  tabs: [],
};

let fallbackRuleId = 0;

function createRuleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackRuleId += 1;
  return `custom-rule-${Date.now()}-${fallbackRuleId}`;
}

function pluralize(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function hasItemIdPathWildcard(glob: string): boolean {
  const pathStart = glob.indexOf('/');
  return pathStart >= 0 && glob.slice(pathStart + 1).includes('*');
}

function getPresetState(preset: BuiltInDedupePreset, rules: readonly DedupeRule[]) {
  const presetRules = preset.ruleIds.flatMap((ruleId) => {
    const rule = rules.find(
      (candidate) => candidate.id === ruleId && isBuiltInDedupeRule(candidate),
    );
    return rule ? [rule] : [];
  });
  const enabledCount = presetRules.filter((rule) => rule.enabled).length;
  const allEnabled = enabledCount === preset.ruleIds.length;
  return {
    allEnabled,
    partial: enabledCount > 0 && !allEnabled,
  };
}

function getPatternHelp(comparisonMode: DedupeRule['comparisonMode']): string {
  switch (comparisonMode) {
    case 'full-path':
      return 'Example: app.example.com/items/*';
    case 'path-prefix':
      return 'Put * where the item ID appears, for example app.example.com/items/*.';
    case 'host':
      return 'Use a hostname pattern such as app.example.com/*.';
  }
}

export function DedupeRuleEditor({
  advancedDuplicateMatchingEnabled = false,
  advancedDuplicateMatchingToggleDisabled = false,
  disabled,
  onAdvancedDuplicateMatchingEnabledChange = () => Promise.resolve(true),
  onSave,
  preview = EMPTY_PREVIEW,
  rules,
}: DedupeRuleEditorProps) {
  const persistedBuiltInRules = useMemo(
    () => rules.filter(isBuiltInDedupeRule).map((rule) => ({ ...rule })),
    [rules],
  );
  const persistedCustomRules = useMemo(
    () => rules.filter((rule) => !isBuiltInDedupeRule(rule)).map((rule) => ({ ...rule })),
    [rules],
  );
  const [customDraft, setCustomDraft] = useState<DedupeRule[] | null>(null);
  const [customOpen, setCustomOpen] = useState(() =>
    rules.some((rule) => !isBuiltInDedupeRule(rule)),
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);
  const customRules = customDraft ?? persistedCustomRules;
  const customDirty = customDraft !== null;
  const draftRules = useMemo(
    () => orderBuiltInDedupeRulesFirst([...persistedBuiltInRules, ...customRules]),
    [customRules, persistedBuiltInRules],
  );
  const validations = customRules.map((rule) => {
    const validation = validateDedupeRule(rule);
    if (
      rule.comparisonMode === 'path-prefix' &&
      !validation.glob &&
      !hasItemIdPathWildcard(rule.glob)
    ) {
      return { ...validation, glob: 'Add * in the path where the item ID appears.' };
    }
    return validation;
  });
  const hasErrors = validations.some((validation) =>
    Object.values(validation).some((error) => error !== null),
  );
  const previewGroups = useMemo(
    () => buildDedupePreview(preview.tabs, draftRules, preview.keeperPreference),
    [draftRules, preview.keeperPreference, preview.tabs],
  );
  const previewCloseCount = previewGroups.reduce(
    (total, group) => total + group.closeTabs.length,
    0,
  );

  const updateCustomRules = (update: (current: DedupeRule[]) => DedupeRule[]) => {
    setCustomDraft((current) => update(current ?? persistedCustomRules));
    setResetRequested(false);
  };

  const togglePreset = async (preset: BuiltInDedupePreset) => {
    const { allEnabled } = getPresetState(preset, rules);
    const currentBuiltIns = new Map(
      rules.filter(isBuiltInDedupeRule).map((rule) => [rule.id, rule] as const),
    );
    const persistedCustom = rules
      .filter((rule) => !isBuiltInDedupeRule(rule))
      .map((rule) => (preset.ruleIds.includes(rule.id) ? { ...rule, id: createRuleId() } : rule));
    const nextBuiltIns = DEFAULT_DEDUPLICATION_RULES.flatMap((defaultRule) => {
      if (preset.ruleIds.includes(defaultRule.id)) {
        return [{ ...defaultRule, enabled: !allEnabled }];
      }
      const existing = currentBuiltIns.get(defaultRule.id);
      return existing ? [{ ...existing }] : [];
    });
    setResetRequested(false);
    await onSave(orderBuiltInDedupeRulesFirst([...nextBuiltIns, ...persistedCustom]));
  };

  const replaceCustomRule = (ruleId: string, replacement: DedupeRule) => {
    updateCustomRules((current) =>
      current.map((rule) => (rule.id === ruleId ? replacement : rule)),
    );
  };

  const moveCustomRule = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= customRules.length) {
      return;
    }
    updateCustomRules((current) => {
      const nextRules = [...current];
      const [rule] = nextRules.splice(index, 1);
      if (rule) {
        nextRules.splice(destination, 0, rule);
      }
      return nextRules;
    });
  };

  const addRule = () => {
    updateCustomRules((current) => [
      ...current,
      {
        comparisonMode: 'full-path',
        enabled: true,
        glob: '',
        id: createRuleId(),
      },
    ]);
    setCustomOpen(true);
  };

  const discardCustomChanges = () => {
    setCustomDraft(null);
    setCustomOpen(persistedCustomRules.length > 0);
    setResetRequested(false);
  };

  const saveCustomChanges = async () => {
    if (!customDirty || hasErrors || disabled) {
      return;
    }
    if (await onSave(orderBuiltInDedupeRulesFirst([...persistedBuiltInRules, ...customRules]))) {
      setCustomDraft(null);
      setResetRequested(false);
    }
  };

  const resetRules = async () => {
    if (disabled) {
      return;
    }
    if (await onSave(cloneDedupeRules(DEFAULT_DEDUPLICATION_RULES))) {
      setCustomDraft(null);
      setCustomOpen(false);
      setResetRequested(false);
    }
  };

  return (
    <section className="settings-rule-section" aria-labelledby="dedupe-rules-heading">
      <header className="settings-rule-heading">
        <div>
          <h3 id="dedupe-rules-heading">Advanced duplicate matching</h3>
          <p>
            {advancedDuplicateMatchingEnabled
              ? 'Exact full-URL duplicates always match. Google, Notion, and custom rules can also identify different views of the same content.'
              : 'Exact full-URL duplicates always match. Turn this on to also match different views using Google, Notion, and custom rules.'}
          </p>
        </div>
        <div className="settings-rule-heading-actions">
          {advancedDuplicateMatchingEnabled ? (
            <button type="button" disabled={disabled} onClick={() => setResetRequested(true)}>
              <RotateCcw aria-hidden="true" size={15} />
              <span>Reset</span>
            </button>
          ) : null}
          <SettingSwitch
            checked={advancedDuplicateMatchingEnabled}
            disabled={advancedDuplicateMatchingToggleDisabled}
            label="Advanced duplicate matching"
            onChange={(enabled) => {
              if (!enabled) {
                setResetRequested(false);
              }
              void onAdvancedDuplicateMatchingEnabledChange(enabled);
            }}
          />
        </div>
      </header>

      {advancedDuplicateMatchingEnabled ? (
        <>
          {resetRequested ? (
            <div className="rule-reset-confirmation" role="alert">
              <span>Turn off Google and Notion matching and remove all custom rules?</span>
              <button type="button" disabled={disabled} onClick={() => void resetRules()}>
                Reset rules
              </button>
              <button type="button" onClick={() => setResetRequested(false)}>
                Cancel
              </button>
            </div>
          ) : null}

          <div className="dedupe-preset-list" aria-label="Built-in duplicate matching">
            {BUILT_IN_DEDUPE_PRESETS.map((preset) => {
              const state = getPresetState(preset, rules);
              return (
                <div
                  className={`dedupe-preset-row${state.allEnabled || state.partial ? ' is-enabled' : ''}`}
                  key={preset.id}
                >
                  <div className="dedupe-preset-control">
                    <span className="dedupe-preset-copy">
                      <strong>{preset.name}</strong>
                      <small>{preset.description}</small>
                    </span>
                  </div>
                  <SettingSwitch
                    checked={state.allEnabled}
                    disabled={disabled}
                    label={`${preset.name} preset`}
                    onChange={() => void togglePreset(preset)}
                  />
                  <div className="dedupe-preset-example">
                    <span>Compared as</span>
                    <code>{preset.comparedAs}</code>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="dedupe-custom-section">
            <div className="dedupe-custom-heading">
              <button
                className="dedupe-custom-toggle"
                type="button"
                aria-expanded={customOpen}
                aria-controls="dedupe-custom-rules"
                onClick={() => setCustomOpen((current) => !current)}
              >
                <ChevronDown aria-hidden="true" size={16} />
                <span>
                  <strong>Custom rules</strong>
                  <small>Define matching for another site.</small>
                </span>
                <span>{pluralize(customRules.length, 'rule')}</span>
              </button>
              <div className="dedupe-custom-heading-actions">
                <DedupeRuleHelpPopover />
                <button type="button" disabled={disabled} onClick={addRule}>
                  <Plus aria-hidden="true" size={15} />
                  <span>Add custom rule</span>
                </button>
              </div>
            </div>

            {customOpen ? (
              <div id="dedupe-custom-rules" role="region" aria-label="Custom rules">
                <p className="dedupe-custom-order-note">
                  Built-in presets run first. Custom rules run top to bottom; the first match
                  decides.
                </p>
                {customRules.length > 0 ? (
                  <div className="dedupe-rule-list" aria-label="Custom duplicate matching rules">
                    {customRules.map((rule, index) => {
                      const validation = validations[index];
                      const patternErrorId = `dedupe-rule-${rule.id}-pattern-error`;
                      const example = findDedupeRuleExample(rule, draftRules, preview.tabs);
                      const shadowingRule = example?.shadowedByRuleId
                        ? draftRules.find((candidate) => candidate.id === example.shadowedByRuleId)
                        : undefined;
                      const highImpact = rule.comparisonMode === 'host';
                      return (
                        <div
                          className={`dedupe-rule-row${rule.enabled ? '' : ' is-disabled'}${highImpact ? ' is-high-impact' : ''}`}
                          key={rule.id}
                        >
                          <div className="dedupe-rule-row-heading">
                            <div className="dedupe-rule-identity">
                              <span className="dedupe-rule-order">{index + 1}</span>
                              <strong>{getDedupeRuleDisplayName(rule)}</strong>
                            </div>

                            <div className="dedupe-rule-actions">
                              <button
                                className="icon-button"
                                type="button"
                                aria-label={`Move custom rule ${index + 1} up`}
                                title="Move up"
                                disabled={disabled || index === 0}
                                onClick={() => moveCustomRule(index, -1)}
                              >
                                <ArrowUp aria-hidden="true" size={15} />
                              </button>
                              <button
                                className="icon-button"
                                type="button"
                                aria-label={`Move custom rule ${index + 1} down`}
                                title="Move down"
                                disabled={disabled || index === customRules.length - 1}
                                onClick={() => moveCustomRule(index, 1)}
                              >
                                <ArrowDown aria-hidden="true" size={15} />
                              </button>
                              <button
                                className="icon-button danger-icon-button"
                                type="button"
                                aria-label={`Delete custom rule ${index + 1}`}
                                title="Delete custom rule"
                                disabled={disabled}
                                onClick={() => {
                                  updateCustomRules((current) =>
                                    current.filter((candidate) => candidate.id !== rule.id),
                                  );
                                }}
                              >
                                <Trash2 aria-hidden="true" size={15} />
                              </button>
                              <SettingSwitch
                                checked={rule.enabled}
                                disabled={disabled}
                                label={`Enable custom rule ${index + 1}`}
                                onChange={(enabled) =>
                                  replaceCustomRule(rule.id, {
                                    ...rule,
                                    enabled,
                                  })
                                }
                              />
                            </div>
                          </div>

                          <div className="dedupe-rule-fields">
                            <label className="dedupe-rule-field">
                              <span>Applies to</span>
                              <input
                                type="text"
                                aria-label="URL pattern"
                                value={rule.glob}
                                placeholder="app.example.com/items/*"
                                aria-invalid={validation?.glob ? true : undefined}
                                aria-describedby={validation?.glob ? patternErrorId : undefined}
                                disabled={disabled}
                                onChange={(event) => {
                                  const glob = event.target.value;
                                  replaceCustomRule(
                                    rule.id,
                                    rule.comparisonMode === 'path-prefix'
                                      ? {
                                          ...rule,
                                          glob,
                                          pathSegmentCount: deriveItemIdPathSegmentCount(glob),
                                        }
                                      : { ...rule, glob },
                                  );
                                }}
                              />
                              {validation?.glob ? (
                                <small id={patternErrorId} className="field-error">
                                  {validation.glob}
                                </small>
                              ) : (
                                <small className="dedupe-pattern-help">
                                  {getPatternHelp(rule.comparisonMode)}
                                </small>
                              )}
                            </label>

                            <label className="dedupe-rule-field">
                              <span>Match pages by</span>
                              <select
                                aria-label="Matching behavior"
                                value={rule.comparisonMode}
                                disabled={disabled}
                                onChange={(event) => {
                                  const comparisonMode = event.target
                                    .value as DedupeRule['comparisonMode'];
                                  if (comparisonMode === 'path-prefix') {
                                    replaceCustomRule(rule.id, {
                                      ...rule,
                                      comparisonMode,
                                      pathSegmentCount: deriveItemIdPathSegmentCount(rule.glob),
                                    });
                                  } else {
                                    replaceCustomRule(rule.id, {
                                      comparisonMode,
                                      enabled: rule.enabled,
                                      glob: rule.glob,
                                      id: rule.id,
                                    });
                                  }
                                }}
                              >
                                <option value="full-path">
                                  {getDedupeStrategyLabel('full-path')}
                                </option>
                                <option value="path-prefix">
                                  {getDedupeStrategyLabel('path-prefix')}
                                </option>
                                <option value="host">{getDedupeStrategyLabel('host')}</option>
                              </select>
                            </label>
                          </div>

                          <p className={`dedupe-rule-outcome${highImpact ? ' is-warning' : ''}`}>
                            {highImpact ? <AlertTriangle aria-hidden="true" size={14} /> : null}
                            <span>{getDedupeStrategyDescription(rule.comparisonMode)}</span>
                          </p>

                          <div className="dedupe-rule-example">
                            <span>Comparison example</span>
                            {!rule.enabled ? (
                              <small>Rule disabled</small>
                            ) : example ? (
                              <div className="dedupe-comparison-example">
                                <div className="dedupe-comparison-values">
                                  <div className="dedupe-comparison-value">
                                    <small>Open tab URL</small>
                                    <code title={example.tab.url}>
                                      {formatDedupeExampleUrl(example.tab.url)}
                                    </code>
                                  </div>
                                  <div className="dedupe-comparison-value">
                                    <small>Compared as</small>
                                    <code title={example.identity}>{example.identity}</code>
                                  </div>
                                </div>
                                {shadowingRule ? (
                                  <small className="dedupe-shadow-warning">
                                    Handled first by {getDedupeRuleDisplayName(shadowingRule)}
                                  </small>
                                ) : (
                                  <small>{example.tab.windowLabel}</small>
                                )}
                              </div>
                            ) : (
                              <small>Open a matching tab to see its comparison.</small>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="dedupe-rules-empty">
                    No custom rules. Unmatched tabs require an exact full-URL match.
                  </p>
                )}
                <footer className="settings-rule-footer dedupe-custom-footer">
                  <span aria-live="polite">
                    {customDirty ? 'Unsaved custom rule changes' : 'Custom rules saved'}
                  </span>
                  <button
                    type="button"
                    disabled={disabled || !customDirty}
                    onClick={discardCustomChanges}
                  >
                    <Undo2 aria-hidden="true" size={15} />
                    <span>Discard changes</span>
                  </button>
                  <button
                    className="save-rules-button"
                    type="button"
                    disabled={disabled || !customDirty || hasErrors}
                    onClick={() => void saveCustomChanges()}
                  >
                    <Save aria-hidden="true" size={15} />
                    <span>Save custom rules</span>
                  </button>
                </footer>
              </div>
            ) : null}
          </div>

          <div className="dedupe-preview-section">
            <button
              className="dedupe-preview-toggle"
              type="button"
              aria-expanded={previewOpen}
              aria-controls="dedupe-preview-panel"
              onClick={() => setPreviewOpen((current) => !current)}
            >
              <Eye aria-hidden="true" size={16} />
              <span>Preview matches</span>
              <small>
                {preview.isLoading
                  ? 'Checking open tabs'
                  : `${pluralize(previewCloseCount, 'tab')} would close`}
              </small>
              <ChevronDown aria-hidden="true" size={15} />
            </button>

            {previewOpen ? (
              <div
                className="dedupe-preview-panel"
                id="dedupe-preview-panel"
                role="region"
                aria-label="Duplicate match preview"
              >
                {preview.errorMessage ? (
                  <div className="dedupe-preview-message is-error" role="alert">
                    <AlertTriangle aria-hidden="true" size={15} />
                    <span>Open tabs could not be checked: {preview.errorMessage}</span>
                  </div>
                ) : preview.isLoading ? (
                  <p className="dedupe-preview-message">Checking open tabs...</p>
                ) : previewGroups.length === 0 ? (
                  <p className="dedupe-preview-message">
                    No open tabs would close with the current draft.
                  </p>
                ) : (
                  <DedupePreviewGroups groups={previewGroups} />
                )}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
