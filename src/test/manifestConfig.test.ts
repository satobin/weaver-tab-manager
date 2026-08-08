import { getExtensionOutDir } from '../config/extensionBuildMode';
import { createExtensionManifest } from '../config/extensionManifest';

describe('extension build modes', () => {
  it('uses distinct branding and artwork only for the exact test mode', () => {
    const manifest = createExtensionManifest('test');

    expect(manifest.name).toBe('Weaver Test - Window & Tab Manager');
    expect(manifest.short_name).toBe('Weaver Test');
    expect(manifest.action.default_title).toBe('Open Weaver Test');
    expect(manifest.icons).toEqual({
      16: 'assets/extension-icons/test/test-16.png',
      48: 'assets/extension-icons/test/test-48.png',
      128: 'assets/extension-icons/test/test-128.png',
    });
    expect(manifest.action.default_icon).toEqual(manifest.icons);
    expect(getExtensionOutDir('test', 'serve')).toBe('local_builds/vite-test-unpacked');
    expect(getExtensionOutDir('test', 'build')).toBe('local_builds/vite-test-build');
  });

  it.each(['production', 'development', 'edge', 'unexpected'])(
    'keeps %s production-safe',
    (mode) => {
      const manifest = createExtensionManifest(mode);

      expect(manifest.name).toBe('Weaver - Window & Tab Manager');
      expect(manifest.short_name).toBe('Weaver');
      expect(manifest.action.default_title).toBe('Open Weaver');
      expect(manifest.icons).toEqual({
        16: 'icons/default-16.png',
        48: 'icons/default-48.png',
        128: 'icons/default-128.png',
      });
      expect(manifest.action.default_icon).toEqual(manifest.icons);
      expect(getExtensionOutDir(mode, 'serve')).toBe('dist');
      expect(getExtensionOutDir(mode, 'build')).toBe('dist');
    },
  );
});
