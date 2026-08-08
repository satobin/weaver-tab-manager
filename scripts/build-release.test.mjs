// @vitest-environment node

import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';

import {
  buildRelease,
  classifyReleaseDirectoryEntry,
  compareReleaseEntryNames,
  parseReleaseTarget,
  parseReleaseOptions,
  resolveRunningPnpmVersion,
  validateEntryNames,
  validateReleaseContents,
  validateReleaseIconBytes,
  validateReleaseManifest,
  validateStrictReleaseProvenance,
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

const TEST_COMMIT_SHA = 'a'.repeat(40);
const TEST_LOCK_SHA = 'b'.repeat(64);
const REQUIRED_TOOLCHAIN = { nodeVersion: 'v24.18.1', pnpmVersion: '11.7.0' };

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
        description: 'Open Window Manager',
        suggested_key: {
          default: 'Ctrl+Shift+1',
          mac: 'Command+Shift+1',
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

async function readApprovedIconContents() {
  return new Map(
    await Promise.all(
      ['icons/default-16.png', 'icons/default-48.png', 'icons/default-128.png'].map(
        async (entryName) => [
          entryName,
          await readFile(join(import.meta.dirname, '..', 'public', entryName)),
        ],
      ),
    ),
  );
}

function createProvenance(overrides = {}) {
  return {
    commitSha: TEST_COMMIT_SHA,
    clean: true,
    versionTag: 'v1.2.3',
    versionTagCommitSha: null,
    pnpmLockSha256: TEST_LOCK_SHA,
    nodeVersion: 'v24.18.1',
    pnpmVersion: '11.7.0',
    ...overrides,
  };
}

function createDirectoryEntry({ directory = false, file = false, symbolicLink = false } = {}) {
  return {
    isDirectory: () => directory,
    isFile: () => file,
    isSymbolicLink: () => symbolicLink,
  };
}

async function createReleaseFixture() {
  const root = await mkdtemp(join(tmpdir(), 'weaver-release-test-'));
  const dist = join(root, 'dist');
  const icons = await readApprovedIconContents();
  await Promise.all([
    mkdir(join(dist, 'assets'), { recursive: true }),
    mkdir(join(dist, 'icons'), { recursive: true }),
    mkdir(join(dist, 'src', 'popup'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(root, 'package.json'),
      `${JSON.stringify({ packageManager: 'pnpm@11.7.0', version: '1.2.3' })}\n`,
    ),
    writeFile(join(root, '.node-version'), '24.18.1\n'),
    writeFile(
      join(dist, 'manifest.json'),
      `${JSON.stringify(createManifest({ version: '1.2.3' }))}\n`,
    ),
    writeFile(join(dist, 'THIRD_PARTY_NOTICES.txt'), 'Third-party notices\n'),
    writeFile(join(dist, 'app.html'), '<main>Weaver</main>\n'),
    writeFile(join(dist, 'assets', 'app.js'), 'console.log("weaver");\n'),
    writeFile(join(dist, 'assets', 'app.css'), 'main { display: block; }\n'),
    writeFile(join(dist, 'service-worker-loader.js'), 'import "./assets/app.js";\n'),
    writeFile(join(dist, 'src', 'popup', 'popup.html'), '<main>Popup</main>\n'),
    ...[...icons].map(([entryName, bytes]) => writeFile(join(dist, entryName), bytes)),
  ]);
  return root;
}

describe('release package contract', () => {
  it('reads the active pnpm version from the cross-platform script environment', () => {
    expect(resolveRunningPnpmVersion('pnpm/11.7.0 npm/? node/v24.18.1 win32 x64')).toBe('11.7.0');
    expect(resolveRunningPnpmVersion('pnpm/12.0.0-beta.2 npm/? node/v24.18.1 darwin arm64')).toBe(
      '12.0.0-beta.2',
    );
    expect(() => resolveRunningPnpmVersion('npm/11.7.0 node/v24.18.1 win32 x64')).toThrow(
      'must run through a pnpm script',
    );
    expect(() => resolveRunningPnpmVersion('')).toThrow('must run through a pnpm script');
  });

  it('uses locale-independent code-unit ordering for release entries', () => {
    const entryNames = ['assets/z.js', 'assets/a.js', 'assets/_helper.js', 'assets/A.js'];
    expect(entryNames.sort(compareReleaseEntryNames)).toEqual([
      'assets/A.js',
      'assets/_helper.js',
      'assets/a.js',
      'assets/z.js',
    ]);
  });

  it('classifies only directories and regular files as packageable entries', () => {
    expect(classifyReleaseDirectoryEntry(createDirectoryEntry({ directory: true }), 'assets')).toBe(
      'directory',
    );
    expect(
      classifyReleaseDirectoryEntry(createDirectoryEntry({ file: true }), 'assets/app.js'),
    ).toBe('file');
    expect(() =>
      classifyReleaseDirectoryEntry(createDirectoryEntry({ symbolicLink: true }), 'assets/link.js'),
    ).toThrow('must not contain symbolic links: assets/link.js');
    expect(() =>
      classifyReleaseDirectoryEntry(createDirectoryEntry(), 'assets/app.socket'),
    ).toThrow('contains a non-regular entry: assets/app.socket');
  });

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
    'assets/extension-icons/test/test-16.png',
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
    [{ name: 'Weaver Test - Window & Tab Manager' }, 'approved permission and entrypoint contract'],
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

  it('rejects another browser store reference in an Edge package', () => {
    const reference = 'const store = "Chrome Web Store at chromewebstore.google.com";';

    expect(() => validateReleaseContents(new Map([['assets/app.js', reference]]), 'edge')).toThrow(
      'Edge release references the Chrome Web Store',
    );
    expect(() => validateReleaseContents(new Map([['assets/app.js', reference]]))).not.toThrow();
  });

  it('rejects another browser store reference in a Chrome package', () => {
    const reference =
      'const store = "Microsoft Edge Add-ons at microsoftedge.microsoft.com/addons";';

    expect(() => validateReleaseContents(new Map([['assets/app.js', reference]]))).toThrow(
      'Chrome release references Microsoft Edge Add-ons',
    );
    expect(() =>
      validateReleaseContents(new Map([['assets/app.js', reference]]), 'edge'),
    ).not.toThrow();
  });

  it('accepts only the approved production icon bytes', async () => {
    const iconContents = await readApprovedIconContents();
    expect(() => validateReleaseIconBytes(iconContents)).not.toThrow();

    const alteredIconContents = new Map(iconContents);
    alteredIconContents.set('icons/default-16.png', Buffer.from('test icon'));
    expect(() => validateReleaseIconBytes(alteredIconContents)).toThrow(
      'Release icon does not match approved production artwork: icons/default-16.png',
    );

    const missingIconContents = new Map(iconContents);
    missingIconContents.delete('icons/default-48.png');
    expect(() => validateReleaseIconBytes(missingIconContents)).toThrow(
      'Release package is missing approved production icon: icons/default-48.png',
    );
  });

  it('accepts only known release targets', () => {
    expect(parseReleaseTarget([])).toBe('chrome');
    expect(parseReleaseTarget(['--target=chrome'])).toBe('chrome');
    expect(parseReleaseTarget(['--target=edge'])).toBe('edge');
    expect(() => parseReleaseTarget(['--target=other'])).toThrow('Unknown release target');
  });

  it('keeps preview packaging explicit and rejects unknown CLI options', () => {
    expect(parseReleaseOptions(['--target=edge', '--preview'])).toEqual({
      target: 'edge',
      preview: true,
    });
    expect(parseReleaseOptions([])).toEqual({ target: 'chrome', preview: false });
    expect(() => parseReleaseOptions(['--allow-dirty'])).toThrow('Unknown release option');
  });

  it('requires clean, unconflicted release provenance', () => {
    expect(() =>
      validateStrictReleaseProvenance(createProvenance(), '1.2.3', REQUIRED_TOOLCHAIN),
    ).not.toThrow();
    expect(() =>
      validateStrictReleaseProvenance(
        createProvenance({ clean: false }),
        '1.2.3',
        REQUIRED_TOOLCHAIN,
      ),
    ).toThrow('requires a clean Git working tree');
    expect(() =>
      validateStrictReleaseProvenance(
        createProvenance({ versionTagCommitSha: 'c'.repeat(40) }),
        '1.2.3',
        REQUIRED_TOOLCHAIN,
      ),
    ).toThrow('Version tag v1.2.3 already points to');
    expect(() =>
      validateStrictReleaseProvenance(
        createProvenance({ versionTagCommitSha: TEST_COMMIT_SHA }),
        '1.2.3',
        REQUIRED_TOOLCHAIN,
      ),
    ).not.toThrow();
    expect(() =>
      validateStrictReleaseProvenance(
        createProvenance({ nodeVersion: 'v26.6.0' }),
        '1.2.3',
        REQUIRED_TOOLCHAIN,
      ),
    ).toThrow('requires Node.js v24.18.1');
    expect(() =>
      validateStrictReleaseProvenance(
        createProvenance({ pnpmVersion: '12.0.0' }),
        '1.2.3',
        REQUIRED_TOOLCHAIN,
      ),
    ).toThrow('requires pnpm 11.7.0');
  });

  it('atomically creates reproducible release artifacts with provenance and no clobbering', async () => {
    const root = await createReleaseFixture();
    const provenance = createProvenance();
    const createdAt = '2026-08-08T12:34:56.000Z';

    try {
      const first = await buildRelease('chrome', {
        root,
        provenance,
        createdAt,
        writeOutput: false,
      });
      expect(first).toMatchObject({
        mode: 'release',
        archiveStatus: 'created',
        metadataStatus: 'created',
      });
      const firstArchiveBytes = await readFile(first.archivePath);
      const firstMetadataBytes = await readFile(first.metadataPath);
      const firstMetadata = JSON.parse(firstMetadataBytes.toString('utf8'));
      expect(firstMetadata).toMatchObject({
        schemaVersion: 2,
        mode: 'release',
        target: 'chrome',
        version: '1.2.3',
        createdAt,
        archiveTimestamp: '2000-01-01T00:00:00.000Z',
        source: {
          commitSha: TEST_COMMIT_SHA,
          clean: true,
          versionTag: 'v1.2.3',
          versionTagCommitSha: null,
          pnpmLockSha256: TEST_LOCK_SHA,
        },
        toolchain: { node: 'v24.18.1', pnpm: '11.7.0' },
      });

      const repeated = await buildRelease('chrome', {
        root,
        provenance,
        createdAt: '2026-08-09T00:00:00.000Z',
        writeOutput: false,
      });
      expect(repeated).toMatchObject({
        archiveStatus: 'existing',
        metadataStatus: 'existing',
      });
      expect(await readFile(repeated.metadataPath)).toEqual(firstMetadataBytes);

      const reproducible = await buildRelease('chrome', {
        root,
        artifacts: join(root, 'second-artifacts'),
        provenance,
        createdAt,
        writeOutput: false,
      });
      expect(await readFile(reproducible.archivePath)).toEqual(firstArchiveBytes);

      await writeFile(join(root, 'dist', 'assets', 'app.js'), 'console.log("changed");\n');
      await expect(
        buildRelease('chrome', {
          root,
          provenance,
          createdAt,
          writeOutput: false,
        }),
      ).rejects.toThrow('Refusing to overwrite existing release');
      expect(await readFile(first.archivePath)).toEqual(firstArchiveBytes);
      expect((await readdir(join(root, 'artifacts'))).some((name) => name.includes('.tmp-'))).toBe(
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stores archive entries in locale-independent order', async () => {
    const root = await createReleaseFixture();

    try {
      await Promise.all([
        writeFile(join(root, 'dist', 'assets', 'A.js'), 'export const upper = true;\n'),
        writeFile(join(root, 'dist', 'assets', '_helper.js'), 'export const helper = true;\n'),
      ]);
      const result = await buildRelease('chrome', {
        root,
        provenance: createProvenance(),
        createdAt: '2026-08-08T12:34:56.000Z',
        writeOutput: false,
      });
      const archiveEntries = new AdmZip({
        input: await readFile(result.archivePath),
        noSort: true,
      })
        .getEntries()
        .filter((entry) => !entry.isDirectory)
        .map((entry) => entry.entryName);

      expect(archiveEntries).toEqual([...archiveEntries].sort(compareReleaseEntryNames));
      expect(archiveEntries.indexOf('assets/A.js')).toBeLessThan(
        archiveEntries.indexOf('assets/_helper.js'),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== 'win32')(
    'rejects symbolic links encountered by the release directory walk',
    async () => {
      const root = await createReleaseFixture();

      try {
        await symlink('app.js', join(root, 'dist', 'assets', 'linked.js'));
        await expect(
          buildRelease('chrome', {
            root,
            provenance: createProvenance(),
            createdAt: '2026-08-08T12:34:56.000Z',
            writeOutput: false,
          }),
        ).rejects.toThrow('must not contain symbolic links: assets/linked.js');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it('allows dirty preview artifacts only under visibly distinct content-addressed names', async () => {
    const root = await createReleaseFixture();

    try {
      const result = await buildRelease('chrome', {
        root,
        preview: true,
        provenance: createProvenance({ clean: false }),
        createdAt: '2026-08-08T12:34:56.000Z',
        writeOutput: false,
      });
      expect(result.mode).toBe('preview');
      expect(result.archivePath).toContain('1.2.3-preview-aaaaaaaa-');
      expect(JSON.parse(await readFile(result.metadataPath, 'utf8'))).toMatchObject({
        mode: 'preview',
        source: { clean: false },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
