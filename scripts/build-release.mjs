import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';

import AdmZip from 'adm-zip';

// ZIP headers store wall-clock fields without a timezone, so package in UTC for stable bytes.
process.env.TZ = 'UTC';

const ROOT = resolve(import.meta.dirname, '..');
const ARCHIVE_TIMESTAMP = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));
const execFileAsync = promisify(execFile);

const RELEASE_TARGETS = {
  chrome: {
    archivePrefix: 'weaver-chrome-web-store',
    metadataPrefix: 'weaver-chrome-release',
  },
  edge: { archivePrefix: 'weaver-edge-addons', metadataPrefix: 'weaver-edge-release' },
};

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

const APPROVED_RELEASE_ICON_SHA256 = new Map([
  ['icons/default-16.png', 'f1c0661a1a7df45107544587b3a2828e4d5e3383ee73f727dd7334a5a3f3dea3'],
  ['icons/default-48.png', '9b3d374eacee41faeb330bf39fc37a520cc96ee967f8d0aa2781faef7be37c3f'],
  ['icons/default-128.png', 'b3b6c0e663843196e90f2e38e240cda27209b6e18b5f8b13161d0f5042a5d0eb'],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readFileIfPresent(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function run(command, arguments_, cwd) {
  const { stdout } = await execFileAsync(command, arguments_, {
    cwd,
    encoding: 'utf8',
  });
  return stdout.trim();
}

async function resolveVersionTagCommit(root, versionTag) {
  try {
    return await run('git', ['rev-parse', '--verify', '--quiet', `${versionTag}^{commit}`], root);
  } catch (error) {
    if (error?.code === 1) {
      return null;
    }
    throw error;
  }
}

export async function collectReleaseProvenance(version, root = ROOT) {
  const versionTag = `v${version}`;
  const lockfilePath = join(root, 'pnpm-lock.yaml');
  const [commitSha, workingTreeStatus, versionTagCommitSha, lockfileBytes] = await Promise.all([
    run('git', ['rev-parse', 'HEAD'], root),
    run('git', ['status', '--porcelain=v1', '--untracked-files=normal'], root),
    resolveVersionTagCommit(root, versionTag),
    readFile(lockfilePath),
  ]);

  return {
    commitSha,
    clean: workingTreeStatus.length === 0,
    versionTag,
    versionTagCommitSha,
    pnpmLockSha256: sha256(lockfileBytes),
    nodeVersion: process.version,
    pnpmVersion: resolveRunningPnpmVersion(),
  };
}

export function resolveRunningPnpmVersion(userAgent = process.env.npm_config_user_agent) {
  const match = /^pnpm\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/u.exec(userAgent ?? '');
  if (!match) {
    throw new Error(
      'Release packaging must run through a pnpm script so the active pnpm version can be verified',
    );
  }
  return match[1];
}

async function readRequiredReleaseToolchain(root, packageMetadata) {
  const nodeVersion = (await readFile(join(root, '.node-version'), 'utf8')).trim();
  if (!/^\d+\.\d+\.\d+$/u.test(nodeVersion)) {
    throw new Error('The release Node.js version in .node-version must be an exact semver');
  }
  const pnpmMatch = /^pnpm@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u.exec(
    packageMetadata.packageManager ?? '',
  );
  if (!pnpmMatch) {
    throw new Error('package.json packageManager must pin an exact pnpm version');
  }
  return { nodeVersion: `v${nodeVersion}`, pnpmVersion: pnpmMatch[1] };
}

function validateProvenanceShape(provenance, version) {
  if (!/^[0-9a-f]{40,64}$/u.test(provenance.commitSha ?? '')) {
    throw new Error('Release provenance must contain a full Git commit SHA');
  }
  if (typeof provenance.clean !== 'boolean') {
    throw new Error('Release provenance must record whether the Git working tree is clean');
  }
  if (provenance.versionTag !== `v${version}`) {
    throw new Error(`Release provenance must check the version tag v${version}`);
  }
  if (
    provenance.versionTagCommitSha !== null &&
    !/^[0-9a-f]{40,64}$/u.test(provenance.versionTagCommitSha ?? '')
  ) {
    throw new Error('Release provenance contains an invalid version-tag commit SHA');
  }
  if (!/^[0-9a-f]{64}$/u.test(provenance.pnpmLockSha256 ?? '')) {
    throw new Error('Release provenance must contain the pnpm lockfile SHA-256');
  }
  if (!provenance.nodeVersion || !provenance.pnpmVersion) {
    throw new Error('Release provenance must contain the Node.js and pnpm versions');
  }
}

export function validateStrictReleaseProvenance(provenance, version, requiredToolchain) {
  validateProvenanceShape(provenance, version);
  if (!provenance.clean) {
    throw new Error(
      'Store release packaging requires a clean Git working tree. Commit the intended release source or use --preview for a clearly labeled non-release package.',
    );
  }
  if (provenance.versionTagCommitSha && provenance.versionTagCommitSha !== provenance.commitSha) {
    throw new Error(
      `Version tag ${provenance.versionTag} already points to ${provenance.versionTagCommitSha}, not release commit ${provenance.commitSha}`,
    );
  }
  if (provenance.nodeVersion !== requiredToolchain.nodeVersion) {
    throw new Error(
      `Store release packaging requires Node.js ${requiredToolchain.nodeVersion}, found ${provenance.nodeVersion}`,
    );
  }
  if (provenance.pnpmVersion !== requiredToolchain.pnpmVersion) {
    throw new Error(
      `Store release packaging requires pnpm ${requiredToolchain.pnpmVersion}, found ${provenance.pnpmVersion}`,
    );
  }
}

export function compareReleaseEntryNames(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function classifyReleaseDirectoryEntry(entry, entryName) {
  if (entry.isDirectory()) {
    return 'directory';
  }
  if (entry.isFile()) {
    return 'file';
  }
  if (entry.isSymbolicLink()) {
    throw new Error(`Release directory must not contain symbolic links: ${entryName}`);
  }
  throw new Error(`Release directory contains a non-regular entry: ${entryName}`);
}

async function walk(directory, rootDirectory = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => compareReleaseEntryNames(a.name, b.name))) {
    const absolutePath = join(directory, entry.name);
    const entryName = normalizeEntryName(absolutePath, rootDirectory);
    const entryType = classifyReleaseDirectoryEntry(entry, entryName);
    if (entryType === 'directory') {
      files.push(...(await walk(absolutePath, rootDirectory)));
    } else {
      files.push(absolutePath);
    }
  }

  return files;
}

function normalizeEntryName(absolutePath, distDirectory) {
  return relative(distDirectory, absolutePath).split(sep).join('/');
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
    version: expectedVersion,
  };
  if (!isDeepStrictEqual(manifest, expectedManifest)) {
    throw new Error(
      'Store release manifest does not match the approved permission and entrypoint contract',
    );
  }
}

export function validateReleaseContents(entryContents, target = 'chrome') {
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
    if (target === 'edge' && /(?:chromewebstore\.google\.com|Chrome Web Store)/u.test(contents)) {
      throw new Error(`Edge release references the Chrome Web Store: ${entryName}`);
    }
    if (
      target === 'chrome' &&
      /(?:microsoftedge\.microsoft\.com\/addons|Microsoft Edge Add-ons)/u.test(contents)
    ) {
      throw new Error(`Chrome release references Microsoft Edge Add-ons: ${entryName}`);
    }
  }
}

