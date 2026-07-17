import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { type DedupeRule, DEFAULT_DEDUPLICATION_RULES } from './deduplication';
import { DedupeRuleEditor } from './DedupeRuleEditor';

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

describe('DedupeRuleEditor', () => {
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

    await user.click(screen.getByRole('button', { name: 'Add custom rule' }));
    expect(screen.getByText('Enter a hostname and optional path pattern.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save custom rules' })).toBeDisabled();

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
              id: 1,
              index: 0,
              title: 'Project 42',
              url: 'https://app.example.com/projects/42?view=board',
              windowId: 1,
              windowLabel: 'Current Window',
            },
            {
              id: 2,
              index: 1,
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
    expect(screen.getAllByText('Compared as')).toHaveLength(4);
    expect(screen.getAllByText('app.example.com/projects/42?view=board')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /Preview matches/ }));
    const preview = screen.getByRole('region', { name: 'Duplicate match preview' });

    expect(within(preview).getByText('Project 42')).toBeInTheDocument();
    expect(within(preview).getByText(/Also closes: Project 99/)).toBeInTheDocument();
    expect(within(preview).getByText('Keep open')).toBeInTheDocument();
    expect(within(preview).getByText('Close 1')).toBeInTheDocument();
    expect(within(preview).getByText(/1 match .* 1 tab would close/)).toBeInTheDocument();
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
    expect(screen.getByText('docs.google.com/document/d/FILE_ID')).toBeInTheDocument();
    expect(screen.getByText('notion.com/your-page-path')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Google Docs, Sheets & Slides preset' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedRules = onSave.mock.calls[0]?.[0];
    expect(savedRules?.slice(0, 3).every((rule) => rule.enabled)).toBe(true);
    expect(savedRules?.slice(3).every((rule) => !rule.enabled)).toBe(true);
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
