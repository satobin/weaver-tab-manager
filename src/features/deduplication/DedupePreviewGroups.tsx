import { type DedupePreviewGroup, type DedupePreviewTab } from './dedupeRulePresentation';

interface DedupePreviewGroupsProps {
  groups: readonly DedupePreviewGroup[];
}

interface DedupePreviewSection {
  closeCount: number;
  groups: DedupePreviewGroup[];
  id: string;
  name: string;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function summarizeWindows(tabs: readonly DedupePreviewTab[]) {
  const countsByWindow = new Map<string, number>();

  for (const tab of tabs) {
    countsByWindow.set(tab.windowLabel, (countsByWindow.get(tab.windowLabel) ?? 0) + 1);
  }

  return Array.from(countsByWindow.entries())
    .map(([windowLabel, count]) => (count === 1 ? windowLabel : `${windowLabel} (${count})`))
    .join(', ');
}

function normalizeTitle(title: string) {
  return title.trim().toLowerCase();
}

function getAlternateCloseTitles(group: DedupePreviewGroup) {
  const keepTitle = normalizeTitle(group.keepTab.title);
  const seenTitles = new Set<string>();
  const alternateTitles: string[] = [];

  for (const tab of group.closeTabs) {
    const normalizedTitle = normalizeTitle(tab.title);

    if (normalizedTitle === keepTitle || seenTitles.has(normalizedTitle)) {
      continue;
    }

    seenTitles.add(normalizedTitle);
    alternateTitles.push(tab.title);
  }

  return alternateTitles;
}

function getCloseDetails(tabs: readonly DedupePreviewTab[]) {
  return tabs.map((tab) => `${tab.title} - ${tab.windowLabel}`).join('\n');
}

function groupBySection(groups: readonly DedupePreviewGroup[]) {
  const sections = new Map<string, DedupePreviewSection>();

  for (const group of groups) {
    const id = group.sectionId;
    const existing = sections.get(id);

    if (existing) {
      existing.groups.push(group);
      existing.closeCount += group.closeTabs.length;
      continue;
    }

    sections.set(id, {
      closeCount: group.closeTabs.length,
      groups: [group],
      id,
      name: group.ruleName,
    });
  }

  return Array.from(sections.values());
}

export function DedupePreviewGroups({ groups }: DedupePreviewGroupsProps) {
  const sections = groupBySection(groups);

  return (
    <div className="dedupe-preview-groups">
      {sections.map((section) => (
        <section className="dedupe-preview-rule-section" key={section.id}>
          <header className="dedupe-preview-rule-header">
            <h4>{section.name}</h4>
            <span>
              {pluralize(section.groups.length, 'match', 'matches')} &middot;{' '}
              {pluralize(section.closeCount, 'tab')} would close
            </span>
          </header>
          <ul className="dedupe-preview-match-list">
            {section.groups.map((group, groupIndex) => {
              const alternateTitles = getAlternateCloseTitles(group);
              const closeDetails = getCloseDetails(group.closeTabs);

              return (
                <li
                  className="dedupe-preview-match-row"
                  key={`${section.id}-${groupIndex}-${group.identity}`}
                >
                  <div className="dedupe-preview-match-copy">
                    <strong title={group.keepTab.title}>{group.keepTab.title}</strong>
                    <code title={group.identity}>{group.identity}</code>
                    {alternateTitles.length > 0 ? (
                      <span title={alternateTitles.join('\n')}>
                        Also closes: {alternateTitles.join(', ')}
                      </span>
                    ) : null}
                  </div>
                  <dl className="dedupe-preview-match-decisions">
                    <div>
                      <dt className="dedupe-preview-action is-keep">Keep open</dt>
                      <dd title={group.keepTab.windowLabel}>{group.keepTab.windowLabel}</dd>
                    </div>
                    <div>
                      <dt className="dedupe-preview-action is-close">
                        Close {group.closeTabs.length}
                      </dt>
                      <dd title={closeDetails}>{summarizeWindows(group.closeTabs)}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