export function validateReleaseIconBytes(entryContents) {
  for (const [entryName, expectedHash] of APPROVED_RELEASE_ICON_SHA256) {
    const bytes = entryContents.get(entryName);
    if (!bytes) {
      throw new Error(`Release package is missing approved production icon: ${entryName}`);
    }
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== expectedHash) {
      throw new Error(`Release icon does not match approved production artwork: ${entryName}`);
    }
  }
}

function validatePackagedReleaseContents(entryContents, target) {
  validateReleaseContents(entryContents, target);
  validateReleaseIconBytes(entryContents);
}

export function parseReleaseTarget(arguments_) {
  const targetArgument = arguments_.find((argument) => argument.startsWith('--target='));
  const target = targetArgument?.slice('--target='.length) || 'chrome';
  if (!Object.prototype.hasOwnProperty.call(RELEASE_TARGETS, target)) {
    throw new Error(`Unknown release target: ${target}`);
  }
  return target;
}

export function parseReleaseOptions(arguments_) {
  for (const argument of arguments_) {
    if (argument !== '--preview' && !argument.startsWith('--target=')) {
      throw new Error(`Unknown release option: ${argument}`);
    }
  }
  return {
    target: parseReleaseTarget(arguments_),
    preview: arguments_.includes('--preview'),
  };
}

