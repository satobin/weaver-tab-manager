# Weaver

Weaver is a Manifest V3 Chrome extension for organizing active browser windows and tabs.

[Privacy policy](PRIVACY.md) | [Support](SUPPORT.md) | [Security](SECURITY.md)

## Features

- Search, sort, move, merge, suspend, restore, and close tabs across windows.
- Save named window snapshots locally and restore them later.
- Close exact duplicate URLs, with optional matching for Google Docs, Sheets, Slides, Notion,
  and user-defined sites.
- Preserve Chrome tab groups while organizing tabs.
- Use System, Light, or Dark appearance modes.

Advanced duplicate matching is off by default. Exact full-URL duplicate matching remains
available without enabling site-specific rules.

## Development

Requirements: Node.js 20 or newer and pnpm 11.

```bash
pnpm install
pnpm validate
```

Build an unpacked extension with `pnpm build`, then load `dist/` from `chrome://extensions` with
Developer mode enabled.

## Release Package

```bash
pnpm release:webstore
```

This runs the complete test, type, lint, format, and production-build gate before creating a
deterministic Store ZIP under `artifacts/`. The package validator enforces the approved permissions,
entrypoints, archive contents, and remote-code policy. Chrome Web Store submission remains manual.

## Architecture

- `app.html`: hash-routed full-page application
- `src/popup/`: toolbar popup
- `src/background/`: Manifest V3 service worker
- `src/platform/chrome/`: typed Chrome API boundaries
- `src/pages/`: application routes
- `scripts/`: deterministic build and packaging tools

## Privacy

Weaver has no account, analytics, advertising, or cloud service. Open-tab details, preferences,
custom rules, and saved-window snapshots are processed and stored locally in Chrome. See
the [privacy policy](PRIVACY.md) for the full disclosure.

## Support

Use [GitHub Issues](https://github.com/satobin/weaver-tab-manager/issues) for bug reports and feature
requests. Do not include private tab titles, URLs, saved-window contents, or other browsing data in
an issue. See [SUPPORT.md](SUPPORT.md) for details.

## License

Weaver is available under the [MIT License](LICENSE).
