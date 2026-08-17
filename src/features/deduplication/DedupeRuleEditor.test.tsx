import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dismissTransientSurfacesForCommandPalette } from '../../ui/transientSurface';
import { type DedupeRule, DEFAULT_DEDUPLICATION_RULES } from './deduplication';
import { DedupeRuleEditor } from './DedupeRuleEditor';
import {
  CUSTOM_RULE_TRANSFER_FILENAME,
  CUSTOM_RULE_TRANSFER_FORMAT,
  CUSTOM_RULE_TRANSFER_VERSION,
} from './customRuleTransfer';

const RULES: DedupeRule[] = [
  {
    comparisonMode: 'full-path',
    enabled: true,
    glob: 'example.com/*',
    id: 'one',
  },
  {
    comparisonMode: 'host',
    enabled: true,
    glob: 'docs.example.com/*',
    id: 'two',
  },
];

function createTransferFile(
  rules: Array<{ enabled: boolean; matchPagesBy: DedupeRule['comparisonMode']; pattern: string }>,
) {
  return new File(
    [
      JSON.stringify({
        format: CUSTOM_RULE_TRANSFER_FORMAT,
        version: CUSTOM_RULE_TRANSFER_VERSION,
        rules,
      }),
    ],
    'custom-rules.json',
    { type: 'application/json' },
  );
}

function getImportInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error('Expected the custom-rule import input.');
  }
  return input;
}

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Expected the exported Blob to contain text.'));
      }
    });
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Could not read the exported Blob.')),
    );
    reader.readAsText(blob);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DedupeRuleEditor', () => {
  it('imports custom rules into a reviewable draft and preserves built-in presets on save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(rules: readonly DedupeRule[]) => Promise<boolean>>(() =>
      Promise.resolve(true),
    );
    const enabledBuiltIn = {
      ...(DEFAULT_DEDUPLICATION_RULES[0] as DedupeRule),
      enabled: true,
    };
    const { container } = render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={onSave}
        rules={[enabledBuiltIn, RULES[0] as DedupeRule]}
      />,
    );

    await user.upload(
      getImportInput(container),
      createTransferFile([
        {
          enabled: true,
          matchPagesBy: 'path-prefix',
          pattern: 'app.example.com/workspaces/*/items/*',
        },
        {
          enabled: false,
          matchPagesBy: 'host',
          pattern: 'mail.example.net/*',
        },
      ]),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Imported 2 custom rules. Review them, then save your changes.',
    );
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole('textbox', { name: 'URL pattern' })).toHaveLength(2);
    expect(screen.getAllByRole('textbox', { name: 'URL pattern' })[0]).toHaveValue(
      'app.example.com/workspaces/*/items/*',
    );
    expect(screen.queryByDisplayValue('example.com/*')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save custom rules' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedRules = onSave.mock.calls[0]?.[0];
    expect(savedRules).toEqual([
      enabledBuiltIn,
      {
        comparisonMode: 'path-prefix',
        enabled: true,
        glob: 'app.example.com/workspaces/*/items/*',
        id: savedRules?.[1]?.id,
        pathSegmentCount: 4,
      },
      {
        comparisonMode: 'host',
        enabled: false,
        glob: 'mail.example.net/*',
        id: savedRules?.[2]?.id,
      },
    ]);
    expect(typeof savedRules?.[1]?.id).toBe('string');
    expect(typeof savedRules?.[2]?.id).toBe('string');
    expect(savedRules?.slice(1).map((rule) => rule.id)).not.toContain(enabledBuiltIn.id);
  });

  it('confirms before replacing unsaved edits and lets the same file be selected again', async () => {
    const user = userEvent.setup();
    const readSpy = vi.spyOn(FileReader.prototype, 'readAsText');
    const { container } = render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={vi.fn(() => Promise.resolve(true))}
        rules={[RULES[0] as DedupeRule]}
      />,
    );
    const pattern = screen.getByRole('textbox', { name: 'URL pattern' });
    await user.clear(pattern);
    await user.type(pattern, 'draft.example.com/*');
    const file = createTransferFile([
      {
        enabled: true,
        matchPagesBy: 'full-path',
        pattern: 'imported.example.com/*',
      },
    ]);

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('button', { name: 'Reset rules' })).toBeEnabled();
    await user.upload(getImportInput(container), file);
    expect(
      await screen.findByText('Replace your unsaved changes with 1 imported rule?'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset rules' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Import custom rules' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export custom rules' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add custom rule' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save custom rules' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Advanced duplicate matching' })).toBeDisabled();
    expect(
      screen.getByRole('switch', { name: 'Google Docs, Sheets & Slides preset' }),
    ).toBeDisabled();
    expect(pattern).toBeDisabled();
    expect(pattern).toHaveValue('draft.example.com/*');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Import custom rules' })).toHaveFocus(),
    );
    expect(pattern).toHaveValue('draft.example.com/*');

    await user.upload(getImportInput(container), file);
    await waitFor(() => expect(readSpy).toHaveBeenCalledTimes(2));
    await user.click(await screen.findByRole('button', { name: 'Import and replace' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Import custom rules' })).toHaveFocus(),
    );
    expect(screen.getByRole('textbox', { name: 'URL pattern' })).toHaveValue(
      'imported.example.com/*',
    );
  });

  it('discards an imported draft without changing the persisted custom rules', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(() => Promise.resolve(true));
    const { container } = render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={onSave}
        rules={[RULES[0] as DedupeRule]}
      />,
    );

    await user.upload(
      getImportInput(container),
      createTransferFile([
        {
          enabled: true,
          matchPagesBy: 'full-path',
          pattern: 'imported.example.com/*',
        },
      ]),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 1 custom rule.');

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(screen.getByRole('textbox', { name: 'URL pattern' })).toHaveValue('example.com/*');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps edits made while an import is being read behind replacement confirmation', async () => {
    const user = userEvent.setup();
    const importedText = JSON.stringify({
      format: CUSTOM_RULE_TRANSFER_FORMAT,
      version: CUSTOM_RULE_TRANSFER_VERSION,
      rules: [
        {
          enabled: true,
          matchPagesBy: 'full-path',
          pattern: 'imported.example.com/*',
        },
      ],
    });
    const readSpy = vi
      .spyOn(FileReader.prototype, 'readAsText')
      .mockImplementation(() => undefined);
    const { container } = render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={vi.fn(() => Promise.resolve(true))}
        rules={[]}
      />,
    );

    await user.upload(
      getImportInput(container),
      new File([importedText], 'custom-rules.json', { type: 'application/json' }),
    );
    const pendingReader = readSpy.mock.instances[0] as FileReader | undefined;
    await user.click(screen.getByRole('button', { name: 'Add custom rule' }));
    const pattern = screen.getByRole('textbox', { name: 'URL pattern' });
    await user.type(pattern, 'draft.example.com/*');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('button', { name: 'Reset rules' })).toBeEnabled();

    expect(pendingReader).toBeInstanceOf(FileReader);
    if (!pendingReader) {
      throw new Error('Expected a pending file reader.');
    }
    act(() => {
      Object.defineProperty(pendingReader, 'result', {
        configurable: true,
        value: importedText,
      });
      pendingReader.dispatchEvent(new ProgressEvent('load'));
    });

    expect(
      await screen.findByText('Replace your unsaved changes with 1 imported rule?'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset rules' })).not.toBeInTheDocument();
    expect(pattern).toHaveValue('draft.example.com/*');
  });

  it('keeps an imported draft reviewable when saving fails', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(() => Promise.resolve(false));
    const { container } = render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={onSave}
        rules={[]}
      />,
    );

    await user.upload(
      getImportInput(container),
      createTransferFile([
        {
          enabled: true,
          matchPagesBy: 'full-path',
          pattern: 'imported.example.com/*',
        },
      ]),
    );
    const pattern = await screen.findByRole('textbox', { name: 'URL pattern' });
    await user.click(screen.getByRole('button', { name: 'Save custom rules' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(pattern).toHaveValue('imported.example.com/*');
    expect(screen.getByText('Unsaved custom rule changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save custom rules' })).toBeEnabled();
  });

  it('can stage an empty import to clear custom rules', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(rules: readonly DedupeRule[]) => Promise<boolean>>(() =>
      Promise.resolve(true),
    );
    const { container } = render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={onSave}
        rules={[RULES[0] as DedupeRule]}
      />,
    );

    await user.upload(getImportInput(container), createTransferFile([]));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Imported a file with no custom rules. Save to remove all custom rules.',
    );
    expect(screen.queryByRole('textbox', { name: 'URL pattern' })).not.toBeInTheDocument();
    expect(
      screen.getByText('No custom rules. Unmatched tabs require an exact full-URL match.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save custom rules' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([]));
  });

  it('rejects an invalid multi-rule import without changing an unsaved draft', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={vi.fn(() => Promise.resolve(true))}
        rules={[RULES[0] as DedupeRule]}
      />,
    );
    const pattern = screen.getByRole('textbox', { name: 'URL pattern' });
    await user.clear(pattern);
    await user.type(pattern, 'draft.example.com/*');
    const invalidFile = createTransferFile([
      {
        enabled: true,
        matchPagesBy: 'full-path',
        pattern: 'valid.example.com/*',
      },
      {
        enabled: true,
        matchPagesBy: 'full-path',
        pattern: 'https://bad.example.com/*',
      },
    ]);

    await user.upload(getImportInput(container), invalidFile);

    expect(await screen.findByRole('alert')).toHaveTextContent('Rule 2: Omit the URL scheme.');
    expect(screen.getByRole('textbox', { name: 'URL pattern' })).toHaveValue('draft.example.com/*');
    expect(screen.getByRole('button', { name: 'Save custom rules' })).toBeEnabled();
  });

  it('exports the current valid custom draft as a custom-only JSON download', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:custom-rules');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    let downloadName = '';
    let downloadHref = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
      downloadHref = this.href;
    });
    render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={vi.fn(() => Promise.resolve(true))}
        rules={[
          { ...(DEFAULT_DEDUPLICATION_RULES[0] as DedupeRule), enabled: true },
          RULES[0] as DedupeRule,
        ]}
      />,
    );
    const pattern = screen.getByRole('textbox', { name: 'URL pattern' });
    await user.clear(pattern);
    await user.type(pattern, 'draft.example.com/*');

    const timeoutSpy = vi.spyOn(window, 'setTimeout');
    await user.click(screen.getByRole('button', { name: 'Export custom rules' }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloadName).toBe(CUSTOM_RULE_TRANSFER_FILENAME);
    expect(downloadHref).toBe('blob:custom-rules');
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(JSON.parse(await readBlobAsText(blob as Blob))).toEqual({
      format: CUSTOM_RULE_TRANSFER_FORMAT,
      version: CUSTOM_RULE_TRANSFER_VERSION,
      rules: [
        {
          enabled: true,
          matchPagesBy: 'full-path',
          pattern: 'draft.example.com/*',
        },
      ],
    });
    expect(screen.getByRole('status')).toHaveTextContent('Exported 1 custom rule.');
  });

  it('edits, disables, reorders, and saves rules in visible order', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(() => Promise.resolve(true));
    render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={onSave}
        rules={RULES}
      />,
    );
    const patternInputs = screen.getAllByRole('textbox', { name: 'URL pattern' });

    await user.clear(patternInputs[0] as HTMLInputElement);
    await user.type(patternInputs[0] as HTMLInputElement, 'changed.example.com/*');
    await user.click(screen.getByRole('switch', { name: 'Enable custom rule 1' }));
    await user.click(screen.getByRole('button', { name: 'Move custom rule 1 down' }));
    const customRules = screen.getByRole('region', { name: 'Custom rules' });
    await user.click(within(customRules).getByRole('button', { name: 'Save custom rules' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      RULES[1],
      {
        ...RULES[0],
        enabled: false,
        glob: 'changed.example.com/*',
      },
    ]);
  });

  it('places section controls beside their titles and the preview count after them', () => {
    render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={vi.fn(() => Promise.resolve(true))}
        rules={RULES}
      />,
    );

    const customToggle = screen.getByRole('button', { name: /^Custom rules/ });
    const customTitle = within(customToggle).getByText('Custom rules');
    const customChevron = customToggle.querySelector(
      '.dedupe-custom-toggle-title .lucide-chevron-down',
    );
    expect(customTitle.nextElementSibling).toBe(customChevron);

    const previewToggle = screen.getByRole('button', { name: /Preview matches/ });
    const previewTitle = within(previewToggle).getByText('Preview matches');
    const previewTitleGroup = previewTitle.parentElement;
    const previewEye = previewToggle.querySelector('.dedupe-preview-toggle-eye');
    const previewChevron = previewToggle.querySelector('.dedupe-preview-toggle-chevron');
    const previewCount = within(previewToggle).getByText('0 tabs to close');
    expect(previewTitle.nextElementSibling).toBe(previewEye);
    expect(previewEye?.nextElementSibling).toBe(previewChevron);
    expect(previewTitleGroup?.nextElementSibling).toBe(previewCount);
  });

  it('blocks invalid new rules until every required field is valid', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(() => Promise.resolve(true));
    render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={onSave}
        rules={[]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Export custom rules' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export custom rules' })).toHaveAttribute(
      'title',
      'Add a custom rule before exporting.',
    );
    await user.click(screen.getByRole('button', { name: 'Add custom rule' }));
    expect(screen.getByText('Enter a hostname and optional path pattern.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save custom rules' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export custom rules' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export custom rules' })).toHaveAttribute(
      'title',
      'Fix custom rule errors before exporting.',
    );

    await user.type(screen.getByRole('textbox', { name: 'URL pattern' }), 'app.example.com/*');
    expect(screen.getByRole('button', { name: 'Save custom rules' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save custom rules' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({
        comparisonMode: 'full-path',
        enabled: true,
        glob: 'app.example.com/*',
      }),
    ]);
  });

  it('explains custom matching with examples and supports anchored dismissal', async () => {
    const user = userEvent.setup();
    render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={vi.fn(() => Promise.resolve(true))}
        rules={[]}
      />,
    );
    const helpButton = screen.getByRole('button', { name: 'Help' });

    await user.click(helpButton);
    const help = screen.getByRole('dialog', { name: 'Custom rules help' });

    expect(within(help).getByText(/Each rule has two parts:/)).toBeInTheDocument();
    expect(
      within(help).getByRole('heading', { name: 'Choose which URLs the rule includes' }),
    ).toBeInTheDocument();
    expect(within(help).getByText('Step 1 · URL pattern')).toBeInTheDocument();
    expect(within(help).getByText('Step 2 · Comparison method')).toBeInTheDocument();
    expect(within(help).getAllByText('Rule pattern')).toHaveLength(2);
    expect(within(help).getAllByText('Example URLs included by this pattern')).toHaveLength(2);
    expect(within(help).getAllByText('Comparison result')).toHaveLength(3);
    expect(
      within(help).getAllByText('Both example URLs are treated as the same page.'),
    ).toHaveLength(3);
    expect(within(help).queryByText('Matches')).not.toBeInTheDocument();
    expect(within(help).queryByText('Both compare as')).not.toBeInTheDocument();
    expect(
      within(help).getByRole('heading', { name: 'Ignore query and page section' }),
    ).toBeInTheDocument();
    expect(
      within(help).getByRole('heading', { name: 'Stop after the item ID' }),
    ).toBeInTheDocument();
    expect(within(help).getByRole('heading', { name: 'One tab per site' })).toBeInTheDocument();
    expect(within(help).getByText(/High impact:/)).toBeInTheDocument();
    expect(within(help).getByText('app.example.com/workspaces/acme/items/42')).toBeInTheDocument();
    expect(within(help).getByText(/exact full-URL match/)).toBeInTheDocument();

    act(() => expect(dismissTransientSurfacesForCommandPalette()).toBe(true));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Custom rules help' })).not.toBeInTheDocument(),
    );

    await user.click(helpButton);
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Custom rules help' })).not.toBeInTheDocument(),
    );
    expect(helpButton).toHaveFocus();

    await user.click(helpButton);
    expect(screen.getByRole('dialog', { name: 'Custom rules help' })).toBeInTheDocument();
    await user.click(screen.getByRole('heading', { name: 'Advanced duplicate matching' }));
    expect(screen.queryByRole('dialog', { name: 'Custom rules help' })).not.toBeInTheDocument();
  });

  it('deletes custom rules and resets to conservative public defaults', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(() => Promise.resolve(true));
    render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={onSave}
        rules={[RULES[0] as DedupeRule]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete custom rule 1' }));
    expect(
      screen.getByText('No custom rules. Unmatched tabs require an exact full-URL match.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await user.click(screen.getByRole('button', { name: 'Reset rules' }));
    expect(
      screen.getByRole('switch', { name: 'Google Docs, Sheets & Slides preset' }),
    ).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Notion preset' })).not.toBeChecked();
    expect(screen.queryByRole('textbox', { name: 'URL pattern' })).not.toBeInTheDocument();

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(DEFAULT_DEDUPLICATION_RULES.map((rule) => ({ ...rule }))),
    );
  });

  it('explains strategy outcomes, precedence, and live keeper/closure preview', async () => {
    const user = userEvent.setup();
    const broad: DedupeRule = {
      comparisonMode: 'host',
      enabled: true,
      glob: 'app.example.com/*',
      id: 'broad',
    };
    const narrow: DedupeRule = {
      comparisonMode: 'full-path',
      enabled: true,
      glob: 'app.example.com/projects/*',
      id: 'narrow',
    };
    render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={vi.fn(() => Promise.resolve(true))}
        preview={{
          errorMessage: null,
          isLoading: false,
          keeperPreference: { tabId: 1, windowId: 1 },
          tabs: [
            {
              agentAssociated: false,
              agentDedupeProtected: false,
              id: 1,
              index: 0,
              pinned: false,
              title: 'Project 42',
              url: 'https://app.example.com/projects/42?view=board',
              windowId: 1,
              windowLabel: 'Current Window',
            },
            {
              agentAssociated: false,
              agentDedupeProtected: false,
              id: 2,
              index: 1,
              pinned: false,
              title: 'Project 99',
              url: 'https://app.example.com/projects/99',
              windowId: 1,
              windowLabel: 'Current Window',
            },
          ],
        }}
        rules={[broad, narrow]}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Advanced duplicate matching' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/custom rules run top to bottom; the first match decides/i),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'Ignore query and page section' })).toHaveLength(
      2,
    );
    expect(screen.getAllByRole('option', { name: 'Stop after the item ID' })).toHaveLength(2);
    expect(screen.getAllByRole('option', { name: 'One tab per site (high impact)' })).toHaveLength(
      2,
    );
    expect(
      screen.getByText('Treats every matching page on the same hostname as one tab.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/handled first by app\.example\.com - One tab per site/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Open tab URL')).toHaveLength(2);
    expect(screen.getAllByText('Compared as')).toHaveLength(2);
    expect(screen.getAllByText('app.example.com/projects/42?view=board')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /Preview matches/ }));
    const preview = screen.getByRole('region', { name: 'Duplicate match preview' });

    expect(within(preview).getByText('Project 42')).toBeInTheDocument();
    expect(within(preview).getByText(/Also closes: Project 99/)).toBeInTheDocument();
    expect(within(preview).getByText('Keep open')).toBeInTheDocument();
    expect(within(preview).getByText('Close 1')).toBeInTheDocument();
    expect(within(preview).getByText(/1 match .* 1 tab to close/)).toBeInTheDocument();
  });

  it('toggles each built-in preset as one setting', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(rules: readonly DedupeRule[]) => Promise<boolean>>(() =>
      Promise.resolve(true),
    );
    render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={onSave}
        rules={DEFAULT_DEDUPLICATION_RULES}
      />,
    );

    expect(
      screen.getByRole('switch', { name: 'Google Docs, Sheets & Slides preset' }),
    ).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Notion preset' })).not.toBeChecked();

    await user.click(screen.getByRole('switch', { name: 'Google Docs, Sheets & Slides preset' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedRules = onSave.mock.calls[0]?.[0];
    expect(savedRules?.slice(0, 3).every((rule) => rule.enabled)).toBe(true);
    expect(savedRules?.slice(3).every((rule) => !rule.enabled)).toBe(true);
  });

  it('shows every supported preset URL format in accessible popovers', async () => {
    const user = userEvent.setup();
    const clickOnlyUser = userEvent.setup({ skipHover: true });
    render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={vi.fn(() => Promise.resolve(true))}
        rules={DEFAULT_DEDUPLICATION_RULES}
      />,
    );
    const googleFormats = screen.getByRole('button', {
      name: 'Show supported Google URL formats',
    });
    const notionFormats = screen.getByRole('button', {
      name: 'Show supported Notion URL formats',
    });

    expect(screen.queryByText('Compared as')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.dedupe-preset-formats-tooltip')).toHaveLength(0);
    expect(googleFormats).toHaveAccessibleDescription(
      /Supported URL formats.*Docs:.*docs\.google\.com\/document\/d\/FILE_ID.*Sheets:.*docs\.google\.com\/spreadsheets\/d\/FILE_ID.*Slides:.*docs\.google\.com\/presentation\/d\/FILE_ID.*Anything after the file ID is ignored\./,
    );

    await user.hover(googleFormats);
    const googleTooltip = screen.getByRole('tooltip');
    expect(within(googleTooltip).getByText('Supported URL formats')).toBeInTheDocument();
    expect(within(googleTooltip).getByText('Docs:')).toBeInTheDocument();
    expect(
      within(googleTooltip).getByText('docs.google.com/document/d/FILE_ID'),
    ).toBeInTheDocument();
    expect(within(googleTooltip).getByText('Sheets:')).toBeInTheDocument();
    expect(
      within(googleTooltip).getByText('docs.google.com/spreadsheets/d/FILE_ID'),
    ).toBeInTheDocument();
    expect(within(googleTooltip).getByText('Slides:')).toBeInTheDocument();
    expect(
      within(googleTooltip).getByText('docs.google.com/presentation/d/FILE_ID'),
    ).toBeInTheDocument();
    expect(within(googleTooltip).getByText('Anything after the file ID is ignored.')).toBeVisible();

    await user.unhover(googleFormats);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(document.querySelectorAll('.dedupe-preset-formats-tooltip')).toHaveLength(0);

    act(() => googleFormats.focus());
    expect(screen.getByRole('tooltip')).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(googleFormats).toHaveFocus();
    act(() => googleFormats.blur());

    await clickOnlyUser.click(notionFormats);
    const notionTooltip = screen.getByRole('tooltip');
    expect(within(notionTooltip).getByText('notion.so/PAGE_PATH')).toBeInTheDocument();
    expect(within(notionTooltip).getByText('WORKSPACE.notion.so/PAGE_PATH')).toBeInTheDocument();
    expect(within(notionTooltip).getByText('notion.com/PAGE_PATH')).toBeInTheDocument();
    expect(within(notionTooltip).getByText('app.notion.com/PAGE_PATH')).toBeInTheDocument();
    expect(
      within(notionTooltip).getByText('Query parameters and page sections are ignored.'),
    ).toBeVisible();
    expect(notionFormats).toHaveAccessibleDescription(
      /Supported URL formats.*notion\.so\/PAGE_PATH.*WORKSPACE\.notion\.so\/PAGE_PATH.*notion\.com\/PAGE_PATH.*app\.notion\.com\/PAGE_PATH.*Query parameters and page sections are ignored\./,
    );

    act(() => expect(dismissTransientSurfacesForCommandPalette()).toBe(true));
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());

    await clickOnlyUser.click(notionFormats);
    await clickOnlyUser.click(screen.getByRole('heading', { name: 'Advanced duplicate matching' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.dedupe-preset-formats-tooltip')).toHaveLength(0);

    await clickOnlyUser.click(notionFormats);
    await clickOnlyUser.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(notionFormats).toHaveFocus();
  });

  it('closes a clicked tooltip on mouse leave and keeps only one preset tooltip open', async () => {
    const user = userEvent.setup();
    render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={vi.fn(() => Promise.resolve(true))}
        rules={DEFAULT_DEDUPLICATION_RULES}
      />,
    );
    const googleFormats = screen.getByRole('button', {
      name: 'Show supported Google URL formats',
    });
    const notionFormats = screen.getByRole('button', {
      name: 'Show supported Notion URL formats',
    });

    await user.click(googleFormats);
    expect(googleFormats).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('docs.google.com/document/d/FILE_ID');

    await user.unhover(googleFormats);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(googleFormats).toHaveFocus();

    act(() => googleFormats.blur());
    act(() => googleFormats.focus());
    expect(screen.getByRole('tooltip')).toHaveTextContent('docs.google.com/document/d/FILE_ID');

    await user.hover(notionFormats);
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    expect(document.querySelectorAll('.dedupe-preset-formats-tooltip')).toHaveLength(1);
    expect(screen.getByRole('tooltip')).toHaveTextContent('notion.so/PAGE_PATH');

    await user.unhover(notionFormats);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(document.querySelectorAll('.dedupe-preset-formats-tooltip')).toHaveLength(0);
  });

  it('derives the item-ID cutoff from the custom pattern', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(() => Promise.resolve(true));
    render(
      <DedupeRuleEditor
        advancedDuplicateMatchingEnabled
        disabled={false}
        onSave={onSave}
        rules={[
          {
            comparisonMode: 'full-path',
            enabled: true,
            glob: 'app.example.com/workspaces/*/items/*',
            id: 'custom-item',
          },
        ]}
      />,
    );

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Matching behavior' }),
      'path-prefix',
    );
    await user.click(screen.getByRole('button', { name: 'Save custom rules' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([
        {
          comparisonMode: 'path-prefix',
          enabled: true,
          glob: 'app.example.com/workspaces/*/items/*',
          id: 'custom-item',
          pathSegmentCount: 4,
        },
      ]),
    );
  });
});
