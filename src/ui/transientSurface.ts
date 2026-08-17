import { type RefObject, useEffect } from 'react';

const COMMAND_PALETTE_DISMISS_EVENT = 'weaver:command-palette-dismiss-transient-surface';
const DISMISSIBLE_ATTRIBUTE = 'data-command-palette-dismissible';
const DISMISSIBLE_SELECTOR = `[${DISMISSIBLE_ATTRIBUTE}="true"]`;
const BLOCKING_SURFACE_SELECTOR = '[role="dialog"], [role="menu"], [aria-modal="true"]';

export function useDismissOnCommandPaletteOpen<T extends HTMLElement>(
  surfaceRef: RefObject<T | null>,
  onDismiss: () => void,
  enabled = true,
): void {
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!enabled || !surface) {
      return;
    }

    const handleDismiss = () => onDismiss();
    surface.setAttribute(DISMISSIBLE_ATTRIBUTE, 'true');
    surface.addEventListener(COMMAND_PALETTE_DISMISS_EVENT, handleDismiss);
    return () => {
      surface.removeEventListener(COMMAND_PALETTE_DISMISS_EVENT, handleDismiss);
      surface.removeAttribute(DISMISSIBLE_ATTRIBUTE);
    };
  }, [enabled, onDismiss, surfaceRef]);
}

export function dismissTransientSurfacesForCommandPalette(): boolean {
  const blockingSurfaces = document.querySelectorAll<HTMLElement>(BLOCKING_SURFACE_SELECTOR);
  const hasUnknownBlockingSurface = [...blockingSurfaces].some(
    (surface) => !surface.closest(DISMISSIBLE_SELECTOR),
  );
  if (hasUnknownBlockingSurface) {
    return false;
  }

  document.querySelectorAll<HTMLElement>(DISMISSIBLE_SELECTOR).forEach((surface) => {
    surface.dispatchEvent(new Event(COMMAND_PALETTE_DISMISS_EVENT));
  });
  return true;
}
