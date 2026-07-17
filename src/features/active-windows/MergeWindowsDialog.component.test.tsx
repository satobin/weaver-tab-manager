import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MergeWindowsDialog } from './MergeWindowsDialog';
import { type ManagedWindow } from './model';

function makeWindow(id: number): ManagedWindow {
  return {
    focused: id === 1,
    groups: [],
    id,
    isCurrent: id === 1,
    label: `Window ${id}`,
    state: 'normal',
    tabs: [
      {
        active: true,
        discarded: false,
        frozen: false,
        groupId: null,
        iconUrl: null,
        id: id * 10,
        index: 0,
        pinned: false,
        title: `Tab ${id}`,
        unloaded: false,
        url: `https://example.com/${id}`,
        windowId: id,
      },
    ],
  };
}

function renderDialog(
  onClose = vi.fn(),
  onToggleWindow = vi.fn(),
  selectedWindowIds: ReadonlySet<number> = new Set([1, 2]),
) {
  render(
    <>
      <MergeWindowsDialog
        disabled={false}
        horizontalOffset={0}
        onApply={vi.fn()}
        onClose={onClose}
        onSetAllWindows={vi.fn()}
        onToggleWindow={onToggleWindow}
        selectedWindowIds={selectedWindowIds}
        windows={[makeWindow(1), makeWindow(2)]}
      />
      <button type="button">Outside</button>
    </>,
  );

  return { onClose, onToggleWindow };
}

describe('MergeWindowsDialog', () => {
  it('focuses the first window checkbox when opened', () => {
    renderDialog();

    expect(screen.getByRole('dialog', { name: 'Merge windows' })).toHaveAttribute(
      'id',
      'merge-windows-dialog',
    );
    expect(screen.getAllByRole('checkbox')[0]).toHaveFocus();
  });

  it('does not close when focus moves within the dialog', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.tab();

    expect(screen.getAllByRole('checkbox')[1]).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close before a row label can toggle its checkbox', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onToggleWindow = vi.fn();
    renderDialog(onClose, onToggleWindow, new Set([1]));
    const firstCheckbox = screen.getAllByRole('checkbox')[0];

    fireEvent.blur(firstCheckbox as HTMLInputElement, { relatedTarget: null });
    await user.click(screen.getByText('Window 2'));

    expect(onClose).not.toHaveBeenCalled();
    expect(onToggleWindow).toHaveBeenCalledWith(2, true);
  });

  it('closes without restoring focus when focus leaves the dialog', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    const applyButton = screen.getByRole('button', { name: 'Merge 2 windows' });

    applyButton.focus();
    await user.tab();

    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('closes with Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.keyboard('{Escape}');

    expect(onClose.mock.calls).toEqual([[]]);
  });
});
