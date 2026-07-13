import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import AdmZip from 'adm-zip';

// ZIP headers store wall-clock fields without a timezone, so package in UTC for stable bytes.
process.env.TZ = 'UTC';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const ARTIFACTS = join(ROOT, 'artifacts');
const ARCHIVE_TIMESTAMP = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));

const REQUIRED_RELEASE_ENTRIES = [
  'THIRD_PARTY_NOTICES.txt',
  'app.html',
  'icons/default-128.png',
  'icons/default-16.png',
  'icons/default-48.png',
  'manifest.json',
  'service-worker-loader.js',
  'src/popup/popup.html',
];

const ALLOWED_ENTRY_PATTERNS = [
  /^THIRD_PARTY_NOTICES\.txt$/u,
  /^app\.html$/u,
  /^assets\/[A-Za-z0-9_.-]+\.(?:css|js)$/u,
  /^icons\/default-(?:16|48|128)\.png$/u,
  /^manifest\.json$/u,
  /^service-worker-loader\.js$/u,
  /^src\/popup\/popup\.html$/u,
];

const FORBIDDEN_ENTRY_PATTERNS = [
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.vite(\/|$)/,
  /(^|\/)vite\.svg$/,
  /\.pem$/i,
  /\.key$/i,
  /\.crx$/i,
  /\.map$/i,
];

const FORBIDDEN_MANIFEST_FIELDS = [
  'content_scripts',
  'content_security_policy',
  'externally_connectable',
  'host_permissions',
  'key',
  'optional_host_permissions',
  'optional_permissions',
  'update_url',
  'version_name',
  'web_accessible_resources',
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function normalizeEntryName(absolutePath) {
  return relative(DIST, absolutePath).split(sep).join('/');
}

export function validateEntryNames(entryNames) {
  if (new Set(entryNames).size !== entryNames.length) {
    throw new Error('Release archive must not contain duplicate entries');
  }

  for (const entryName of entryNames) {
    if (entryName.startsWith('/') || entryName.includes('../')) {
      throw new Error(`Unsafe release archive entry: ${entryName}`);
    }
    const forbidden = FORBIDDEN_ENTRY_PATTERNS.find((pattern) => pattern.test(entryName));
    if (forbidden) {
      throw new Error(`Forbidden release archive entry: ${entryName}`);
    }
    if (!ALLOWED_ENTRY_PATTERNS.some((pattern) => pattern.test(entryName))) {
      throw new Error(`Unexpected release archive entry: ${entryName}`);
    }
  }

  for (const requiredEntry of REQUIRED_RELEASE_ENTRIES) {
    if (!entryNames.includes(requiredEntry)) {
      throw new Error(`Release archive is missing required entry: ${requiredEntry}`);
    }
  }
  if (!entryNames.some((entryName) => /^assets\/.+\.js$/u.test(entryName))) {
    throw new Error('Release archive must contain a compiled JavaScript asset');
  }
  if (!entryNames.some((entryName) => /^assets\/.+\.css$/u.test(entryName))) {
    throw new Error('Release archive must contain a compiled stylesheet');
  }
}

export function validateReleaseManifest(manifest, expectedVersion) {
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `Built manifest version ${String(manifest.version)} does not match package version ${expectedVersion}`,
    );
  }
  for (const field of FORBIDDEN_MANIFEST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(manifest, field)) {
      throw new Error(`Store release manifest must not contain ${field}`);
    }
  }

  const expectedManifest = {
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
    version: expectedVersion,
  };
  if (!isDeepStrictEqual(manifest, expectedManifest)) {
    throw new Error(
      'Store release manifest does not match the approved permission and entrypoint contract',
    );
  }
}

export function validateReleaseContents(entryContents) {
  for (const [entryName, bytes] of entryContents) {
    if (!/\.(?:css|html|js)$/u.test(entryName)) {
      continue;
    }
    const contents = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
    if (/sourceMappingURL\s*=/u.test(contents)) {
      throw new Error(`Release entry contains a source-map reference: ${entryName}`);
    }
    if (
      entryName.endsWith('.html') &&
      /\b(?:href|src)\s*=\s*["']\s*(?:https?:)?\/\//iu.test(contents)
    ) {
      throw new Error(`Release HTML references a remote asset: ${entryName}`);
    }
    if (
      entryName.endsWith('.css') &&
      /(?:@import\s+(?:url\()?|url\()\s*["']?\s*(?:https?:)?\/\//iu.test(contents)
    ) {
      throw new Error(`Release stylesheet references a remote asset: ${entryName}`);
    }
    if (
      entryName.endsWith('.js') &&
      (/\b(?:eval|Function)\s*\(/u.test(contents) ||
        /\b(?:importScripts\s*\(|import\s*\(|from\s*)["']\s*(?:https?:)?\/\//iu.test(contents))
    ) {
      throw new Error(`Release JavaScript contains remote or dynamic code: ${entryName}`);
    }
  }
}

export async function buildRelease() {
  const distInfo = await stat(DIST).catch(() => undefined);
  if (!distInfo?.isDirectory()) {
    throw new Error('dist/ does not exist. Run the production build first.');
  }

  const manifest = JSON.parse(await readFile(join(DIST, 'manifest.json'), 'utf8'));
  const packageMetadata = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  validateReleaseManifest(manifest, packageMetadata.version);

  const files = await walk(DIST);
  const entryNames = files.map(normalizeEntryName);
  validateEntryNames(entryNames);
  const entryContents = new Map();
  for (const file of files) {
    entryContents.set(normalizeEntryName(file), await readFile(file));
  }
  validateReleaseContents(entryContents);

  await mkdir(ARTIFACTS, { recursive: true });
  const archivePath = join(ARTIFACTS, `weaver-webstore-${manifest.version}.zip`);
  const metadataPath = join(ARTIFACTS, `weaver-release-${manifest.version}.json`);

  const archive = new AdmZip();
  for (const file of files) {
    const entryName = normalizeEntryName(file);
    if (FORBIDDEN_ENTRY_PATTERNS.some((pattern) => pattern.test(entryName))) {
      continue;
    }
    const entry = archive.addFile(entryName, entryContents.get(entryName));
    entry.header.time = ARCHIVE_TIMESTAMP;
  }
  archive.writeZip(archivePath);

  const verifiedArchiveEntries = new AdmZip(archivePath)
    .getEntries()
    .filter((entry) => !entry.isDirectory);
  const verifiedEntries = verifiedArchiveEntries.map((entry) => entry.entryName).sort();
  validateEntryNames(verifiedEntries);
  validateReleaseContents(
    new Map(verifiedArchiveEntries.map((entry) => [entry.entryName, entry.getData()])),
  );

  const archiveBytes = await readFile(archivePath);
  const sha256 = createHash('sha256').update(archiveBytes).digest('hex');
  const metadata = {
    schemaVersion: 1,
    name: basename(archivePath),
    version: manifest.version,
    sha256,
    bytes: archiveBytes.byteLength,
    entries: verifiedEntries,
    timestamp: ARCHIVE_TIMESTAMP.toISOString(),
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  process.stdout.write(
    `${JSON.stringify({ archivePath, metadataPath, sha256, entries: verifiedEntries.length }, null, 2)}\n`,
  );
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  await buildRelease();
}
