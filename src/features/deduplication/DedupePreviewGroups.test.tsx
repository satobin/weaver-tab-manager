import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { type DedupeRule, DEFAULT_DEDUPLICATION_RULES } from './deduplication';
import { DedupePreviewGroups } from './DedupePreviewGroups';
import { buildDedupePreview, type DedupePreviewTab } from './dedupeRulePresentation';

function createTab(id: number, title: string, url: string): DedupePreviewTab {
  return {
    agentAssociated: false,
    agentDedupeProtected: false,
    id,
    index: id - 1,
    pinned: false,
    title,
    url,
    windowId: 1,
    windowLabel: 'Current Window',
  };
}

describe('DedupePreviewGroups', () => {
  it('consolidates Google and Notion matches under their built-in preset headings', () => {
    const notionPageId = '00000000000000000000000000000000';
    const rules: DedupeRule[] = DEFAULT_DEDUPLICATION_RULES.map((rule) => ({
      ...rule,
      enabled: true,
    }));
    const groups = buildDedupePreview(
      [
        createTab(
          1,
          'Roadmap',
          'https://docs.google.com/document/d/1ExampleDocumentId_0123456789AbCdEf/edit?usp=sharing',
        ),
        createTab(
          2,
          'Roadmap copy',
          'https://docs.google.com/document/d/1ExampleDocumentId_0123456789AbCdEf/preview',
        ),
        createTab(
          3,
          'Budget',
          'https://docs.google.com/spreadsheets/d/1ExampleSpreadsheetId_0123456789AbCd/edit#gid=0',
        ),
        createTab(
          4,
          'Budget copy',
          'https://docs.google.com/spreadsheets/d/1ExampleSpreadsheetId_0123456789AbCd/preview',
        ),
        createTab(
          5,
          'Notion roadmap',
          `https://notion.so/acme/Roadmap-${notionPageId}?view=timeline`,
        ),
        createTab(
          6,
          'Notion roadmap copy',
          `https://notion.so/acme/Roadmap-${notionPageId}?view=table`,
        ),
        createTab(7, 'Notion tasks', `https://notion.com/p/acme/Tasks-${notionPageId}?view=board`),
        createTab(
          8,
          'Notion tasks copy',
          `https://notion.com/p/acme/Tasks-${notionPageId}?view=list`,
        ),
        createTab(
          9,
          'Launch deck',
          'https://docs.google.com/presentation/d/1ExamplePresentationId_0123456789AbCd/edit',
        ),
        createTab(
          10,
          'Launch deck copy',
          'https://docs.google.com/presentation/d/1ExamplePresentationId_0123456789AbCd/present',
        ),
        createTab(
          11,
          'Notion backlog',
          `https://acme.notion.so/Backlog-${notionPageId}?view=board`,
        ),
        createTab(
          12,
          'Notion backlog copy',
          `https://acme.notion.so/Backlog-${notionPageId}?view=list`,
        ),
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
      within(googleSection as HTMLElement).getByText(/3 matches .* 3 tabs to close/),
    ).toBeInTheDocument();

    expect(screen.getAllByRole('heading', { name: 'Notion' })).toHaveLength(1);
    const notionSection = screen.getByRole('heading', { name: 'Notion' }).closest('section');
    expect(notionSection).not.toBeNull();
    expect(
      within(notionSection as HTMLElement).getByText(/3 matches .* 3 tabs to close/),
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
      within(exactSection as HTMLElement).getByText(/2 matches .* 2 tabs to close/),
    ).toBeInTheDocument();
    expect(screen.getByText('alpha.example.com - Same page')).toBeInTheDocument();
    expect(screen.getByText('beta.example.com - Same page')).toBeInTheDocument();
    expect(screen.queryByText('Google Docs, Sheets & Slides')).not.toBeInTheDocument();
  });

  it('shows every protected pinned tab as kept', () => {
    const url = 'https://example.com/duplicate';
    const firstPinned = {
      ...createTab(1, 'Pinned in current', url),
      pinned: true,
    };
    const secondPinned = {
      ...createTab(2, 'Pinned elsewhere', url),
      pinned: true,
      windowId: 2,
      windowLabel: 'Window 2',
    };
    const closeTab = createTab(3, 'Unpinned copy', url);

    render(
      <DedupePreviewGroups
        groups={buildDedupePreview([firstPinned, secondPinned, closeTab], [], {
          tabId: closeTab.id,
          windowId: closeTab.windowId,
        })}
      />,
    );

    expect(screen.getByText('Keep 2 pinned')).toBeInTheDocument();
    expect(screen.getByText('Pinned in current - Current Window')).toBeVisible();
    expect(screen.getByText('Pinned elsewhere - Window 2')).toBeVisible();
    expect(screen.getByText('Close 1')).toBeInTheDocument();
  });

  it('does not label a finished agent-associated keeper as protected', () => {
    const url = 'https://example.com/finished-agent-duplicate';
    const finishedAgentTab = {
      ...createTab(1, 'Finished agent tab', url),
      agentAssociated: true,
      agentDedupeProtected: false,
    };
    const duplicate = createTab(2, 'Ordinary duplicate', url);

    render(
      <DedupePreviewGroups
        groups={buildDedupePreview([finishedAgentTab, duplicate], [], {
          tabId: finishedAgentTab.id,
          windowId: finishedAgentTab.windowId,
        })}
      />,
    );

    expect(screen.getByText('Keep open')).toBeInTheDocument();
    expect(screen.queryByText('Keep protected')).not.toBeInTheDocument();
    expect(screen.getByText('Close 1')).toBeInTheDocument();
  });
});
