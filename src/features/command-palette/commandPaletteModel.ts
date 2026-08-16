import { APP_ROUTES, createAppRouteQuery } from '../../app/routes';
import {
  type ActiveWindowsSnapshot,
  isTabSuspended,
  type TabGroupColor,
} from '../active-windows/model';
import { type SavedWindow } from '../saved-windows/savedWindowModel';

export const COMMAND_PALETTE_SECTION_ORDER = [
  'open-tabs',
  'tab-groups',
  'saved',
  'settings',
  'actions',
  'go-to',
] as const;

export type CommandPaletteSectionId = (typeof COMMAND_PALETTE_SECTION_ORDER)[number];

export type CommandPaletteIcon =
  | 'about'
  | 'action'
  | 'active-windows'
  | 'saved-window'
  | 'settings'
  | 'tab'
  | 'tab-group';

export type CommandPaletteAction =
  | {
      type: 'focus-active-tab';
      tabId: number;
      windowId: number;
    }
  | {
      type: 'navigate';
      hash: string;
    }
  | {
      type: 'open-saved-tab';
      pinned: boolean;
      url: string;
    };

export interface CommandPaletteTabState {
  active: boolean;
  agentAssociated: boolean;
  agentDedupeProtected: boolean;
  pinned: boolean;
  suspended: boolean;
}

export interface CommandPaletteResult {
  action: CommandPaletteAction;
  groupColor?: TabGroupColor | undefined;
  icon: CommandPaletteIcon;
  iconUrl?: string | null | undefined;
  id: string;
  section: CommandPaletteSectionId;
  state?: CommandPaletteTabState | undefined;
  subtitle: string;
  title: string;
}

export interface CommandPaletteSection {
  id: CommandPaletteSectionId;
  label: string;
  results: CommandPaletteResult[];
}

interface Candidate extends CommandPaletteResult {
  directSearchValues: readonly string[];
  order: number;
  searchValues: readonly string[];
  showWhenEmpty?: boolean;
}

interface BuildCommandPaletteSectionsInput {
  activeSnapshot: ActiveWindowsSnapshot | null;
  query: string;
  savedWindows: readonly SavedWindow[];
}

const SECTION_LABELS: Record<CommandPaletteSectionId, string> = {
  'open-tabs': 'Open tabs',
  'tab-groups': 'Tab groups',
  saved: 'Saved',
  settings: 'Settings',
  actions: 'Actions',
  'go-to': 'Go to',
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function tokenize(query: string): string[] {
  return normalize(query).split(/\s+/u).filter(Boolean);
}

function matches(values: readonly string[], terms: readonly string[]): boolean {
  if (terms.length === 0) {
    return true;
  }
  const haystack = normalize(values.join(' '));
  return terms.every((term) => haystack.includes(term));
}

function getCandidateRank(candidate: Candidate, query: string, terms: readonly string[]): number {
  const normalizedQuery = normalize(query);
  const title = normalize(candidate.title);
  const directText = normalize(candidate.directSearchValues.join(' '));
  if (title === normalizedQuery) {
    return 0;
  }
  if (title.startsWith(normalizedQuery)) {
    return 1;
  }
  if (title.includes(normalizedQuery)) {
    return 2;
  }
  if (matches(candidate.directSearchValues, terms)) {
    return 3;
  }
  if (directText.includes(normalizedQuery)) {
    return 4;
  }
  return 5;
}

function filterCandidates(
  candidates: readonly Candidate[],
  query: string,
  terms: readonly string[],
): CommandPaletteResult[] {
  return candidates
    .filter((candidate) =>
      terms.length === 0
        ? candidate.showWhenEmpty === true
        : matches(candidate.searchValues, terms),
    )
    .sort((first, second) => {
      const rankDifference =
        getCandidateRank(first, query, terms) - getCandidateRank(second, query, terms);
      return rankDifference || first.order - second.order;
    })
    .map(({ action, groupColor, icon, iconUrl, id, section, state, subtitle, title }) => ({
      action,
      groupColor,
      icon,
      iconUrl,
      id,
      section,
      state,
      subtitle,
      title,
    }));
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function formatDomain(url: string, extensionOrigin = ''): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'chrome-extension:') {
      return extensionOrigin && url.startsWith(extensionOrigin) ? 'Weaver' : 'Browser extension';
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname.replace(/^www\./u, '');
    }
  } catch {
    // Fall through to the compact raw value.
  }
  return url.replace(/\/$/u, '') || 'Address unavailable';
}

