import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { dismissTransientSurfacesForCommandPalette } from '../../ui/transientSurface';
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
  sourceWindowClose: null,
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

  it('hands off to the command palette only while no save is in progress', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    let resolveSave: ((value: SaveWindowResult) => void) | undefined;
    render(
      <SaveWindowDialog
        onClose={onClose}
        onComplete={vi.fn()}
        onSave={vi.fn(
          () =>
            new Promise<SaveWindowResult>((resolve) => {
              resolveSave = resolve;
            }),
        )}
        tabCount={4}
        windowLabel="Current Window"
      />,
    );

    expect(dismissTransientSurfacesForCommandPalette()).toBe(true);
    expect(onClose).toHaveBeenCalledWith(false);
    onClose.mockClear();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Project work');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(dismissTransientSurfacesForCommandPalette()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave?.(result);
      await Promise.resolve();
    });
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
    const saveAndCloseButton = screen.getByRole('button', { name: 'Save & close' });
    const closeButton = screen.getByRole('button', { name: 'Close save window' });
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    expect(cancelButton).toHaveAttribute('title', 'Cancel saving this window');
    expect(saveAndCloseButton).toHaveAttribute('title', 'Save this window and close it');
    expect(saveAndCloseButton).toHaveClass('primary-button');
    expect(saveAndCloseButton.querySelector('svg')).toHaveClass('lucide-panel-top-close');
    expect(saveButton).toHaveClass('save-window-secondary-button');
    expect(saveButton).not.toHaveClass('primary-button');
    expect(saveButton).toHaveAttribute('title', 'Save this window');
    const footer = saveButton.closest('footer');
    expect(footer).not.toBeNull();
    expect(within(footer as HTMLElement).getAllByRole('button')).toEqual([
      cancelButton,
      saveButton,
      saveAndCloseButton,
    ]);
    saveAndCloseButton.focus();
    await user.tab();
    expect(closeButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(saveAndCloseButton).toHaveFocus();
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

  it('uses Save & close as the Enter-key default', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(() => Promise.resolve(result));
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

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Project work{Enter}');

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('Project work', true);
    expect(onComplete).toHaveBeenCalledWith(result);
  });
});
