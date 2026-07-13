import { describe, expect, it } from 'vitest';

import {
  createActiveWindowsSnapshot,
  createManagedTab,
  createManagedWindow,
} from '../../test/activeWindowsFixtures';
import { filterActiveWindows, formatTabLocation, isNewTabUrl } from './model';

describe('isNewTabUrl', () => {
  it.each([
    'chrome://newtab/',
    'chrome://new-tab-page/',
    'edge://newtab/',
    'brave://newtab/',
    'about:newtab',
  ])('recognizes %s', (url) => {
    expect(isNewTabUrl(url)).toBe(true);
  });

  it.each(['https://example.com/', 'chrome://extensions/', 'not a url'])('rejects %s', (url) => {
    expect(isNewTabUrl(url)).toBe(false);
  });
});

describe('filterActiveWindows', () => {
  const snapshot = createActiveWindowsSnapshot({
    windows: [
      createManagedWindow({
        groups: [
          {
            collapsed: false,
            color: 'blue',
            id: 7,
            title: 'Research',
            windowId: 1,
          },
        ],
        tabs: [
          createManagedTab({ groupId: 7, title: 'Alpha notes', url: 'https://example.com/a' }),
          createManagedTab({ id: 102, index: 1, title: 'Beta', url: 'https://docs.test/report' }),
        ],
      }),
      createManagedWindow({
        focused: false,
        id: 2,
        isCurrent: false,
        label: 'Window 1',
        tabs: [
          createManagedTab({
            id: 201,
            title: 'Unrelated',
            url: 'https://other.test',
            windowId: 2,
          }),
        ],
      }),
    ],
  });

  it('matches title and URL case-insensitively and hides empty windows', () => {
    const byTitle = filterActiveWindows(snapshot, 'ALPHA');
    expect(byTitle.matchingTabs).toBe(1);
    expect(byTitle.totalTabs).toBe(3);
    expect(byTitle.windows).toHaveLength(1);
    expect(byTitle.windows[0]?.tabs.map((tab) => tab.title)).toEqual(['Alpha notes']);
    expect(byTitle.windows[0]?.groups.map((group) => group.id)).toEqual([7]);

    const byUrl = filterActiveWindows(snapshot, 'DOCS.TEST');
    expect(byUrl.windows[0]?.tabs.map((tab) => tab.title)).toEqual(['Beta']);
    expect(byUrl.windows[0]?.groups).toEqual([]);
  });

  it('returns the original window collection for an empty query', () => {
    const result = filterActiveWindows(snapshot, '   ');
    expect(result.windows).toBe(snapshot.windows);
    expect(result.matchingTabs).toBe(3);
  });
});

describe('formatTabLocation', () => {
  it.each([
    ['https://example.com/path?q=1#section', 'example.com/path'],
    ['chrome://extensions/', 'chrome://extensions'],
    ['chrome-extension://abc/app.html#/windows', 'Browser extension'],
    ['', 'Address unavailable'],
  ])('formats %s as %s', (url, expected) => {
    expect(formatTabLocation(url)).toBe(expected);
  });

  it('labels only this extension as Weaver', () => {
    expect(
      formatTabLocation(
        'chrome-extension://weaver/app.html#/windows',
        'chrome-extension://weaver/',
      ),
    ).toBe('Weaver');
    expect(
      formatTabLocation('chrome-extension://other/options.html', 'chrome-extension://weaver/'),
    ).toBe('Browser extension');
  });
});