function createStaticCandidates(): Candidate[] {
  let order = 0;
  const createCandidate = (
    candidate: Omit<Candidate, 'directSearchValues' | 'order' | 'searchValues'> & {
      aliases?: readonly string[];
      keywords?: readonly string[];
    },
  ): Candidate => {
    const { aliases = [], keywords = [], ...result } = candidate;
    return {
      ...result,
      directSearchValues: [result.title, result.subtitle, ...aliases],
      order: order++,
      searchValues: [result.title, result.subtitle, ...aliases, ...keywords],
    };
  };

  return [
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.settings, { focus: 'settings-appearance' }),
        type: 'navigate',
      },
      aliases: ['theme', 'dark mode', 'light mode', 'color scheme'],
      icon: 'settings',
      id: 'setting:appearance',
      section: 'settings',
      subtitle: 'Choose light, dark, or system color scheme',
      title: 'Appearance',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.settings, {
          focus: 'settings-keyboard-shortcuts',
        }),
        type: 'navigate',
      },
      aliases: ['hotkeys', 'commands'],
      icon: 'settings',
      id: 'setting:keyboard-shortcuts',
      section: 'settings',
      subtitle: 'View and customize browser shortcuts',
      title: 'Keyboard shortcuts',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.settings, { focus: 'settings-show-tab-urls' }),
        type: 'navigate',
      },
      aliases: ['addresses', 'domains'],
      icon: 'settings',
      id: 'setting:show-tab-urls',
      section: 'settings',
      subtitle: 'Show addresses below open-tab titles',
      title: 'Show tab URLs',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.settings, {
          focus: 'settings-duplicate-matching',
        }),
        type: 'navigate',
      },
      aliases: ['dedupe', 'duplicate rules', 'url matching'],
      icon: 'settings',
      id: 'setting:advanced-duplicate-matching',
      section: 'settings',
      subtitle: 'Configure Google, Notion, and custom URL rules',
      title: 'Advanced duplicate matching',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.settings, {
          focus: 'settings-duplicate-matching',
        }),
        type: 'navigate',
      },
      aliases: ['notion preset', 'notion duplicates'],
      icon: 'settings',
      id: 'setting:notion-url-matching',
      section: 'settings',
      subtitle: 'Advanced duplicate matching',
      title: 'Notion URL matching',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.settings, {
          focus: 'settings-duplicate-matching',
        }),
        type: 'navigate',
      },
      aliases: ['google docs', 'google sheets', 'google slides'],
      icon: 'settings',
      id: 'setting:google-url-matching',
      section: 'settings',
      subtitle: 'Advanced duplicate matching',
      title: 'Google file URL matching',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.settings, {
          focus: 'settings-duplicate-matching',
        }),
        type: 'navigate',
      },
      aliases: ['url glob', 'import rules', 'export rules'],
      icon: 'settings',
      id: 'setting:custom-url-rules',
      section: 'settings',
      subtitle: 'Create, import, and export duplicate rules',
      title: 'Custom URL rules',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.windows, {
          focus: 'active-duplicate-actions',
          view: 'duplicates',
        }),
        type: 'navigate',
      },
      aliases: ['close duplicate tabs', 'dedupe open tabs'],
      icon: 'action',
      id: 'action:preview-open-duplicates',
      section: 'actions',
      showWhenEmpty: true,
      subtitle: 'Review open-tab duplicates before closing anything',
      title: 'Preview duplicate tabs',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.savedWindows, {
          focus: 'saved-duplicate-actions',
        }),
        type: 'navigate',
      },
      aliases: ['saved dedupe', 'remove saved duplicates'],
      icon: 'action',
      id: 'action:preview-saved-duplicates',
      section: 'actions',
      showWhenEmpty: true,
      subtitle: 'Open the Saved Windows duplicate review',
      title: 'Review saved duplicate tabs',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.windows, { focus: 'active-merge-actions' }),
        type: 'navigate',
      },
      aliases: ['combine windows'],
      icon: 'action',
      id: 'action:merge-windows',
      section: 'actions',
      showWhenEmpty: true,
      subtitle: 'Choose windows to combine',
      title: 'Merge windows',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.savedWindows, {
          focus: 'saved-merge-actions',
        }),
        type: 'navigate',
      },
      aliases: ['combine saved windows'],
      icon: 'action',
      id: 'action:merge-saved-windows',
      section: 'actions',
      showWhenEmpty: true,
      subtitle: 'Choose saved windows to combine',
      title: 'Merge saved windows',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.windows, { focus: 'page-title' }),
        type: 'navigate',
      },
      aliases: ['open tabs', 'browser windows'],
      icon: 'active-windows',
      id: 'navigation:active-windows',
      section: 'go-to',
      showWhenEmpty: true,
      subtitle: 'Manage tabs open in the browser',
      title: 'Active Windows',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.savedWindows, { focus: 'page-title' }),
        type: 'navigate',
      },
      aliases: ['saved tabs', 'archives'],
      icon: 'saved-window',
      id: 'navigation:saved-windows',
      section: 'go-to',
      showWhenEmpty: true,
      subtitle: 'Browse saved windows and tabs',
      title: 'Saved Windows',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.settings, { focus: 'page-title' }),
        type: 'navigate',
      },
      aliases: ['preferences'],
      icon: 'settings',
      id: 'navigation:settings',
      section: 'go-to',
      showWhenEmpty: true,
      subtitle: 'Customize Weaver',
      title: 'Settings',
    }),
    createCandidate({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.about, { focus: 'page-title' }),
        type: 'navigate',
      },
      aliases: ['privacy', 'version', 'support'],
      icon: 'about',
      id: 'navigation:about',
      section: 'go-to',
      showWhenEmpty: true,
      subtitle: 'Privacy, support, and version information',
      title: 'About Weaver',
    }),
  ];
}

