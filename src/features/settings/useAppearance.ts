import { useLayoutEffect } from 'react';

import { type ColorMode } from './settingsService';

export type ResolvedColorMode = Exclude<ColorMode, 'system'>;

export function resolveColorMode(
  colorMode: ColorMode,
  systemPrefersDark: boolean,
): ResolvedColorMode {
  return colorMode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : colorMode;
}

export function useAppearance(colorMode: ColorMode) {
  useLayoutEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

    const apply = () => {
      const resolved = resolveColorMode(colorMode, mediaQuery?.matches ?? false);
      if (document.documentElement.dataset.theme !== resolved) {
        document.documentElement.dataset.theme = resolved;
      }
      if (document.documentElement.dataset.colorMode !== colorMode) {
        document.documentElement.dataset.colorMode = colorMode;
      }
      if (document.documentElement.style.colorScheme !== resolved) {
        document.documentElement.style.colorScheme = resolved;
      }
    };

    apply();
    if (colorMode !== 'system' || !mediaQuery) {
      return;
    }

    mediaQuery.addEventListener('change', apply);
    return () => mediaQuery.removeEventListener('change', apply);
  }, [colorMode]);
}
