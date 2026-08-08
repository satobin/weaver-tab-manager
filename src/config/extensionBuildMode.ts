export function isTestExtensionMode(mode: string): boolean {
  return mode === 'test';
}

export type ExtensionBuildCommand = 'build' | 'serve';

export function getExtensionOutDir(mode: string, command: ExtensionBuildCommand): string {
  if (!isTestExtensionMode(mode)) {
    return 'dist';
  }

  return command === 'serve' ? 'local_builds/vite-test-unpacked' : 'local_builds/vite-test-build';
}