function createActiveCandidates(
  snapshot: ActiveWindowsSnapshot | null,
  queryTerms: readonly string[],
): Candidate[] {
  if (!snapshot || queryTerms.length === 0) {
    return [];
  }
  const candidates: Candidate[] = [];
  let order = 0;
  snapshot.windows.forEach((window) => {
    const groupsById = new Map(window.groups.map((group) => [group.id, group]));
    [...window.tabs]
      .sort((first, second) => first.index - second.index)
      .forEach((tab) => {
        const group = tab.groupId === null ? undefined : groupsById.get(tab.groupId);
        const groupTitle = group ? group.title.trim() || 'Untitled group' : '';
        const domain = formatDomain(tab.url, snapshot.extensionOrigin);
        const subtitle = groupTitle ? `${groupTitle} · ${domain}` : domain;
        candidates.push({
          action: { tabId: tab.id, type: 'focus-active-tab', windowId: tab.windowId },
          directSearchValues: [tab.title, tab.url, domain, groupTitle],
          ...(group ? { groupColor: group.color } : {}),
          icon: 'tab',
          iconUrl: tab.iconUrl,
          id: `active-tab:${window.id}:${tab.id}`,
          order: order++,
          searchValues: [tab.title, tab.url, domain, groupTitle, window.label],
          section: 'open-tabs',
          state: {
            active: tab.active,
            agentAssociated: tab.agentAssociated,
            agentDedupeProtected: tab.agentDedupeProtected,
            pinned: tab.pinned,
            suspended: isTabSuspended(tab),
          },
          subtitle,
          title: tab.title || domain,
        });
      });

    window.groups.forEach((group) => {
      const children = window.tabs
        .filter((tab) => tab.groupId === group.id)
        .sort((first, second) => first.index - second.index);
      if (children.length === 0) {
        return;
      }
      const groupTitle = group.title.trim() || 'Untitled group';
      const matchingChildren = children.filter((tab) =>
        matches([tab.title, tab.url, formatDomain(tab.url, snapshot.extensionOrigin)], queryTerms),
      );
      const targetTab = children[0];
      if (!targetTab) {
        return;
      }
      const childCount = matchingChildren.length || children.length;
      candidates.push({
        action: {
          tabId: targetTab.id,
          type: 'focus-active-tab',
          windowId: targetTab.windowId,
        },
        directSearchValues: [groupTitle, group.color, 'tab group'],
        groupColor: group.color,
        icon: 'tab-group',
        id: `active-group:${window.id}:${group.id}`,
        order: order++,
        searchValues: [
          groupTitle,
          group.color,
          'tab group',
          ...children.flatMap((tab) => [tab.title, tab.url]),
        ],
        section: 'tab-groups',
        subtitle: `Tab group · ${pluralize(childCount, matchingChildren.length ? 'matching tab' : 'tab')}`,
        title: groupTitle,
      });
    });
  });
  return candidates;
}

