import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { type DedupeRule, DEFAULT_DEDUPLICATION_RULES } from './deduplication';
import { DedupePreviewGroups } from './DedupePreviewGroups';
import { buildDedupePreview, type DedupePreviewTab } from './dedupeRulePresentation';

function createTab(id: number, title: string, url: string): DedupePreviewTab {
  return {
    id,
    index: id - 1,
    title,
    url,
    windowId: 1,
    windowLabel: 'Current Window',
  };
}

describe('DedupePreviewGroups', () => {
  it('consolidates Google and Notion matches under their built-in preset headings', () => {
    const rules: DedupeRule[] = DEFAULT_DEDUPLICATION_RULES.map((rule) => ({
      ...rule,
      enabled: true,
    }));
    const groups = buildDedupePreview(
      [
        createTab(1, 'Roadmap', 'https://docs.google.com/document/d/doc-1/edit?usp=sharing'),
        createTab(2, 'Roadmap copy', 'https://docs.google.com/document/d/doc-1/preview'),
        createTab(3, 'Budget', 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0'),
        createTab(4, 'Budget copy', 'https://docs.google.com/spreadsheets/d/sheet-1/preview'),
        createTab(5, 'Notion roadmap', 'https://notion.so/roadmap?view=timeline'),
        createTab(6, 'Notion roadmap copy', 'https://notion.so/roadmap?view=table'),
        createTab(7, 'Notion tasks', 'https://notion.com/tasks?view=board'),
        createTab(8, 'Notion tasks copy', 'https://notion.com/tasks?view=list'),
        createTab(9, 'Launch deck', 'https://docs.google.com/presentation/d/deck-1/edit'),
        createTab(10, 'Launch deck copy', 'https://docs.google.com/presentation/d/deck-1/present'),
        createTab(11, 'Notion backlog', 'https://acme.notion.so/backlog?view=board'),
        createTab(12, 'Notion backlog copy', 'https://acme.notion.so/backlog?view=list'),
      ],
      rules,
      {},
    );

    render(<DedupePreviewGroups groups={groups} />);

    expect(screen.getAllByRole('heading', { name: 'Google Docs, Sheets & Slides' })).toHaveLength(
      1,
    );
    const googleSection = screen
      .getByRole('heading', { name: 'Google Docs, Sheets & Slides' })
      .closest('section');
    expect(googleSection).not.toBeNull();
    expect(
      within(googleSection as HTMLElement).getByText(/3 matches .* 3 tabs would close/),
    ).toBeInTheDocument();

    expect(screen.getAllByRole('heading', { name: 'Notion' })).toHaveLength(1);
    const notionSection = screen.getByRole('heading', { name: 'Notion' }).closest('section');
    expect(notionSection).not.toBeNull();
    expect(
      within(notionSection as HTMLElement).getByText(/3 matches .* 3 tabs would close/),
    ).toBeInTheDocument();
  });

  it('keeps exact matches together and distinct custom rules in separate sections', () => {
    const reusedBuiltInId: DedupeRule = {
      comparisonMode: 'full-path',
      enabled: true,
      glob: 'alpha.example.com/*',
      id: 'builtin-google-docs',
    };
    const secondCustomRule: DedupeRule = {
      comparisonMode: 'full-path',
      enabled: true,
      glob: 'beta.example.com/*',
      id: 'custom-beta',
    };
    const groups = buildDedupePreview(
      [
        createTab(1, 'Exact A', 'https://unmatched.example.com/a'),
        createTab(2, 'Exact A copy', 'https://unmatched.example.com/a'),
        createTab(3, 'Exact B', 'https://unmatched.example.com/b'),
        createTab(4, 'Exact B copy', 'https://unmatched.example.com/b'),
        createTab(5, 'Alpha', 'https://alpha.example.com/item?view=one'),
        createTab(6, 'Alpha copy', 'https://alpha.example.com/item?view=two'),
        createTab(7, 'Beta', 'https://beta.example.com/item?view=one'),
        createTab(8, 'Beta copy', 'https://beta.example.com/item?view=two'),
      ],
      [reusedBuiltInId, secondCustomRule],
      {},
    );

    expect(groups.find((group) => group.ruleId === 'builtin-google-docs')?.sectionId).toBe(
      'rule:builtin-google-docs',
    );

    render(<DedupePreviewGroups groups={groups} />);

    const exactSection = screen
      .getByRole('heading', { name: 'Exact URL match' })
      .closest('section');
    expect(exactSection).not.toBeNull();
    expect(
      within(exactSection as HTMLElement).getByText(/2 matches .* 2 tabs would close/),
    ).toBeInTheDocument();
    expect(screen.getByText('alpha.example.com - Same page')).toBeInTheDocument();
    expect(screen.getByText('beta.example.com - Same page')).toBeInTheDocument();
    expect(screen.queryByText('Google Docs, Sheets & Slides')).not.toBeInTheDocument();
  });
});
