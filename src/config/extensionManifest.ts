import packageMetadata from '../../package.json';
import { isTestExtensionMode } from './extensionBuildMode';

const PRODUCTION_ICONS = {
  16: 'icons/default-16.png',
  48: 'icons/default-48.png',
  128: 'icons/default-128.png',
};

const TEST_ICONS = {
  16: 'assets/extension-icons/test/test-16.png',
  48: 'assets/extension-icons/test/test-48.png',
  128: 'assets/extension-icons/test/test-128.png',
};

export function createExtensionManifest(mode: string) {
  const isTest = isTestExtensionMode(mode);
  const icons = isTest ? TEST_ICONS : PRODUCTION_ICONS;

  return {
    manifest_version: 3 as const,
    name: isTest ? 'Weaver Test - Window & Tab Manager' : 'Weaver - Window & Tab Manager',
    short_name: isTest ? 'Weaver Test' : 'Weaver',
    description: 'Organize, search, sort, save, restore, and deduplicate browser tabs and windows.',
    version: packageMetadata.version,
    minimum_chrome_version: '120',
    incognito: 'not_allowed',
    icons: { ...icons },
    action: {
      default_popup: 'src/popup/popup.html',
      default_title: isTest ? 'Open Weaver Test' : 'Open Weaver',
      default_icon: { ...icons },
    },
    background: {
      service_worker: 'src/background/service-worker.ts',
      type: 'module' as const,
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
