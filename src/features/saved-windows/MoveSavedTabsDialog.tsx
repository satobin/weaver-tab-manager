import { Archive, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useDismissOnCommandPaletteOpen } from '../../ui/transientSurface';

interface MoveSavedTabsDialogProps {
  errorMessage: string | null;
  moving: boolean;
  name: string;
  onClose: (restoreFocus?: boolean) => void;
  onMove: (name: string) => void;
  onNameChange: (name: string) => void;
  selectionChanged: boolean;
  tabCount: number;
}

function pluralize(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function MoveSavedTabsDialog({
  errorMessage,
  moving,
  name,
  onClose,
  onMove,
  onNameChange,
  selectionChanged,
  tabCount,
}: MoveSavedTabsDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const moveDisabled = moving || selectionChanged || tabCount === 0 || !name.trim();
  const moveRequirement = selectionChanged
    ? 'The selected saved tabs changed. Review the selection and try again.'
    : tabCount === 0
      ? 'Select at least one saved tab to move.'
      : !name.trim()
        ? 'Enter a name for the new saved window.'
        : null;

  useDismissOnCommandPaletteOpen(dialogRef, () => onClose(false), !moving);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !moving) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [moving, onClose]);

  useEffect(() => {
    if (errorMessage) {
      inputRef.current?.focus();
    }
  }, [errorMessage]);

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        id="move-saved-tabs-dialog"
        className="save-window-dialog move-saved-tabs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-saved-tabs-dialog-title"
        aria-describedby="move-saved-tabs-dialog-summary"
        tabIndex={-1}
      >
        <header>
          <div>
            <h3 id="move-saved-tabs-dialog-title">Move to new saved window</h3>
            <span id="move-saved-tabs-dialog-summary">
              {pluralize(tabCount, 'selected tab')} will move from their current saved windows.
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close move to new saved window"
            title="Close"
            disabled={moving}
            onClick={() => onClose()}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!moveDisabled) {
              onMove(name);
            }
          }}
        >
          <label className="save-window-name">
            <span>New saved window name</span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              maxLength={120}
              autoComplete="off"
              required
              disabled={moving}
              placeholder="Window name"
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>

          {errorMessage ? (
            <div className="dialog-error" role="alert">
              {errorMessage}
            </div>
          ) : null}

          <footer>
            <button
              className="toolbar-button"
              type="button"
              disabled={moving}
              onClick={() => onClose()}
            >
              Cancel
            </button>
            <button
              className="toolbar-button primary-button move-saved-tabs-submit"
              type="submit"
              aria-disabled={moveDisabled}
              aria-describedby={moveRequirement ? 'move-saved-tabs-requirement' : undefined}
              aria-busy={moving || undefined}
              data-tooltip={moveRequirement ?? undefined}
              onClick={(event) => {
                if (moveDisabled) {
                  event.preventDefault();
                }
              }}
            >
              <Archive aria-hidden="true" size={16} />
              <span>{moving ? `Moving ${tabCount}...` : `Move ${pluralize(tabCount, 'tab')}`}</span>
            </button>
            {moveRequirement ? (
              <span id="move-saved-tabs-requirement" className="sr-only">
                {moveRequirement}
              </span>
            ) : null}
          </footer>
        </form>
      </section>
    </div>
  );
}
