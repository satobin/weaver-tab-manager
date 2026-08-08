import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import AdmZip from 'adm-zip';

const ROOT = resolve(import.meta.dirname, '..');
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/u;
const PUBLIC_STORE_EXTENSION_IDS = new Set([
  'lchcjicakojjacjpleolmjcjlppaeobn', // Chrome Web Store
  'fncihblgmobedbbbnbdhabmjnphdoddh', // Microsoft Edge Add-ons
]);
const TEST_ICON_SIZES = [16, 48, 128];
const TEST_ICON_PATHS = {
  16: 'assets/extension-icons/test/test-16.png',
  48: 'assets/extension-icons/test/test-48.png',
  128: 'assets/extension-icons/test/test-128.png',
};
const REQUIRED_TEST_ENTRIES = [
  'THIRD_PARTY_NOTICES.txt',
  'app.html',
  TEST_ICON_PATHS[128],
  TEST_ICON_PATHS[16],
  TEST_ICON_PATHS[48],
  'icons/default-128.png',
  'icons/default-16.png',
  'icons/default-48.png',
  'manifest.json',
  'service-worker-loader.js',
  'src/popup/popup.html',
];
const ALLOWED_TEST_ENTRY_PATTERNS = [
  /^THIRD_PARTY_NOTICES\.txt$/u,
  /^app\.html$/u,
  /^assets\/[A-Za-z0-9_.-]+\.(?:css|js)$/u,
  /^assets\/extension-icons\/test\/test-(?:16|48|128)\.png$/u,
  /^icons\/default-(?:16|48|128)\.png$/u,
  /^manifest\.json$/u,
  /^service-worker-loader\.js$/u,
  /^src\/popup\/popup\.html$/u,
];
const FORBIDDEN_TEST_ENTRY_PATTERNS = [
  /(^|\/)\.DS_Store$/u,
  /(^|\/)\.vite(\/|$)/u,
  /(^|\/)vite\.svg$/u,
  /\.(?:crx|key|map|p12|pem|pfx)$/iu,
];
const PRODUCTION_ICON_PATHS = {
  16: 'icons/default-16.png',
  48: 'icons/default-48.png',
  128: 'icons/default-128.png',
};
const APPROVED_TEST_ICON_SHA256 = new Map([
  [TEST_ICON_PATHS[16], 'dd210794744209713359cfa6b08a7b9ad1d0b53f952df29d88ed608031d28b26'],
  [TEST_ICON_PATHS[48], '3137d9298e75269ce1e0fc83136430e0bdff3ee301f5c1a010dcf5309db266b0'],
  [TEST_ICON_PATHS[128], '85dd3d2e458d4cce91bf54d34da3e4f04c2b8098b1cc1824a0af7f34413f5abb'],
]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function usage(message) {
  return new Error(
    [
      message,
      '',
      'Set environment variables using your shell before running a command.',
      '',
      'Environment:',
      '  WEAVER_TEST_KEY_PATH      Required for both commands; absolute path to the RSA test key',
      '  WEAVER_TEST_EXTENSION_ID  Required for package:test; 32 letters from a through p',
      '  WEAVER_TEST_VERSION       Optional; four numeric components beginning with 99',
      '  WEAVER_CHROME_PATH        Optional; absolute path to a Chrome, Chromium, or Brave executable',
      '',
      'Commands:',
      '  pnpm run test:extension-id  Print the extension ID derived from the test key',
      '  pnpm run package:test       Validate and create the signed test CRX',
    ].join('\n'),
  );
}

export function validatePngDimensions(bytes, expectedSize, label) {
  const hasPngHeader =
    bytes.length >= 24 &&
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) &&
    bytes.subarray(12, 16).toString('ascii') === 'IHDR';
  const width = hasPngHeader ? bytes.readUInt32BE(16) : undefined;
  const height = hasPngHeader ? bytes.readUInt32BE(20) : undefined;
  if (!hasPngHeader || width !== expectedSize || height !== expectedSize) {
    throw new Error(`${label} must be a ${expectedSize}x${expectedSize} PNG.`);
  }
}

