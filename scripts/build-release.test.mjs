import { describe, expect, it } from 'vitest';

import {
  validateEntryNames,
  validateReleaseContents,
  validateReleaseManifest,
} from './build-release.mjs';

const VALID_ENTRIES = [
  'THIRD_PARTY_NOTICES.txt',
  'app.html',
  'assets/app-abc123.js',
  'assets/app-abc123.css',
  'icons/default-128.png',
  'icons/default-16.png',
  'icons/default-48.png',
  'manifest.json',
  'service-worker-loader.js',
  'src/popup/popup.html',
];

function createManifest(overrides = {}) {
  return {
    action: {
      default_icon: {
        16: 'icons/default-16.png',
        48: 'icons/default-48.png',
        128: 'icons/default-128.png',
      },
      default_popup: 'src/popup/popup.html',
      default_title: 'Open Weaver',
    },
    background: {
      service_worker: 'service-worker-loader.js',
      type: 'module',
    },
    commands: {
      'open-manager': {
        description: 'Open Weaver',
        suggested_key: {
          default: 'Ctrl+Shift+O',
          mac: 'Command+Shift+O',
        },
      },
    },
    description: 'Organize, search, sort, save, restore, and deduplicate browser tabs and windows.',
    icons: {
      16: 'icons/default-16.png',
      48: 'icons/default-48.png',
      128: 'icons/default-128.png',
    },
    incognito: 'not_allowed',
    manifest_version: 3,
    minimum_chrome_version: '120',
    name: 'Weaver - Window & Tab Manager',
    permissions: ['tabs', 'storage', 'tabGroups'],
    short_name: 'Weaver',
    version: '0.6.36',
    ...overrides,
  };
}

describe('release package contract', () => {
  it('accepts only the expected Store package structure', () => {
    expect(() => validateEntryNames(VALID_ENTRIES)).not.toThrow();
  });

  it('requires every static entrypoint and notice file', () => {
    expect(() =>
      validateEntryNames(VALID_ENTRIES.filter((entry) => entry !== 'manifest.json')),
    ).toThrow('Release archive is missing required entry: manifest.json');
  });

  it.each([
    '/manifest.json',
    '../manifest.json',
    'assets/../../secret.txt',
    '.DS_Store',
    '.vite/manifest.json',
    'assets/vite.svg',
    'assets/app.js.map',
    'weaver.pem',
    'private.key',
    'weaver.crx',
    'icons/chrome.svg',
    'README.md',
  ])('rejects unsafe, forbidden, or unexpected entry %s', (entryName) => {
    expect(() => validateEntryNames([...VALID_ENTRIES, entryName])).toThrow();
  });

  it('accepts the exact keyless Store manifest', () => {
    expect(() => validateReleaseManifest(createManifest(), '0.6.36')).not.toThrow();
  });

  it.each([
    [{ key: 'public-key' }, 'key'],
    [{ update_url: 'https://example.test/update.xml' }, 'update_url'],
    [{ host_permissions: ['https://example.test/*'] }, 'host_permissions'],
    [{ content_scripts: [] }, 'content_scripts'],
    [{ version: '0.6.37' }, 'does not match package version'],
    [{ permissions: ['tabs', 'storage'] }, 'approved permission and entrypoint contract'],
    [
      { action: { ...createManifest().action, default_popup: 'other.html' } },
      'approved permission and entrypoint contract',
    ],
  ])('rejects a non-Store manifest %#', (overrides, expectedMessage) => {
    expect(() => validateReleaseManifest(createManifest(overrides), '0.6.36')).toThrow(
      expectedMessage,
    );
  });

  it('rejects source maps and executable remote references', () => {
    expect(() =>
      validateReleaseContents(new Map([['assets/app.js', '//# sourceMappingURL=app.js.map']])),
    ).toThrow('source-map reference');
    expect(() =>
      validateReleaseContents(
        new Map([['app.html', '<script src="https://cdn.example.test/app.js"></script>']]),
      ),
    ).toThrow('remote asset');
    expect(() =>
      validateReleaseContents(
        new Map([['assets/app.js', 'import("https://cdn.example.test/app.js")']]),
      ),
    ).toThrow('remote or dynamic code');
    expect(() =>
      validateReleaseContents(
        new Map([['assets/app.css', '@import url("https://cdn.example.test/app.css");']]),
      ),
    ).toThrow('remote asset');
  });
});
