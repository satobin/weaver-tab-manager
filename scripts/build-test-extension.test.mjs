// @vitest-environment node

import { Buffer } from 'node:buffer';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import AdmZip from 'adm-zip';
import { describe, expect, it, vi } from 'vitest';

import {
  assertTestExtensionIdIsSafe,
  buildTestExtension,
  chromeBinaryCandidates,
  createTimestampTestVersion,
  createSignedTestManifest,
  extensionIdFromPublicKey,
  finalizeTestCrx,
  resolveChromeBinary,
  resolveTestVersion,
  showTestExtensionId,
  validateCrx3Identity,
  validatePackedTestCrx,
  validateStagedTestBuild,
  validateTestContents,
  validateTestIcons,
} from './build-test-extension.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC_KEY_DER_BASE64 =
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDC9kxEIoiZuJZEAvNGmEx0CuLFVw+umcrhC0IWrUcsnIWTSNk0DtfRvzJrI3SNFZZVeRUmJsPpVFmUwSCttSfypss+3iajeAb2bC+u/v9gsnyS9lw9BpMzE3wxZahj7BwzzW+guctXfDGkkegUeTQ1IYSdppyO8w7kJLjwPcrGAQIDAQAB';
const ICON_SIZES = [16, 48, 128];
const TEST_SIGNING_IDENTITY = generateKeyPairSync('rsa', { modulusLength: 2048 });
const WEAK_TEST_SIGNING_IDENTITY = generateKeyPairSync('rsa', { modulusLength: 1024 });
const TEST_PUBLIC_KEY_DER = TEST_SIGNING_IDENTITY.publicKey.export({
  type: 'spki',
  format: 'der',
});
const TEST_EXTENSION_ID = extensionIdFromPublicKey(TEST_PUBLIC_KEY_DER);
const TEST_PUBLIC_KEY_BASE64 = TEST_PUBLIC_KEY_DER.toString('base64');
const EXPECTED_CRX_IDENTITY = {
  expectedExtensionId: TEST_EXTENSION_ID,
  expectedPublicKeyDer: TEST_PUBLIC_KEY_DER,
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function createUnsignedTestManifest() {
  const icons = {
    16: 'assets/extension-icons/test/test-16.png',
    48: 'assets/extension-icons/test/test-48.png',
    128: 'assets/extension-icons/test/test-128.png',
  };
  return {
    name: 'Weaver Test - Window & Tab Manager',
    short_name: 'Weaver Test',
    description: 'Organize, search, sort, save, restore, and deduplicate browser tabs and windows.',
    version: '1.0.4',
    manifest_version: 3,
    minimum_chrome_version: '120',
    incognito: 'not_allowed',
    icons,
    action: {
      default_popup: 'src/popup/popup.html',
      default_title: 'Open Weaver Test',
      default_icon: { ...icons },
    },
    background: {
      service_worker: 'service-worker-loader.js',
      type: 'module',
    },
    permissions: ['tabs', 'storage', 'tabGroups'],
    commands: {
      'open-manager': {
        suggested_key: {
          default: 'Ctrl+Shift+1',
          mac: 'Command+Shift+1',
        },
        description: 'Open Window Manager',
      },
    },
  };
}

function createPngFixture(size, marker) {
  const bytes = Buffer.alloc(64);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(size, 16);
  bytes.writeUInt32BE(size, 20);
  Buffer.from(marker).copy(bytes, 24);
  return bytes;
}

function encodeVarint(value) {
  const bytes = [];
  let remaining = BigInt(value);
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining !== 0n);
  return Buffer.from(bytes);
}

function encodeBytesField(fieldNumber, bytes) {
  return Buffer.concat([encodeVarint(fieldNumber * 8 + 2), encodeVarint(bytes.length), bytes]);
}

