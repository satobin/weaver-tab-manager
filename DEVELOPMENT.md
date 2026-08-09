# Weaver development and packaging

Weaver has three build lanes: unpacked local testing, signed test CRXs, and public Store ZIPs. The unpacked lane supports both live development and one-time builds. Local and signed test builds are deliberately test-branded; Chrome Web Store and Microsoft Edge Add-ons packages are always production-branded.

## Choose a workflow

| Goal                    | Command                                              | What to use                                                   |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| Live development        | `pnpm run dev:test`                                  | Load `local_builds/vite-test-unpacked/`.                      |
| One-time unpacked build | `pnpm run build:test`                                | Load `local_builds/vite-test-build/`.                         |
| Managed-browser testing | `pnpm run package:test`                              | Build on a trusted machine; transfer only the generated CRX.  |
| Public release          | `pnpm run release:chrome` or `pnpm run release:edge` | Review the metadata; upload the target ZIP from `artifacts/`. |

Browser policy determines whether unpacked extensions or local CRXs are allowed. These workflows do not bypass device policy.

## Source setup (development and build machines only)

A machine that only receives and installs a signed test CRX does not need the source checkout, pnpm, dependencies, or signing key.

Run all commands from the repository root. Use the exact Node.js version recorded in `.node-version`. On a machine used to develop or build Weaver, enable Corepack if pnpm is not already available, then install the exact locked dependencies. These commands are the same in macOS/Linux shells and Windows PowerShell:

```sh
corepack enable
pnpm install --frozen-lockfile
```

Generated builds, CRXs, environment files, and common private-key formats are ignored by Git. This is a safety net, not a security boundary: keep signing keys outside the checkout, and never force-add them or generated packages.

## Dependency maintenance

Dependabot checks npm and GitHub Actions twice a year. Routine minor and patch updates are grouped to reduce review noise, while major npm upgrades remain separate so their migration and validation can be reviewed deliberately. React, React DOM, and their type packages are grouped because the runtime packages must use exactly matching versions. `@types/node` stays on the same major as the Node.js version in `.node-version`.

Version-update cooldowns do not delay Dependabot security updates. Repository administrators must enable Dependabot alerts and security updates separately in GitHub settings; `.github/dependabot.yml` does not enable those features.

When updating dependencies locally, regenerate and install the lockfile with the pinned Node.js and pnpm versions, then run:

```sh
pnpm audit --audit-level high
pnpm run check
pnpm run build:test
pnpm run package:preview:chrome
pnpm run package:preview:edge
```

## 1. Live local testing

Start the test-branded Vite development build:

```sh
pnpm run dev:test
```

`pnpm run dev` is an alias for the same command. Vite writes the live unpacked extension to `local_builds/vite-test-unpacked/`. Use one of these package scripts rather than invoking bare Vite when you expect test branding; Vite's default `development` mode intentionally falls back to production branding.

In a Chromium browser:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose `local_builds/vite-test-unpacked/`.
4. Keep Vite running while you work. Reload the extension from `chrome://extensions` after manifest or background-worker changes when Chrome does not pick them up automatically.

The Extensions page and toolbar show the violet test icon with its light-blue heart, the name **Weaver Test - Window & Tab Manager**, and the tooltip **Open Weaver Test**. This keeps a development install visibly distinct from the public extension.

For a one-time unpacked test build without a development server, run:

```sh
pnpm run build:test
```

Load `local_builds/vite-test-build/`. The live server and one-time build use separate directories so running `build:test` cannot clear the extension files currently served by `dev:test`.

## 2. Signed test CRX

Use a signed test CRX when unpacked extensions are unavailable but browser policy permits installing a CRX. Build it on a trusted development/build machine, then transfer only the CRX to the target device.

Use a dedicated test key, never a Store signing identity, and keep the private key outside the checkout. The paths and ID values below are placeholders; replace them with your own values rather than entering them literally.

### One-time test identity setup

If you already have a dedicated Weaver test key, skip key generation and reuse it. Generating a new key creates a different extension ID, a separate Chrome installation, and cannot update an extension installed with the old key.

Only when intentionally creating a new test identity, generate an unencrypted 2048-bit RSA PEM. On macOS or Linux with OpenSSL:

