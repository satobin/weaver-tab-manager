import { defineManifest } from '@crxjs/vite-plugin';

import packageMetadata from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Weaver - Window & Tab Manager',
  short_name: 'Weaver',
  description: 'Organize, search, sort, save, restore, and deduplicate browser tabs and windows.',
  version: packageMetadata.version,
  minimum_chrome_version: '120',
  incognito: 'not_allowed',
  icons: {
    16: 'icons/default-16.png',
    48: 'icons/default-48.png',
    128: 'icons/default-128.png',
  },
  action: {
    default_popup: 'src/popup/popup.html',
    default_title: 'Open Weaver',
    default_icon: {
      16: 'icons/default-16.png',
      48: 'icons/default-48.png',
      128: 'icons/default-128.png',
    },
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  permissions: ['tabs', 'storage', 'tabGroups'],
  commands: {
    'open-manager': {
      suggested_key: {
        default: 'Ctrl+Shift+O',
        mac: 'Command+Shift+O',
      },
      description: 'Open Weaver',
    },
  },
});