export function extensionIdFromPublicKey(publicKeyDer) {
  const digest = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  return [...digest]
    .map((byte) =>
      String.fromCharCode('a'.charCodeAt(0) + (byte >> 4), 'a'.charCodeAt(0) + (byte & 15)),
    )
    .join('');
}

export function assertTestExtensionIdIsSafe(extensionId) {
  if (PUBLIC_STORE_EXTENSION_IDS.has(extensionId)) {
    throw new Error(`Refusing to create a test package with public Store identity ${extensionId}.`);
  }
}

export function createTimestampTestVersion(now = new Date()) {
  if (Number.isNaN(now.getTime()) || now.getUTCFullYear() < 2000) {
    throw new Error('Test-version time must be a valid date in 2000 or later.');
  }
  const year = now.getUTCFullYear() - 2000;
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1);
  const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayOfYear = Math.floor((startOfDay - startOfYear) / 86_400_000) + 1;
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  return `99.${year}.${dayOfYear}.${minuteOfDay}`;
}

export function resolveTestVersion(override, now = new Date()) {
  if (!override) {
    return createTimestampTestVersion(now);
  }

  const components = override.split('.');
  const valid =
    components.length === 4 &&
    components[0] === '99' &&
    components.every(
      (component) => /^(?:0|[1-9]\d*)$/u.test(component) && Number(component) <= 65_535,
    );
  if (!valid) {
    throw new Error(
      `WEAVER_TEST_VERSION must be four numeric components beginning with 99: ${override}`,
    );
  }
  return override;
}