```sh
test_key_path="/absolute/secure/path/weaver-test.pem"
openssl genrsa -out "$test_key_path" 2048
chmod 600 "$test_key_path"
```

On Windows PowerShell, use OpenSSL if it is already installed from a trusted source:

```powershell
$testKeyPath = 'C:\absolute\secure\path\weaver-test.pem'
openssl genrsa -out $testKeyPath 2048

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $testKeyPath /inheritance:r /grant:r "${currentUser}:(F)"
icacls $testKeyPath
```

Review the final `icacls` output and make sure the key is not accessible to broad user groups. The builder verifies that a Windows key is a regular RSA file outside the checkout, but Windows ACLs do not map to the POSIX owner-mode check and must be reviewed separately.

The builder expects an unencrypted PEM, so protect it with filesystem access controls and a secure backup. Copy the same PEM only to another trusted packaging machine when that machine must produce updates for the same test identity. Reusing it on macOS and Windows preserves one test extension ID; creating a key on each machine does not.

Derive the stable Chrome extension ID once for that key:

```sh
WEAVER_TEST_KEY_PATH="/absolute/secure/path/weaver-test.pem" \
  pnpm run test:extension-id
```

Record the printed 32-character ID for future builds. The extension ID is a public identifier; the PEM is the private signing key and must remain secret.

The equivalent PowerShell flow is:

```powershell
$testKeyPath = 'C:\absolute\secure\path\weaver-test.pem'
$env:WEAVER_TEST_KEY_PATH = $testKeyPath
pnpm run test:extension-id
```

### Build a test update

Replace both placeholder values before running this command:

```sh
WEAVER_TEST_KEY_PATH="/absolute/secure/path/weaver-test.pem" \
WEAVER_TEST_EXTENSION_ID="paste-the-printed-32-character-id-here" \
  pnpm run package:test
```

`package:test` runs the shared test, typecheck, lint, and format checks before the packaging safety checks. It does not replace the user-run browser acceptance step for the resulting CRX.

On PowerShell, set the same values for the current terminal session:

```powershell
$env:WEAVER_TEST_KEY_PATH = $testKeyPath
$env:WEAVER_TEST_EXTENSION_ID = 'paste-the-printed-32-character-id-here'
pnpm run package:test
```

If browser discovery fails, set an absolute executable path before packaging. For example:

```powershell
$env:WEAVER_CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm run package:test
```

By default, the builder creates a chronological version in the form `99.<years-since-2000>.<UTC-day-of-year>.<UTC-minute-of-day>`, such as `99.26.220.801`. If you build twice in one minute or need to exceed an already-installed version, add an explicit, higher four-part version to the command. For example, if `99.26.220.801` is installed, use `WEAVER_TEST_VERSION=99.26.220.802`. The builder never overwrites an existing CRX, and Chrome requires a higher version for an in-place update.

In PowerShell, set an explicit version for the current terminal and run the package command again:

```powershell
$env:WEAVER_TEST_VERSION = '99.26.220.802'
pnpm run package:test
```

Clear the session settings and overrides when packaging is finished:

```powershell
Remove-Item Env:WEAVER_TEST_KEY_PATH -ErrorAction SilentlyContinue
Remove-Item Env:WEAVER_TEST_EXTENSION_ID -ErrorAction SilentlyContinue
Remove-Item Env:WEAVER_TEST_VERSION -ErrorAction SilentlyContinue
Remove-Item Env:WEAVER_CHROME_PATH -ErrorAction SilentlyContinue
```

Before returning the CRX, the builder automatically:

- requires a real RSA key of at least 2048 bits, stored outside the checkout and restricted to its owner on POSIX systems;
- verifies that the key derives the expected extension ID;
- refuses a test key whose derived ID matches a published Weaver Store ID;
- builds the exact test-mode manifest and approved test artwork;
- adds only the public portion of the test key, high test version, and test version label to the ignored generated manifest;
- asks Chrome to create `local_builds/weaver-test-<version>.crx`;
- reopens the CRX3 payload and verifies its manifest and icon bytes before finalizing it without overwrite;
- reports the CRX path, size, and SHA-256 checksum.

Set `WEAVER_CHROME_PATH` to an absolute Chrome, Chromium, or Brave executable on the build machine if the builder cannot find one automatically.

### Install on the target device

