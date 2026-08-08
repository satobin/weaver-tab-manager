import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import manifest from './manifest.config';
import { getExtensionOutDir } from './src/config/extensionBuildMode';

export default defineConfig(({ command, mode }) => ({
  plugins: [react(), crx({ manifest })],
  build: {
    outDir: getExtensionOutDir(mode, command),
    sourcemap: false,
    rollupOptions: {
      input: {
        app: 'app.html',
        popup: 'src/popup/popup.html',
      },
    },
  },
}));