function createPackageEntryContents(manifest, iconBytesBySize) {
  const entries = new Map([
    ['THIRD_PARTY_NOTICES.txt', Buffer.from('Test notices\n')],
    ['app.html', Buffer.from('<main id="root"></main>\n')],
    ['assets/app.css', Buffer.from('body { color: inherit; }\n')],
    ['assets/app.js', Buffer.from('console.info("weaver test fixture");\n')],
    ['icons/default-16.png', createPngFixture(16, 'production-16')],
    ['icons/default-48.png', createPngFixture(48, 'production-48')],
    ['icons/default-128.png', createPngFixture(128, 'production-128')],
    ['manifest.json', Buffer.from(`${JSON.stringify(manifest)}\n`)],
    ['service-worker-loader.js', Buffer.from('console.info("service worker fixture");\n')],
    ['src/popup/popup.html', Buffer.from('<main id="popup"></main>\n')],
  ]);
  for (const size of ICON_SIZES) {
    entries.set(`assets/extension-icons/test/test-${size}.png`, iconBytesBySize[size]);
  }
  return entries;
}

function createCrxFixture(
  manifest,
  iconBytesBySize,
  {
    entryOverrides = new Map(),
    privateKey = TEST_SIGNING_IDENTITY.privateKey,
    publicKeyDer = TEST_PUBLIC_KEY_DER,
  } = {},
) {
  const archive = new AdmZip();
  const entries = createPackageEntryContents(manifest, iconBytesBySize);
  for (const [entryName, bytes] of entryOverrides) {
    entries.set(entryName, bytes);
  }
  for (const [entryName, bytes] of entries) {
    archive.addFile(entryName, bytes);
  }
  const zipBytes = archive.toBuffer();
  const crxId = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  const signedHeaderData = encodeBytesField(1, crxId);
  const signedHeaderSize = Buffer.alloc(4);
  signedHeaderSize.writeUInt32LE(signedHeaderData.length);
  const signedBytes = Buffer.concat([
    Buffer.from('CRX3 SignedData\0', 'binary'),
    signedHeaderSize,
    signedHeaderData,
    zipBytes,
  ]);
  const signature = sign('sha256', signedBytes, privateKey);
  const proof = Buffer.concat([encodeBytesField(1, publicKeyDer), encodeBytesField(2, signature)]);
  const header = Buffer.concat([
    encodeBytesField(2, proof),
    encodeBytesField(10_000, signedHeaderData),
  ]);
  const prefix = Buffer.alloc(12);
  prefix.write('Cr24', 0, 'ascii');
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, zipBytes]);
}

async function writePackageEntries(root, entries) {
  for (const [entryName, bytes] of entries) {
    const filePath = join(root, entryName);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);
  }
}

async function writePrivateKeyFixture(root, privateKey, name = 'test-key.pem') {
  const keyPath = join(root, name);
  await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  return keyPath;
}

async function createIconFixture() {
  const root = await mkdtemp(join(tmpdir(), 'weaver-test-icons-'));
  const unpackedPath = join(root, 'unpacked');
  await Promise.all([
    mkdir(join(root, 'assets', 'extension-icons', 'test'), { recursive: true }),
    mkdir(join(root, 'public', 'icons'), { recursive: true }),
    mkdir(join(unpackedPath, 'assets', 'extension-icons', 'test'), { recursive: true }),
  ]);

  const expectedHashes = new Map();
  for (const size of ICON_SIZES) {
    const testPath = `assets/extension-icons/test/test-${size}.png`;
    const testBytes = createPngFixture(size, `test-${size}`);
    const productionBytes = createPngFixture(size, `production-${size}`);
    await Promise.all([
      writeFile(join(root, testPath), testBytes),
      writeFile(join(unpackedPath, testPath), testBytes),
      writeFile(join(root, 'public', 'icons', `default-${size}.png`), productionBytes),
    ]);
    expectedHashes.set(testPath, sha256(testBytes));
  }
  return { root, unpackedPath, expectedHashes };
}