function createReleaseArchive(entryContents) {
  const archive = new AdmZip({ noSort: true });
  for (const [entryName, bytes] of [...entryContents].sort(([left], [right]) =>
    compareReleaseEntryNames(left, right),
  )) {
    const entry = archive.addFile(entryName, bytes);
    entry.header.time = ARCHIVE_TIMESTAMP;
  }
  return archive.toBuffer();
}

function verifyReleaseArchive(archiveBytes, target) {
  const archiveEntries = new AdmZip({ input: archiveBytes, noSort: true })
    .getEntries()
    .filter((entry) => !entry.isDirectory);
  const entries = archiveEntries.map((entry) => entry.entryName).sort(compareReleaseEntryNames);
  validateEntryNames(entries);
  validatePackagedReleaseContents(
    new Map(archiveEntries.map((entry) => [entry.entryName, entry.getData()])),
    target,
  );
  return entries;
}

function releaseMetadataIsEquivalent(existingBytes, expectedMetadata) {
  try {
    const existingMetadata = JSON.parse(existingBytes.toString('utf8'));
    if (
      typeof existingMetadata.createdAt !== 'string' ||
      Number.isNaN(Date.parse(existingMetadata.createdAt))
    ) {
      return false;
    }
    const existingStableMetadata = { ...existingMetadata };
    const expectedStableMetadata = { ...expectedMetadata };
    delete existingStableMetadata.createdAt;
    delete expectedStableMetadata.createdAt;
    return isDeepStrictEqual(existingStableMetadata, expectedStableMetadata);
  } catch {
    return false;
  }
}

async function assertCompatibleExistingArtifact(path, desiredBytes, isEquivalent, label) {
  const existingBytes = await readFileIfPresent(path);
  if (existingBytes && !isEquivalent(existingBytes, desiredBytes)) {
    throw new Error(
      `Refusing to overwrite existing ${label} with different contents: ${path}. Bump the package version or move the existing artifact after review.`,
    );
  }
  return existingBytes;
}

