import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type ColorMode } from './settingsService';
import { resolveColorMode, useAppearance } from './useAppearance';

function AppearanceHarness({ colorMode }: { colorMode: ColorMode }) {
  useAppearance(colorMode);
  return null;
}

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const addEventListener = vi.fn((_type: string, listener: () => void) => listeners.add(listener));
  const removeEventListener = vi.fn((_type: string, listener: () => void) =>
    listeners.delete(listener),
  );
  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener,
    removeEventListener,
  } as unknown as MediaQueryList;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => mediaQuery),
  });
  return {
    addEventListener,
    removeEventListener,
    setMatches(value: boolean) {
      matches = value;
      listeners.forEach((listener) => listener());
    },
  };
}

describe('useAppearance', () => {
  it('resolves fixed and system appearance choices', () => {
    expect(resolveColorMode('light', true)).toBe('light');
    expect(resolveColorMode('dark', false)).toBe('dark');
    expect(resolveColorMode('system', false)).toBe('light');
    expect(resolveColorMode('system', true)).toBe('dark');
  });

  it('tracks system changes only while System is selected', () => {
    const matchMedia = installMatchMedia(false);
    const { rerender } = render(<AppearanceHarness colorMode="system" />);

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(matchMedia.addEventListener).toHaveBeenCalledTimes(1);
    act(() => matchMedia.setMatches(true));
    expect(document.documentElement.dataset.theme).toBe('dark');

    rerender(<AppearanceHarness colorMode="light" />);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(matchMedia.removeEventListener).toHaveBeenCalledTimes(1);
    act(() => matchMedia.setMatches(false));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('does not rewrite visual theme attributes when the resolved mode is unchanged', () => {
    installMatchMedia(false);
    const observer = new MutationObserver(() => undefined);
    observer.observe(document.documentElement, { attributes: true });
    const { rerender } = render(<AppearanceHarness colorMode="system" />);
    observer.takeRecords();

    rerender(<AppearanceHarness colorMode="light" />);

    const changedAttributes = observer
      .takeRecords()
      .map((record) => record.attributeName)
      .filter((attribute): attribute is string => attribute !== null);
    expect(changedAttributes).toContain('data-color-mode');
    expect(changedAttributes).not.toContain('data-theme');
    expect(changedAttributes).not.toContain('style');
    observer.disconnect();
  });
});
