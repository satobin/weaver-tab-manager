import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { dismissTransientSurfacesForCommandPalette } from '../../ui/transientSurface';
import { MergeSavedWindowsDialog } from './MergeSavedWindowsDialog';
import { MoveSavedTabsDialog } from './MoveSavedTabsDialog';
import { type SavedWindow } from './savedWindowModel';

const windows: SavedWindow[] = [
  {
    createdAt: '2026-08-16T12:00:00.000Z',
    groups: [],
    id: 'saved-1',
    name: 'Research',
    tabs: [
      {
        active: true,
        order: 0,
        pinned: false,
        title: 'Plan',
        url: 'https://example.com/plan',
      },
    ],
    updatedAt: '2026-08-16T12:00:00.000Z',
  },
];

describe('Saved Windows command-palette handoff', () => {
  it('dismisses the merge dialog without restoring toolbar focus', () => {
    const onClose = vi.fn();
    render(
      <MergeSavedWindowsDialog
        disabled={false}
        horizontalOffset={0}
        name=""
        onApply={vi.fn()}
        onClose={onClose}
        onNameChange={vi.fn()}
        onSetAllWindows={vi.fn()}
        onToggleWindow={vi.fn()}
        selectedWindowIds={new Set()}
        windows={windows}
      />,
    );

    expect(dismissTransientSurfacesForCommandPalette()).toBe(true);
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('dismisses an idle move dialog but keeps an in-progress move blocking', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <MoveSavedTabsDialog
        errorMessage={null}
        moving={false}
        name="New window"
        onClose={onClose}
        onMove={vi.fn()}
        onNameChange={vi.fn()}
        selectionChanged={false}
        tabCount={1}
      />,
    );

    expect(dismissTransientSurfacesForCommandPalette()).toBe(true);
    expect(onClose).toHaveBeenCalledWith(false);
    onClose.mockClear();

    rerender(
      <MoveSavedTabsDialog
        errorMessage={null}
        moving
        name="New window"
        onClose={onClose}
        onMove={vi.fn()}
        onNameChange={vi.fn()}
        selectionChanged={false}
        tabCount={1}
      />,
    );

    expect(dismissTransientSurfacesForCommandPalette()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});