async function stageArtifact(finalPath, bytes) {
  const stagingPath = `${finalPath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(stagingPath, bytes, { flag: 'wx' });
  return stagingPath;
}

async function removeStagedArtifact(path) {
  if (!path) {
    return;
  }
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function finalizeStagedArtifact(stagingPath, finalPath, desiredBytes, isEquivalent, label) {
  try {
    await link(stagingPath, finalPath);
    return 'created';
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error;
    }
    const existingBytes = await readFile(finalPath);
    if (!isEquivalent(existingBytes, desiredBytes)) {
      throw new Error(
        `Refusing to overwrite existing ${label} with different contents: ${finalPath}. Bump the package version or move the existing artifact after review.`,
      );
    }
    return 'existing';
  } finally {
    await removeStagedArtifact(stagingPath);
  }
}

function buffersAreEqual(left, right) {
  return left.equals(right);
}

export async function buildRelease(target = 'chrome', options = {}) {
  if (!Object.prototype.hasOwnProperty.call(RELEASE_TARGETS, target)) {
    throw new Error(`Unknown release target: ${target}`);
  }
  const root = options.root ?? ROOT;
  const distDirectory = options.dist ?? join(root, 'dist');
  const artifactsDirectory = options.artifacts ?? join(root, 'artifacts');
  const preview = options.preview ?? false;
  const distInfo = await stat(distDirectory).catch(() => undefined);
  if (!distInfo?.isDirectory()) {
    throw new Error('dist/ does not exist. Run the production build first.');
  }

  const manifest = JSON.parse(await readFile(join(distDirectory, 'manifest.json'), 'utf8'));
  const packageMetadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  validateReleaseManifest(manifest, packageMetadata.version);
  const provenance =
    options.provenance ?? (await collectReleaseProvenance(packageMetadata.version, root));
  if (preview) {
    validateProvenanceShape(provenance, packageMetadata.version);
  } else {
    validateStrictReleaseProvenance(
      provenance,
      packageMetadata.version,
      await readRequiredReleaseToolchain(root, packageMetadata),
    );
  }

  const files = await walk(distDirectory);
  const entryNames = files.map((file) => normalizeEntryName(file, distDirectory));
  validateEntryNames(entryNames);
  const entryContents = new Map();
  for (const file of files) {
    entryContents.set(normalizeEntryName(file, distDirectory), await readFile(file));
  }
  validatePackagedReleaseContents(entryContents, target);

  const archiveBytes = createReleaseArchive(entryContents);
  const verifiedEntries = verifyReleaseArchive(archiveBytes, target);
  const archiveSha256 = sha256(archiveBytes);
  const previewQualifier = preview
    ? `-preview-${provenance.commitSha.slice(0, 8)}-${archiveSha256.slice(0, 12)}`
    : '';

  await mkdir(artifactsDirectory, { recursive: true });
  const { archivePrefix, metadataPrefix } = RELEASE_TARGETS[target];
  const archivePath = join(
    artifactsDirectory,
    `${archivePrefix}-${manifest.version}${previewQualifier}.zip`,
  );
  const metadataPath = join(
    artifactsDirectory,
    `${metadataPrefix}-${manifest.version}${previewQualifier}.json`,
  );
  const createdAt = options.createdAt === undefined ? new Date() : new Date(options.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error(`Invalid release creation time: ${String(options.createdAt)}`);
  }
  const metadata = {
    schemaVersion: 2,
    mode: preview ? 'preview' : 'release',
    target,
    name: basename(archivePath),
    version: manifest.version,
    sha256: archiveSha256,
    bytes: archiveBytes.byteLength,
    entries: verifiedEntries,
    createdAt: createdAt.toISOString(),
    archiveTimestamp: ARCHIVE_TIMESTAMP.toISOString(),
    source: {
      commitSha: provenance.commitSha,
      clean: provenance.clean,
      versionTag: provenance.versionTag,
      versionTagCommitSha: provenance.versionTagCommitSha,
      pnpmLockSha256: provenance.pnpmLockSha256,
    },
    toolchain: {
      node: provenance.nodeVersion,
      pnpm: provenance.pnpmVersion,
    },
  };
  const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);

  const [existingArchive, existingMetadata] = await Promise.all([
    assertCompatibleExistingArtifact(archivePath, archiveBytes, buffersAreEqual, 'release archive'),
    assertCompatibleExistingArtifact(
      metadataPath,
      metadataBytes,
      (existingBytes) => releaseMetadataIsEquivalent(existingBytes, metadata),
      'release metadata',
    ),
  ]);

  let stagedArchive;
  let stagedMetadata;
  let archiveStatus = existingArchive ? 'existing' : 'created';
  let metadataStatus = existingMetadata ? 'existing' : 'created';
  try {
    if (!existingArchive) {
      stagedArchive = await stageArtifact(archivePath, archiveBytes);
    }
    if (!existingMetadata) {
      stagedMetadata = await stageArtifact(metadataPath, metadataBytes);
    }
    if (stagedArchive) {
      const stagedArchiveBytes = await readFile(stagedArchive);
      if (!buffersAreEqual(stagedArchiveBytes, archiveBytes)) {
        throw new Error('Staged release archive does not match the validated package bytes');
      }
      verifyReleaseArchive(stagedArchiveBytes, target);
    }
    if (stagedMetadata) {
      const stagedMetadataBytes = await readFile(stagedMetadata);
      if (!buffersAreEqual(stagedMetadataBytes, metadataBytes)) {
        throw new Error('Staged release metadata does not match the validated metadata bytes');
      }
      JSON.parse(stagedMetadataBytes.toString('utf8'));
    }
    if (stagedArchive) {
      archiveStatus = await finalizeStagedArtifact(
        stagedArchive,
        archivePath,
        archiveBytes,
        buffersAreEqual,
        'release archive',
      );
      stagedArchive = undefined;
    }
    if (stagedMetadata) {
      metadataStatus = await finalizeStagedArtifact(
        stagedMetadata,
        metadataPath,
        metadataBytes,
        (existingBytes) => releaseMetadataIsEquivalent(existingBytes, metadata),
        'release metadata',
      );
      stagedMetadata = undefined;
    }
  } finally {
    await Promise.all([removeStagedArtifact(stagedArchive), removeStagedArtifact(stagedMetadata)]);
  }

  const result = {
    archivePath,
    metadataPath,
    sha256: archiveSha256,
    entries: verifiedEntries.length,
    mode: metadata.mode,
    archiveStatus,
    metadataStatus,
  };
  if (options.writeOutput !== false) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  const options = parseReleaseOptions(process.argv.slice(2));
  await buildRelease(options.target, { preview: options.preview });
}