describe('signed test extension package', () => {
  it('fails before building when identity inputs are absent', async () => {
    await expect(buildTestExtension({})).rejects.toThrow('WEAVER_TEST_EXTENSION_ID');
    await expect(showTestExtensionId({})).rejects.toThrow('WEAVER_TEST_KEY_PATH');
  });

  it('accepts a private 2048-bit RSA test key stored outside the checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weaver-test-key-'));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const keyPath = await writePrivateKeyFixture(root, TEST_SIGNING_IDENTITY.privateKey);
      await expect(showTestExtensionId({ WEAVER_TEST_KEY_PATH: keyPath })).resolves.toBe(
        TEST_EXTENSION_ID,
      );
    } finally {
      stdout.mockRestore();
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects weak, non-regular, and in-checkout test keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weaver-unsafe-test-key-'));
    await mkdir(join(ROOT, 'local_builds'), { recursive: true });
    const checkoutFixture = await mkdtemp(join(ROOT, 'local_builds', '.test-key-fixture-'));
    try {
      const weakKeyPath = await writePrivateKeyFixture(
        root,
        WEAK_TEST_SIGNING_IDENTITY.privateKey,
        'weak.pem',
      );
      await expect(showTestExtensionId({ WEAVER_TEST_KEY_PATH: weakKeyPath })).rejects.toThrow(
        'at least 2048 bits',
      );
      await expect(showTestExtensionId({ WEAVER_TEST_KEY_PATH: root })).rejects.toThrow(
        'regular file',
      );

      const checkoutKeyPath = await writePrivateKeyFixture(
        checkoutFixture,
        TEST_SIGNING_IDENTITY.privateKey,
      );
      await expect(showTestExtensionId({ WEAVER_TEST_KEY_PATH: checkoutKeyPath })).rejects.toThrow(
        'outside the Weaver checkout',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(checkoutFixture, { force: true, recursive: true });
    }
  });

  it('rejects group- or world-readable test keys on POSIX', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'weaver-permissive-test-key-'));
    try {
      const keyPath = await writePrivateKeyFixture(root, TEST_SIGNING_IDENTITY.privateKey);
      await chmod(keyPath, 0o644);
      await expect(showTestExtensionId({ WEAVER_TEST_KEY_PATH: keyPath })).rejects.toThrow(
        'Restrict the key to its owner',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('creates a monotonic UTC test version and accepts an explicit override', () => {
    const now = new Date(Date.UTC(2026, 7, 8, 13, 21));

    expect(createTimestampTestVersion(now)).toBe('99.26.220.801');
    expect(resolveTestVersion(undefined, now)).toBe('99.26.220.801');
    expect(resolveTestVersion('99.1.0.28', now)).toBe('99.1.0.28');
  });

  it('rejects invalid timestamps', () => {
    expect(() => createTimestampTestVersion(new Date('invalid'))).toThrow();
    expect(() => createTimestampTestVersion(new Date(Date.UTC(1999, 11, 31)))).toThrow();
  });

  it.each(['1.0.0.3', '99.1.3', '99.1.0.70000', '99.01.0.3'])(
    'rejects invalid explicit test version %s',
    (version) => {
      expect(() => resolveTestVersion(version)).toThrow();
    },
  );

  it('discovers Windows Chrome, Chromium, and Brave installs in deterministic order', () => {
    const environment = {
      ProgramFiles: String.raw`C:\Program Files`,
      'ProgramFiles(x86)': String.raw`C:\Program Files (x86)`,
      LOCALAPPDATA: String.raw`C:\Users\weaver\AppData\Local`,
    };

    expect(chromeBinaryCandidates(environment, 'win32')).toEqual([
      String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
      String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
      String.raw`C:\Users\weaver\AppData\Local\Google\Chrome\Application\chrome.exe`,
      String.raw`C:\Program Files\Chromium\Application\chrome.exe`,
      String.raw`C:\Program Files (x86)\Chromium\Application\chrome.exe`,
      String.raw`C:\Users\weaver\AppData\Local\Chromium\Application\chrome.exe`,
      String.raw`C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`,
      String.raw`C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe`,
      String.raw`C:\Users\weaver\AppData\Local\BraveSoftware\Brave-Browser\Application\brave.exe`,
    ]);
  });

  it('ignores missing or non-absolute Windows install roots', () => {
    expect(
      chromeBinaryCandidates(
        {
          ProgramFiles: String.raw`C:\Program Files`,
          'ProgramFiles(x86)': 'relative-program-files',
        },
        'win32',
      ),
    ).toEqual([
      String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
      String.raw`C:\Program Files\Chromium\Application\chrome.exe`,
      String.raw`C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`,
    ]);
  });

  it('prefers an explicit Windows browser path over auto-discovery', async () => {
    const override = String.raw`D:\Portable Apps\Brave\brave.exe`;
    const checkedPaths = [];
    const statPath = vi.fn(async (candidate) => {
      checkedPaths.push(candidate);
      return { isFile: () => true };
    });

    await expect(
      resolveChromeBinary(
        {
          WEAVER_CHROME_PATH: override,
          ProgramFiles: String.raw`C:\Program Files`,
        },
        { platform: 'win32', statPath },
      ),
    ).resolves.toBe(override);
    expect(checkedPaths).toEqual([override]);
  });

  it('uses platform-neutral usage help without shell placeholders', async () => {
    const error = await buildTestExtension({}).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Set environment variables using your shell');
    expect(error.message).toContain('pnpm run package:test');
    expect(error.message).not.toMatch(/[<>]|\\$/mu);
  });

  it('derives Chrome extension IDs from the public SPKI key', () => {
    expect(extensionIdFromPublicKey(Buffer.from(PUBLIC_KEY_DER_BASE64, 'base64'))).toBe(
      'ekficpdjamghmbbkfmanbbeedcbihblp',
    );
  });

  it('refuses to package either public Store identity', () => {
    expect(() => assertTestExtensionIdIsSafe('lchcjicakojjacjpleolmjcjlppaeobn')).toThrow(
      'public Store identity',
    );
    expect(() => assertTestExtensionIdIsSafe('fncihblgmobedbbbnbdhabmjnphdoddh')).toThrow(
      'public Store identity',
    );
    expect(() => assertTestExtensionIdIsSafe('ekficpdjamghmbbkfmanbbeedcbihblp')).not.toThrow();
  });

  it('adds only signed-test identity fields to the generated manifest', () => {
    const manifest = createUnsignedTestManifest();
    const original = structuredClone(manifest);
    const signed = createSignedTestManifest(manifest, {
      sourceVersion: '1.0.4',
      testVersion: '99.1.0.28',
      publicKeyBase64: TEST_PUBLIC_KEY_BASE64,
    });

    expect(manifest).toEqual(original);
    expect(signed).toEqual({
      ...original,
      version: '99.1.0.28',
      version_name: '1.0.4 test build',
      key: TEST_PUBLIC_KEY_BASE64,
    });
  });

  it('rejects production branding or a pre-signed generated manifest', () => {
    expect(() =>
      createSignedTestManifest(
        { ...createUnsignedTestManifest(), name: 'Weaver - Window & Tab Manager' },
        {
          sourceVersion: '1.0.4',
          testVersion: '99.1.0.28',
          publicKeyBase64: TEST_PUBLIC_KEY_BASE64,
        },
      ),
    ).toThrow('expected unsigned Weaver test manifest');
    expect(() =>
      createSignedTestManifest(
        { ...createUnsignedTestManifest(), key: 'unexpected-key' },
        {
          sourceVersion: '1.0.4',
          testVersion: '99.1.0.28',
          publicKeyBase64: TEST_PUBLIC_KEY_BASE64,
        },
      ),
    ).toThrow('expected unsigned Weaver test manifest');
    expect(() =>
      createSignedTestManifest(
        {
          ...createUnsignedTestManifest(),
          permissions: ['tabs', 'storage', 'tabGroups', 'history'],
        },
        {
          sourceVersion: '1.0.4',
          testVersion: '99.1.0.28',
          publicKeyBase64: TEST_PUBLIC_KEY_BASE64,
        },
      ),
    ).toThrow('expected unsigned Weaver test manifest');
  });

  it('reads the signed manifest and approved artwork back from a CRX3 payload', () => {
    const manifest = createSignedTestManifest(createUnsignedTestManifest(), {
      sourceVersion: '1.0.4',
      testVersion: '99.26.220.801',
      publicKeyBase64: TEST_PUBLIC_KEY_BASE64,
    });
    const iconBytesBySize = Object.fromEntries(
      ICON_SIZES.map((size) => [size, createPngFixture(size, `packed-${size}`)]),
    );
    const expectedIconHashes = Object.fromEntries(
      ICON_SIZES.map((size) => [size, sha256(iconBytesBySize[size])]),
    );
    const crxBytes = createCrxFixture(manifest, iconBytesBySize);

    expect(
      validatePackedTestCrx(crxBytes, {
        expectedManifest: manifest,
        expectedIconHashes,
        ...EXPECTED_CRX_IDENTITY,
      }),
    ).toEqual(expect.objectContaining({ manifest }));

    const invalidHeader = Buffer.from(crxBytes);
    invalidHeader.writeUInt32LE(2, 4);
    expect(() =>
      validatePackedTestCrx(invalidHeader, {
        expectedManifest: manifest,
        expectedIconHashes,
        ...EXPECTED_CRX_IDENTITY,
      }),
    ).toThrow('invalid CRX3 header');

    const changedManifest = { ...manifest, name: 'Changed test package' };
    expect(() =>
      validatePackedTestCrx(createCrxFixture(changedManifest, iconBytesBySize), {
        expectedManifest: manifest,
        expectedIconHashes,
        ...EXPECTED_CRX_IDENTITY,
      }),
    ).toThrow('manifest does not match');
    expect(() =>
      validatePackedTestCrx(crxBytes, {
        expectedManifest: { ...manifest, key: Buffer.from('different key').toString('base64') },
        expectedIconHashes,
        ...EXPECTED_CRX_IDENTITY,
      }),
    ).toThrow('manifest key does not match');
  });

  it('verifies the CRX3 signed identity and RSA proof over the archive', () => {
    const manifest = createSignedTestManifest(createUnsignedTestManifest(), {
      sourceVersion: '1.0.4',
      testVersion: '99.26.220.801',
      publicKeyBase64: TEST_PUBLIC_KEY_BASE64,
    });
    const iconBytesBySize = Object.fromEntries(
      ICON_SIZES.map((size) => [size, createPngFixture(size, `packed-${size}`)]),
    );
    const crxBytes = createCrxFixture(manifest, iconBytesBySize);
    const expectedCrxId = createHash('sha256')
      .update(TEST_PUBLIC_KEY_DER)
      .digest('hex')
      .slice(0, 32);

    expect(validateCrx3Identity(crxBytes, EXPECTED_CRX_IDENTITY)).toEqual(
      expect.objectContaining({ crxId: expectedCrxId }),
    );

    const changedArchive = Buffer.from(crxBytes);
    changedArchive[changedArchive.length - 1] ^= 1;
    expect(() => validateCrx3Identity(changedArchive, EXPECTED_CRX_IDENTITY)).toThrow(
      'signature verification failed',
    );
    expect(() =>
      validateCrx3Identity(crxBytes, {
        ...EXPECTED_CRX_IDENTITY,
        expectedExtensionId: 'a'.repeat(32),
      }),
    ).toThrow('signed crx_id does not match');
  });

  it('rejects unexpected files, source maps, and dynamic code in signed CRXs', () => {
    const manifest = createSignedTestManifest(createUnsignedTestManifest(), {
      sourceVersion: '1.0.4',
      testVersion: '99.26.220.801',
      publicKeyBase64: TEST_PUBLIC_KEY_BASE64,
    });
    const iconBytesBySize = Object.fromEntries(
      ICON_SIZES.map((size) => [size, createPngFixture(size, `packed-${size}`)]),
    );
    const expectedIconHashes = Object.fromEntries(
      ICON_SIZES.map((size) => [size, sha256(iconBytesBySize[size])]),
    );
    const expectations = {
      expectedManifest: manifest,
      expectedIconHashes,
      ...EXPECTED_CRX_IDENTITY,
    };

    expect(() =>
      validatePackedTestCrx(
        createCrxFixture(manifest, iconBytesBySize, {
          entryOverrides: new Map([['unexpected.txt', Buffer.from('unexpected')]]),
        }),
        expectations,
      ),
    ).toThrow('Unexpected test-package entry');
    expect(() =>
      validatePackedTestCrx(
        createCrxFixture(manifest, iconBytesBySize, {
          entryOverrides: new Map([['assets/debug.map', Buffer.from('{}')]]),
        }),
        expectations,
      ),
    ).toThrow('Forbidden test-package entry');
    expect(() =>
      validatePackedTestCrx(
        createCrxFixture(manifest, iconBytesBySize, {
          entryOverrides: new Map([['assets/app.js', Buffer.from('eval("unsafe")')]]),
        }),
        expectations,
      ),
    ).toThrow('remote or dynamic code');
  });

  it('validates the complete staged test build before Chrome packs it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weaver-test-staged-'));
    try {
      const manifest = createSignedTestManifest(createUnsignedTestManifest(), {
        sourceVersion: '1.0.4',
        testVersion: '99.26.220.801',
        publicKeyBase64: TEST_PUBLIC_KEY_BASE64,
      });
      const iconBytesBySize = Object.fromEntries(
        ICON_SIZES.map((size) => [size, createPngFixture(size, `packed-${size}`)]),
      );
      const expectedIconHashes = Object.fromEntries(
        ICON_SIZES.map((size) => [size, sha256(iconBytesBySize[size])]),
      );
      await writePackageEntries(root, createPackageEntryContents(manifest, iconBytesBySize));

      await expect(
        validateStagedTestBuild(root, { expectedManifest: manifest, expectedIconHashes }),
      ).resolves.toContain('manifest.json');

      await writeFile(join(root, 'unexpected-public-file.txt'), 'unexpected');
      await expect(
        validateStagedTestBuild(root, { expectedManifest: manifest, expectedIconHashes }),
      ).rejects.toThrow('Unexpected test-package entry');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects source-map references and remote assets in test-package contents', () => {
    expect(() =>
      validateTestContents(
        new Map([['assets/app.js', Buffer.from('//# sourceMappingURL=app.js.map')]]),
      ),
    ).toThrow('source-map reference');
    expect(() =>
      validateTestContents(
        new Map([['app.html', Buffer.from('<script src="https://example.com/app.js"></script>')]]),
      ),
    ).toThrow('remote asset');
  });

  it('finalizes a verified CRX without overwriting an existing artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weaver-test-crx-'));
    try {
      const manifest = createSignedTestManifest(createUnsignedTestManifest(), {
        sourceVersion: '1.0.4',
        testVersion: '99.26.220.801',
        publicKeyBase64: TEST_PUBLIC_KEY_BASE64,
      });
      const iconBytesBySize = Object.fromEntries(
        ICON_SIZES.map((size) => [size, createPngFixture(size, `packed-${size}`)]),
      );
      const expectedIconHashes = Object.fromEntries(
        ICON_SIZES.map((size) => [size, sha256(iconBytesBySize[size])]),
      );
      const generatedCrxPath = join(root, 'generated.crx');
      const crxPath = join(root, 'final.crx');
      const crxBytes = createCrxFixture(manifest, iconBytesBySize);
      await writeFile(generatedCrxPath, crxBytes);

      await expect(
        finalizeTestCrx({
          generatedCrxPath,
          crxPath,
          expectedManifest: manifest,
          expectedIconHashes,
          ...EXPECTED_CRX_IDENTITY,
        }),
      ).resolves.toEqual(crxBytes);

      await expect(
        finalizeTestCrx({
          generatedCrxPath,
          crxPath,
          expectedManifest: manifest,
          expectedIconHashes,
          ...EXPECTED_CRX_IDENTITY,
        }),
      ).rejects.toThrow('Test CRX already exists');
      await expect(readFile(crxPath)).resolves.toEqual(crxBytes);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('verifies copied test artwork without changing production artwork', async () => {
    const fixture = await createIconFixture();
    try {
      await expect(
        validateTestIcons({
          repoPath: fixture.root,
          unpackedPath: fixture.unpackedPath,
          expectedHashes: fixture.expectedHashes,
        }),
      ).resolves.toEqual({
        16: fixture.expectedHashes.get('assets/extension-icons/test/test-16.png'),
        48: fixture.expectedHashes.get('assets/extension-icons/test/test-48.png'),
        128: fixture.expectedHashes.get('assets/extension-icons/test/test-128.png'),
      });

      const productionBytes = await readFile(
        join(fixture.root, 'public', 'icons', 'default-16.png'),
      );
      expect(sha256(productionBytes)).not.toBe(
        fixture.expectedHashes.get('assets/extension-icons/test/test-16.png'),
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it('rejects changed built artwork and incorrect dimensions', async () => {
    const changedFixture = await createIconFixture();
    try {
      await writeFile(
        join(changedFixture.unpackedPath, 'assets', 'extension-icons', 'test', 'test-16.png'),
        createPngFixture(16, 'changed-built-icon'),
      );
      await expect(
        validateTestIcons({
          repoPath: changedFixture.root,
          unpackedPath: changedFixture.unpackedPath,
          expectedHashes: changedFixture.expectedHashes,
        }),
      ).rejects.toThrow('Built test icon does not match tracked artwork');
    } finally {
      await rm(changedFixture.root, { force: true, recursive: true });
    }

    const wrongSizeFixture = await createIconFixture();
    try {
      const wrongSizeBytes = createPngFixture(32, 'wrong-size-icon');
      await writeFile(
        join(wrongSizeFixture.root, 'assets', 'extension-icons', 'test', 'test-16.png'),
        wrongSizeBytes,
      );
      wrongSizeFixture.expectedHashes.set(
        'assets/extension-icons/test/test-16.png',
        sha256(wrongSizeBytes),
      );
      await expect(
        validateTestIcons({
          repoPath: wrongSizeFixture.root,
          unpackedPath: wrongSizeFixture.unpackedPath,
          expectedHashes: wrongSizeFixture.expectedHashes,
        }),
      ).rejects.toThrow('must be a 16x16 PNG');
    } finally {
      await rm(wrongSizeFixture.root, { force: true, recursive: true });
    }
  });

  it('keeps the tracked test artwork on its approved dimensions and hashes', async () => {
    await expect(validateTestIcons({ repoPath: ROOT, unpackedPath: ROOT })).resolves.toEqual({
      16: 'dd210794744209713359cfa6b08a7b9ad1d0b53f952df29d88ed608031d28b26',
      48: '3137d9298e75269ce1e0fc83136430e0bdff3ee301f5c1a010dcf5309db266b0',
      128: '85dd3d2e458d4cce91bf54d34da3e4f04c2b8098b1cc1824a0af7f34413f5abb',
    });
  });
});