function expectedUnsignedTestManifest(sourceVersion) {
  return {
    action: {
      default_icon: TEST_ICON_PATHS,
      default_popup: 'src/popup/popup.html',
      default_title: 'Open Weaver Test',
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
    icons: TEST_ICON_PATHS,
    incognito: 'not_allowed',
    manifest_version: 3,
    minimum_chrome_version: '120',
    name: 'Weaver Test - Window & Tab Manager',
    permissions: ['tabs', 'storage', 'tabGroups'],
    short_name: 'Weaver Test',
    version: sourceVersion,
  };
}

export function validateUnsignedTestManifest(manifest, sourceVersion) {
  if (!isDeepStrictEqual(manifest, expectedUnsignedTestManifest(sourceVersion))) {
    throw new Error('Vite did not generate the expected unsigned Weaver test manifest.');
  }
}

export function createSignedTestManifest(
  manifest,
  { sourceVersion, testVersion, publicKeyBase64 },
) {
  validateUnsignedTestManifest(manifest, sourceVersion);
  return {
    ...manifest,
    version: testVersion,
    version_name: `${sourceVersion} test build`,
    key: publicKeyBase64,
  };
}

export async function validateTestIcons({
  repoPath = ROOT,
  unpackedPath,
  expectedHashes = APPROVED_TEST_ICON_SHA256,
}) {
  const verifiedHashes = {};
  for (const size of TEST_ICON_SIZES) {
    const testPath = TEST_ICON_PATHS[size];
    const productionPath = PRODUCTION_ICON_PATHS[size];
    const [sourceBytes, builtBytes, productionBytes] = await Promise.all([
      readFile(join(repoPath, testPath)),
      readFile(join(unpackedPath, testPath)),
      readFile(join(repoPath, 'public', productionPath)),
    ]);

    validatePngDimensions(sourceBytes, size, `Tracked test icon ${testPath}`);
    validatePngDimensions(builtBytes, size, `Built test icon ${testPath}`);
    validatePngDimensions(productionBytes, size, `Production icon ${productionPath}`);

    const sourceHash = sha256(sourceBytes);
    const builtHash = sha256(builtBytes);
    const productionHash = sha256(productionBytes);
    if (sourceHash !== expectedHashes.get(testPath)) {
      throw new Error(`Test icon does not match approved artwork: ${testPath}`);
    }
    if (builtHash !== sourceHash) {
      throw new Error(`Built test icon does not match tracked artwork: ${testPath}`);
    }
    if (sourceHash === productionHash) {
      throw new Error(`Test artwork must differ from production: ${testPath}`);
    }
    verifiedHashes[size] = sourceHash;
  }
  return verifiedHashes;
}

export function validateTestEntryNames(entryNames) {
  if (new Set(entryNames).size !== entryNames.length) {
    throw new Error('Test package must not contain duplicate entries.');
  }

  for (const entryName of entryNames) {
    if (entryName.startsWith('/') || entryName.includes('../') || entryName.includes('\\')) {
      throw new Error(`Unsafe test-package entry: ${entryName}`);
    }
    if (FORBIDDEN_TEST_ENTRY_PATTERNS.some((pattern) => pattern.test(entryName))) {
      throw new Error(`Forbidden test-package entry: ${entryName}`);
    }
    if (!ALLOWED_TEST_ENTRY_PATTERNS.some((pattern) => pattern.test(entryName))) {
      throw new Error(`Unexpected test-package entry: ${entryName}`);
    }
  }

  for (const requiredEntry of REQUIRED_TEST_ENTRIES) {
    if (!entryNames.includes(requiredEntry)) {
      throw new Error(`Test package is missing required entry: ${requiredEntry}`);
    }
  }
  if (!entryNames.some((entryName) => /^assets\/.+\.js$/u.test(entryName))) {
    throw new Error('Test package must contain a compiled JavaScript asset.');
  }
  if (!entryNames.some((entryName) => /^assets\/.+\.css$/u.test(entryName))) {
    throw new Error('Test package must contain a compiled stylesheet.');
  }
}

export function validateTestContents(entryContents) {
  for (const [entryName, bytes] of entryContents) {
    if (!/\.(?:css|html|js)$/u.test(entryName)) {
      continue;
    }
    const contents = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
    if (/sourceMappingURL\s*=/u.test(contents)) {
      throw new Error(`Test-package entry contains a source-map reference: ${entryName}`);
    }
    if (
      entryName.endsWith('.html') &&
      /\b(?:href|src)\s*=\s*["']\s*(?:https?:)?\/\//iu.test(contents)
    ) {
      throw new Error(`Test-package HTML references a remote asset: ${entryName}`);
    }
    if (
      entryName.endsWith('.css') &&
      /(?:@import\s+(?:url\()?|url\()\s*["']?\s*(?:https?:)?\/\//iu.test(contents)
    ) {
      throw new Error(`Test-package stylesheet references a remote asset: ${entryName}`);
    }
    if (
      entryName.endsWith('.js') &&
      (/\b(?:eval|Function)\s*\(/u.test(contents) ||
        /\b(?:importScripts\s*\(|import\s*\(|from\s*)["']\s*(?:https?:)?\/\//iu.test(contents))
    ) {
      throw new Error(`Test-package JavaScript contains remote or dynamic code: ${entryName}`);
    }
  }
}

function validateTestEntryContents(entryContents, { expectedManifest, expectedIconHashes }) {
  const entryNames = [...entryContents.keys()];
  validateTestEntryNames(entryNames);
  validateTestContents(entryContents);

  const manifestBytes = entryContents.get('manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error('Test package contains an unreadable manifest.json.');
  }
  if (!isDeepStrictEqual(manifest, expectedManifest)) {
    throw new Error('Test-package manifest does not match the approved generated manifest.');
  }

  for (const size of TEST_ICON_SIZES) {
    const iconPath = TEST_ICON_PATHS[size];
    const iconBytes = entryContents.get(iconPath);
    if (!iconBytes) {
      throw new Error(`Test package is missing approved artwork: ${iconPath}`);
    }
    if (sha256(iconBytes) !== expectedIconHashes[size]) {
      throw new Error(`Test package contains changed artwork: ${iconPath}`);
    }
  }
  return manifest;
}

async function walkTestBuild(directory, root = directory) {
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of directoryEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolutePath = join(directory, entry.name);
    const entryInfo = await lstat(absolutePath);
    if (entryInfo.isSymbolicLink()) {
      throw new Error(
        `Test build must not contain symbolic links: ${relative(root, absolutePath)}`,
      );
    }
    if (entryInfo.isDirectory()) {
      files.push(...(await walkTestBuild(absolutePath, root)));
    } else if (entryInfo.isFile()) {
      files.push(absolutePath);
    } else {
      throw new Error(`Test build contains a non-regular entry: ${relative(root, absolutePath)}`);
    }
  }
  return files;
}

export async function validateStagedTestBuild(
  unpackedPath,
  { expectedManifest, expectedIconHashes },
) {
  const files = await walkTestBuild(unpackedPath);
  const entryContents = new Map();
  for (const file of files) {
    const entryName = relative(unpackedPath, file).split(sep).join('/');
    entryContents.set(entryName, await readFile(file));
  }
  validateTestEntryContents(entryContents, { expectedManifest, expectedIconHashes });
  return [...entryContents.keys()].sort();
}

function readProtobufVarint(bytes, startOffset, label) {
  let value = 0n;
  let shift = 0n;
  let offset = startOffset;
  while (offset < bytes.length && offset - startOffset < 10) {
    const byte = bytes[offset];
    value |= BigInt(byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) {
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`${label} contains an oversized protobuf integer.`);
      }
      return { offset, value: Number(value) };
    }
    shift += 7n;
  }
  throw new Error(`${label} contains a malformed protobuf varint.`);
}

function parseProtobufFields(bytes, label) {
  const fields = [];
  let offset = 0;
  while (offset < bytes.length) {
    const key = readProtobufVarint(bytes, offset, label);
    offset = key.offset;
    const fieldNumber = Math.floor(key.value / 8);
    const wireType = key.value % 8;
    if (fieldNumber === 0) {
      throw new Error(`${label} contains protobuf field zero.`);
    }

    if (wireType === 0) {
      const parsed = readProtobufVarint(bytes, offset, label);
      offset = parsed.offset;
      fields.push({ fieldNumber, wireType, value: parsed.value });
    } else if (wireType === 1) {
      if (offset + 8 > bytes.length) {
        throw new Error(`${label} contains a truncated fixed64 field.`);
      }
      fields.push({ fieldNumber, wireType, data: bytes.subarray(offset, offset + 8) });
      offset += 8;
    } else if (wireType === 2) {
      const parsedLength = readProtobufVarint(bytes, offset, label);
      offset = parsedLength.offset;
      const endOffset = offset + parsedLength.value;
      if (endOffset > bytes.length) {
        throw new Error(`${label} contains a truncated length-delimited field.`);
      }
      fields.push({ fieldNumber, wireType, data: bytes.subarray(offset, endOffset) });
      offset = endOffset;
    } else if (wireType === 5) {
      if (offset + 4 > bytes.length) {
        throw new Error(`${label} contains a truncated fixed32 field.`);
      }
      fields.push({ fieldNumber, wireType, data: bytes.subarray(offset, offset + 4) });
      offset += 4;
    } else {
      throw new Error(`${label} contains unsupported protobuf wire type ${wireType}.`);
    }
  }
  return fields;
}

function oneLengthDelimitedField(fields, fieldNumber, label) {
  const matches = fields.filter(
    (field) => field.fieldNumber === fieldNumber && field.wireType === 2,
  );
  if (matches.length !== 1) {
    throw new Error(`${label} must contain exactly one field ${fieldNumber}.`);
  }
  return matches[0].data;
}

function readCrx3(crxBytes) {
  const validPrefix = crxBytes.length >= 12 && crxBytes.subarray(0, 4).toString('ascii') === 'Cr24';
  const version = validPrefix ? crxBytes.readUInt32LE(4) : undefined;
  const headerSize = validPrefix ? crxBytes.readUInt32LE(8) : undefined;
  const zipOffset = headerSize === undefined ? undefined : 12 + headerSize;
  if (!validPrefix || version !== 3 || zipOffset === undefined || zipOffset >= crxBytes.length) {
    throw new Error('Chrome produced an invalid CRX3 header.');
  }
  return {
    headerBytes: crxBytes.subarray(12, zipOffset),
    zipBytes: crxBytes.subarray(zipOffset),
  };
}

export function validateCrx3Identity(crxBytes, { expectedExtensionId, expectedPublicKeyDer }) {
  const { headerBytes, zipBytes } = readCrx3(crxBytes);
  const headerFields = parseProtobufFields(headerBytes, 'CRX3 header');
  const signedHeaderData = oneLengthDelimitedField(headerFields, 10_000, 'CRX3 header');
  const signedDataFields = parseProtobufFields(signedHeaderData, 'CRX3 signed data');
  const crxId = oneLengthDelimitedField(signedDataFields, 1, 'CRX3 signed data');
  if (crxId.byteLength !== 16) {
    throw new Error('CRX3 signed data contains an invalid crx_id length.');
  }

  const expectedCrxId = createHash('sha256').update(expectedPublicKeyDer).digest().subarray(0, 16);
  if (
    !crxId.equals(expectedCrxId) ||
    extensionIdFromPublicKey(expectedPublicKeyDer) !== expectedExtensionId
  ) {
    throw new Error('CRX3 signed crx_id does not match the expected test extension identity.');
  }

  const rsaProofs = headerFields.filter((field) => field.fieldNumber === 2 && field.wireType === 2);
  const matchingProofs = rsaProofs
    .map((field) => parseProtobufFields(field.data, 'CRX3 RSA proof'))
    .map((proofFields) => ({
      publicKey: oneLengthDelimitedField(proofFields, 1, 'CRX3 RSA proof'),
      signature: oneLengthDelimitedField(proofFields, 2, 'CRX3 RSA proof'),
    }))
    .filter((proof) => proof.publicKey.equals(expectedPublicKeyDer));
  if (matchingProofs.length !== 1) {
    throw new Error('CRX3 header does not contain exactly one proof for the expected test key.');
  }

  const signedHeaderSize = Buffer.alloc(4);
  signedHeaderSize.writeUInt32LE(signedHeaderData.byteLength);
  const signedBytes = Buffer.concat([
    Buffer.from('CRX3 SignedData\0', 'binary'),
    signedHeaderSize,
    signedHeaderData,
    zipBytes,
  ]);
  const signatureValid = verify(
    'sha256',
    signedBytes,
    createPublicKey({ key: expectedPublicKeyDer, format: 'der', type: 'spki' }),
    matchingProofs[0].signature,
  );
  if (!signatureValid) {
    throw new Error('CRX3 RSA proof signature verification failed.');
  }

  return { crxId: crxId.toString('hex'), headerBytes, zipBytes };
}

export function validatePackedTestCrx(
  crxBytes,
  { expectedManifest, expectedIconHashes, expectedExtensionId, expectedPublicKeyDer },
) {
  if (expectedManifest.key !== expectedPublicKeyDer.toString('base64')) {
    throw new Error('Approved test manifest key does not match the expected CRX3 proof key.');
  }
  const { zipBytes } = validateCrx3Identity(crxBytes, {
    expectedExtensionId,
    expectedPublicKeyDer,
  });
  let entries;
  try {
    entries = new AdmZip(Buffer.from(zipBytes))
      .getEntries()
      .filter((entry) => !entry.entryName.endsWith('/'));
  } catch (error) {
    if (error instanceof Error && error.message === 'Chrome produced an invalid CRX3 header.') {
      throw error;
    }
    throw new Error('Chrome produced a CRX with an unreadable ZIP payload.');
  }

  validateTestEntryNames(entries.map((entry) => entry.entryName));
  const entryContents = new Map(entries.map((entry) => [entry.entryName, entry.getData()]));
  const packedManifest = validateTestEntryContents(entryContents, {
    expectedManifest,
    expectedIconHashes,
  });
  const entryNames = [...entryContents.keys()];
  return { entries: entryNames.sort(), manifest: packedManifest };
}

export async function finalizeTestCrx({
  generatedCrxPath,
  crxPath,
  expectedManifest,
  expectedIconHashes,
  expectedExtensionId,
  expectedPublicKeyDer,
}) {
  const generatedBytes = await readFile(generatedCrxPath);
  validatePackedTestCrx(generatedBytes, {
    expectedManifest,
    expectedIconHashes,
    expectedExtensionId,
    expectedPublicKeyDer,
  });

  try {
    await copyFile(generatedCrxPath, crxPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw usage(`Test CRX already exists: ${crxPath}. Use a higher test version for an update.`);
    }
    throw error;
  }

  try {
    const finalizedBytes = await readFile(crxPath);
    if (sha256(finalizedBytes) !== sha256(generatedBytes)) {
      throw new Error('Finalized test CRX does not match Chrome output.');
    }
    validatePackedTestCrx(finalizedBytes, {
      expectedManifest,
      expectedIconHashes,
      expectedExtensionId,
      expectedPublicKeyDer,
    });
    return finalizedBytes;
  } catch (error) {
    await rm(crxPath, { force: true });
    throw error;
  }
}

async function readTestIdentity(environment) {
  const keyPath = environment.WEAVER_TEST_KEY_PATH;
  if (!keyPath) {
    throw usage('WEAVER_TEST_KEY_PATH is required.');
  }
  if (!isAbsolute(keyPath)) {
    throw usage('WEAVER_TEST_KEY_PATH must be absolute.');
  }
  const resolvedKeyPath = await realpath(keyPath).catch(() => {
    throw usage(`Test key does not exist: ${keyPath}`);
  });
  const keyInfo = await stat(resolvedKeyPath);
  if (!keyInfo.isFile()) {
    throw usage('WEAVER_TEST_KEY_PATH must resolve to a regular file.');
  }

  const resolvedRoot = await realpath(ROOT);
  const keyRelativeToRoot = relative(resolvedRoot, resolvedKeyPath);
  const keyIsInsideRoot =
    keyRelativeToRoot === '' ||
    (keyRelativeToRoot !== '..' &&
      !keyRelativeToRoot.startsWith(`..${sep}`) &&
      !isAbsolute(keyRelativeToRoot));
  if (keyIsInsideRoot) {
    throw usage('WEAVER_TEST_KEY_PATH must be stored outside the Weaver checkout.');
  }
  if (process.platform !== 'win32' && (keyInfo.mode & 0o077) !== 0) {
    throw usage(
      'Test key permissions must not grant access to group or other users. Restrict the key to its owner before retrying.',
    );
  }

  let privateKey;
  try {
    privateKey = createPrivateKey(await readFile(resolvedKeyPath));
  } catch {
    throw usage('The test key could not be read as an unencrypted private key.');
  }
  if (
    privateKey.asymmetricKeyType !== 'rsa' ||
    (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
  ) {
    throw usage('The test key must be an RSA private key with a modulus of at least 2048 bits.');
  }
  const publicKeyDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return {
    extensionId: extensionIdFromPublicKey(publicKeyDer),
    keyPath: resolvedKeyPath,
    publicKeyDer,
  };
}

const POSIX_CHROME_BINARY_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const WINDOWS_CHROME_BINARY_SUFFIXES = [
  ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ['Chromium', 'Application', 'chrome.exe'],
  ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
];

export function chromeBinaryCandidates(environment = process.env, platform = process.platform) {
  if (platform !== 'win32') {
    return [...POSIX_CHROME_BINARY_CANDIDATES];
  }

  const installRoots = [
    environment.ProgramFiles,
    environment['ProgramFiles(x86)'],
    environment.LOCALAPPDATA,
  ].filter((root) => typeof root === 'string' && win32.isAbsolute(root));

  return WINDOWS_CHROME_BINARY_SUFFIXES.flatMap((suffix) =>
    installRoots.map((root) => win32.join(root, ...suffix)),
  );
}

export async function resolveChromeBinary(
  environment,
  { platform = process.platform, statPath = stat } = {},
) {
  const pathImplementation = platform === 'win32' ? win32 : posix;
  const override = environment.WEAVER_CHROME_PATH;
  if (override) {
    if (!pathImplementation.isAbsolute(override)) {
      throw usage('WEAVER_CHROME_PATH must be absolute.');
    }
    const overrideInfo = await statPath(override).catch(() => undefined);
    if (!overrideInfo?.isFile()) {
      throw usage(`Browser executable does not exist: ${override}`);
    }
    return override;
  }

  for (const candidate of chromeBinaryCandidates(environment, platform)) {
    const info = await statPath(candidate).catch(() => undefined);
    if (info?.isFile()) {
      return candidate;
    }
  }
  throw usage('Could not find Chrome, Chromium, or Brave. Set WEAVER_CHROME_PATH.');
}

export async function showTestExtensionId(environment = process.env) {
  const { extensionId } = await readTestIdentity(environment);
  process.stdout.write(`${extensionId}\n`);
  return extensionId;
}

export async function buildTestExtension(environment = process.env) {
  const expectedExtensionId = environment.WEAVER_TEST_EXTENSION_ID;
  if (!expectedExtensionId || !EXTENSION_ID_PATTERN.test(expectedExtensionId)) {
    throw usage('WEAVER_TEST_EXTENSION_ID must contain 32 letters from a through p.');
  }
  assertTestExtensionIdIsSafe(expectedExtensionId);

  const { extensionId, keyPath, publicKeyDer } = await readTestIdentity(environment);
  assertTestExtensionIdIsSafe(extensionId);
  if (extensionId !== expectedExtensionId) {
    throw usage(
      `Test-key identity mismatch: expected ${expectedExtensionId}, derived ${extensionId}.`,
    );
  }

  const packageMetadata = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  if (packageMetadata.name !== 'weaver-tab-manager') {
    throw new Error('The test-package script is not running from a Weaver checkout.');
  }
  const sourceVersion = packageMetadata.version;
  const testVersion = resolveTestVersion(environment.WEAVER_TEST_VERSION);
  const localBuilds = join(ROOT, 'local_builds');
  const crxPath = join(localBuilds, `weaver-test-${testVersion}.crx`);
  const chromeBinary = await resolveChromeBinary(environment);

  await mkdir(localBuilds, { recursive: true });
  if (await stat(crxPath).catch(() => undefined)) {
    throw usage(`Test CRX already exists: ${crxPath}. Use a higher test version for an update.`);
  }
  const stagingPath = await mkdtemp(join(localBuilds, '.weaver-test-build-'));
  const unpackedPath = join(stagingPath, 'unpacked');
  const generatedCrxPath = `${unpackedPath}.crx`;
  const generatedPemPath = `${unpackedPath}.pem`;

  try {
    const { build: viteBuild } = await import('vite');
    await viteBuild({
      root: ROOT,
      mode: 'test',
      build: { outDir: unpackedPath, emptyOutDir: true },
    });

    const manifestPath = join(unpackedPath, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const signedManifest = createSignedTestManifest(manifest, {
      sourceVersion,
      testVersion,
      publicKeyBase64: publicKeyDer.toString('base64'),
    });
    const testIconSha256 = await validateTestIcons({ unpackedPath });
    await writeFile(manifestPath, `${JSON.stringify(signedManifest, null, 2)}\n`);
    await validateStagedTestBuild(unpackedPath, {
      expectedManifest: signedManifest,
      expectedIconHashes: testIconSha256,
    });

    execFileSync(
      chromeBinary,
      [`--pack-extension=${unpackedPath}`, `--pack-extension-key=${keyPath}`],
      { stdio: 'inherit' },
    );
    await access(generatedCrxPath).catch(() => {
      throw new Error(`Chrome did not create the expected CRX: ${generatedCrxPath}`);
    });
    if (await stat(generatedPemPath).catch(() => undefined)) {
      throw new Error('Chrome unexpectedly generated a new private key; the package was rejected.');
    }

    const crxBytes = await finalizeTestCrx({
      generatedCrxPath,
      crxPath,
      expectedManifest: signedManifest,
      expectedIconHashes: testIconSha256,
      expectedExtensionId: extensionId,
      expectedPublicKeyDer: publicKeyDer,
    });
    const result = {
      extensionId,
      sourceVersion,
      testVersion,
      testIconSha256,
      crxPath,
      crxSha256: sha256(crxBytes),
      crxBytes: crxBytes.byteLength,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await rm(stagingPath, { force: true, recursive: true });
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 0) {
    await buildTestExtension();
  } else if (arguments_.length === 1 && arguments_[0] === '--show-extension-id') {
    await showTestExtensionId();
  } else {
    throw usage(`Unknown arguments: ${arguments_.join(' ')}`);
  }
}