function createSavedCandidates(
  savedWindows: readonly SavedWindow[],
  queryTerms: readonly string[],
): Candidate[] {
  if (queryTerms.length === 0) {
    return [];
  }
  const candidates: Candidate[] = [];
  let order = 0;
  savedWindows.forEach((savedWindow) => {
    const groupsByKey = new Map(savedWindow.groups.map((group) => [group.key, group]));
    const descendantValues = [
      ...savedWindow.groups.map((group) => group.title),
      ...savedWindow.tabs.flatMap((tab) => [tab.title, tab.url]),
    ];
    candidates.push({
      action: {
        hash: createAppRouteQuery(APP_ROUTES.savedWindows, {
          savedWindowId: savedWindow.id,
          search: savedWindow.name,
        }),
        type: 'navigate',
      },
      directSearchValues: [savedWindow.name, 'saved window'],
      icon: 'saved-window',
      id: `saved-window:${savedWindow.id}`,
      order: order++,
      searchValues: [savedWindow.name, 'saved window', ...descendantValues],
      section: 'saved',
      subtitle: `Saved window · ${pluralize(savedWindow.tabs.length, 'tab')}`,
      title: savedWindow.name,
    });

    savedWindow.tabs.forEach((tab) => {
      const group = tab.groupKey ? groupsByKey.get(tab.groupKey) : undefined;
      const groupTitle = group ? group.title.trim() || 'Untitled group' : '';
      const domain = formatDomain(tab.url);
      const subtitle = groupTitle ? `${groupTitle} · ${domain}` : domain;
      candidates.push({
        action: { pinned: tab.pinned, type: 'open-saved-tab', url: tab.url },
        directSearchValues: [tab.title, tab.url, groupTitle, savedWindow.name],
        ...(group ? { groupColor: group.color } : {}),
        icon: 'tab',
        id: `saved-tab:${savedWindow.id}:${tab.order}`,
        order: order++,
        searchValues: [tab.title, tab.url, groupTitle, savedWindow.name, 'saved tab'],
        section: 'saved',
        state: {
          active: false,
          agentAssociated: false,
          agentDedupeProtected: false,
          pinned: tab.pinned,
          suspended: false,
        },
        subtitle,
        title: tab.title || formatDomain(tab.url),
      });
    });

    savedWindow.groups.forEach((group) => {
      const children = savedWindow.tabs.filter((tab) => tab.groupKey === group.key);
      if (children.length === 0) {
        return;
      }
      const groupTitle = group.title.trim() || 'Untitled group';
      const matchingChildren = children.filter((tab) =>
        matches([tab.title, tab.url, formatDomain(tab.url)], queryTerms),
      );
      const childCount = matchingChildren.length || children.length;
      candidates.push({
        action: {
          hash: createAppRouteQuery(APP_ROUTES.savedWindows, {
            groupKey: group.key,
            savedWindowId: savedWindow.id,
            search: groupTitle,
          }),
          type: 'navigate',
        },
        directSearchValues: [groupTitle, group.color, 'saved tab group'],
        groupColor: group.color,
        icon: 'tab-group',
        id: `saved-group:${savedWindow.id}:${group.key}`,
        order: order++,
        searchValues: [
          groupTitle,
          group.color,
          'saved tab group',
          savedWindow.name,
          ...children.flatMap((tab) => [tab.title, tab.url]),
        ],
        section: 'tab-groups',
        subtitle: `Saved tab group · ${pluralize(childCount, matchingChildren.length ? 'matching tab' : 'tab')}`,
        title: groupTitle,
      });
    });
  });
  return candidates;
}

export function buildCommandPaletteSections({
  activeSnapshot,
  query,
  savedWindows,
}: BuildCommandPaletteSectionsInput): CommandPaletteSection[] {
  const terms = tokenize(query);
  const candidates = [
    ...createActiveCandidates(activeSnapshot, terms),
    ...createSavedCandidates(savedWindows, terms),
    ...createStaticCandidates(),
  ];
  return COMMAND_PALETTE_SECTION_ORDER.flatMap((sectionId) => {
    const results = filterCandidates(
      candidates.filter((candidate) => candidate.section === sectionId),
      query,
      terms,
    );
    return results.length > 0 ? [{ id: sectionId, label: SECTION_LABELS[sectionId], results }] : [];
  });
}
