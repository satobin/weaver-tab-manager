import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SaveWindowDialog } from './SaveWindowDialog';
import { type SaveWindowResult } from './savedWindowsService';

const result: SaveWindowResult = {
  savedWindow: {
    createdAt: '2026-07-10T20:00:00.000Z',
    groups: [],
    id: 'saved-1',
    name: 'Project work',
    tabs: [
      {
        active: true,
        order: 0,
        pinned: false,
        title: 'Plan',
        url: 'https://example.com/',
      },
    ],
    updatedAt: '2026-07-10T20:00:00.000Z',
  },
  sourceWindowClosed: false,
  warnings: [],
};

describe('SaveWindowDialog', () => {
  it('focuses the name and closes with Escape before saving', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SaveWindowDialog
        onClose={onClose}
        onComplete={vi.fn()}
        onSave={vi.fn()}
        tabCount={4}
        windowLabel="Current Window"
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps forward and reverse Tab navigation inside the modal', async () => {
    const user = userEvent.setup();
    render(
      <SaveWindowDialog
        onClose={vi.fn()}
        onComplete={vi.fn()}
        onSave={vi.fn()}
        tabCount={4}
        windowLabel="Current Window"
      />,
    );

    const saveButton = screen.getByRole('button', { name: 'Save' });
    const closeButton = screen.getByRole('button', { name: 'Close save window' });
    saveButton.focus();
    await user.tab();
    expect(closeButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(saveButton).toHaveFocus();
  });

  it('blocks duplicate submission while a save is pending', async () => {
    let resolveSave: ((value: SaveWindowResult) => void) | undefined;
    const onSave = vi.fn(
      () =>
        new Promise<SaveWindowResult>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const onComplete = vi.fn();
    render(
      <SaveWindowDialog
        onClose={vi.fn()}
        onComplete={onComplete}
        onSave={onSave}
        tabCount={4}
        windowLabel="Current Window"
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Project work' },
    });
    const saveButton = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('Project work', false);

    await act(async () => {
      resolveSave?.(result);
      await Promise.resolve();
    });
    expect(onComplete).toHaveBeenCalledWith(result);
  });
});
