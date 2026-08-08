import { defineManifest } from '@crxjs/vite-plugin';

import { createExtensionManifest } from './src/config/extensionManifest';

export default defineManifest(({ mode }) => createExtensionManifest(mode));
