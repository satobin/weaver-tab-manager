import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  dismissTransientSurfacesForCommandPalette,
  useDismissOnCommandPaletteOpen,
} from './transientSurface';

function RegisteredDialog({
  enabled = true,
  onDismiss,
}: {
  enabled?: boolean;
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDismissOnCommandPaletteOpen(dialogRef, onDismiss, enabled);
  return <div ref={dialogRef} role="dialog" aria-label="Registered dialog" />;
}

describe('command palette transient-surface handoff', () => {
  it('dismisses registered Weaver surfaces', () => {
    const onDismiss = vi.fn();
    render(<RegisteredDialog onDismiss={onDismiss} />);

    act(() => expect(dismissTransientSurfacesForCommandPalette()).toBe(true));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('keeps unknown and temporarily protected surfaces blocking', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<div role="dialog" aria-label="Unknown dialog" />);

    expect(dismissTransientSurfacesForCommandPalette()).toBe(false);

    rerender(<RegisteredDialog enabled={false} onDismiss={onDismiss} />);
    expect(dismissTransientSurfacesForCommandPalette()).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