Transfer only the generated CRX to the target device; do not transfer the PEM, source checkout, or build environment. Compare the transferred file's SHA-256 checksum with the value reported by the builder before installing it.

On macOS, recompute the checksum using the exact path printed by the builder:

```sh
shasum -a 256 "/path/printed/by/the/builder.crx"
```

On Linux:

```sh
sha256sum "/path/printed/by/the/builder.crx"
```

On Windows PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 'C:\path\printed\by\the\builder.crx'
```

Recompute it again after transfer and compare the full hexadecimal digest, not only the filename or file size.

Where browser policy allows it, drag the newer CRX onto `chrome://extensions`. Reusing the same key keeps the extension ID stable, and a higher version updates the existing test installation in place. The test extension has no automatic update URL, so each update must be built, transferred, and installed manually. If local CRX installation is blocked, the device's browser policy or administrator must provide the installation path.

## 3. Public Store ZIPs

Create the production Chrome package:

```sh
pnpm run release:chrome
```

Create the production Edge package:

```sh
pnpm run release:edge
```

The package commands are identical in macOS/Linux shells and Windows PowerShell. Build on a trusted source machine. Upload only the Store ZIP; retain its JSON metadata with the release record so the reviewed checksum and source provenance remain available.

Before either release, confirm the intended branch and commit and verify the release version in `package.json`. Strict Store packaging requires the exact Node.js version in `.node-version`, the exact pnpm version in `packageManager`, and a clean Git working tree. If a `v<version>` tag already exists, it must identify the commit being packaged; this prevents a version from being silently rebuilt from different source.

Each command runs the relevant tests, type checks, lint/format checks, target-specific production build, and package validation. Use these release commands rather than the lower-level `zip:*` scripts so the correct target is rebuilt before packaging.

Review the target-specific ZIP and its matching JSON metadata in `artifacts/` before upload. The metadata records the ZIP checksum, source commit, clean-tree result, version-tag resolution, lockfile checksum, Node and pnpm versions, and creation time. Packaging never overwrites a different artifact for the same target and version; an identical rerun is idempotent. Do not upload a test CRX, preview ZIP, or unpacked test directory.

### Smoke-test the exact Store artifact

Treat source validation and browser acceptance as separate gates. For each target ZIP:

1. Extract the generated ZIP into a new temporary directory. Do not rebuild it for this check.
2. In the target browser, open `chrome://extensions` or `edge://extensions`, enable Developer mode, and load that extracted directory as an unpacked extension.
3. Confirm the production name, icon, version, and target-specific Store link.
4. Confirm the service worker starts without errors, the toolbar popup opens, and **Open Weaver** renders the current windows and tabs.
5. Exercise the release-critical actions you changed, then remove the temporary unpacked installation before using the Store-distributed build again.

The Store adds distribution signing later, but this check exercises the exact files that will be uploaded. Record the tested target, version, ZIP checksum, browser version, and result in the release notes or review record.

The generated Store ZIP contains no private key, manifest `key`, or test branding. It uses the normal Weaver name, tooltip, and production icons; the Store handles distribution signing. Upload and publication remain explicit manual release steps.

## Safety boundary

- Test artwork lives under `assets/extension-icons/test/`, not `public/`, so Vite does not copy it into ordinary builds.
- Only the exact Vite mode `test` selects test branding, and `pnpm run dev` deliberately aliases that mode. Every other mode—including Vite's default `development` mode, unknown modes, and `edge`—uses production branding.
- Live test output, one-time test builds, and signed-test staging use separate paths under ignored `local_builds/`; production builds use `dist/`.
- The Store packager requires the exact production manifest, rejects signing fields and unexpected paths, and checks approved production-icon SHA-256 values both before ZIP creation and after archive readback.
- Strict Store packaging rejects dirty source and conflicting version tags, publishes each artifact with atomic no-clobber creation, and refuses to overwrite different bytes. Rerunning completes a missing ZIP/metadata pair.
- CI uses visibly labeled, content-addressed `--preview` packages to exercise both target packaging contracts without weakening the strict release gate. Preview packages are never release candidates.
- Changing production artwork is intentionally a two-part review: update the production PNGs and explicitly update their approved hashes in `scripts/build-release.mjs`.

For ordinary source validation without packaging, run:

```sh
pnpm run validate
pnpm run build:edge
```
