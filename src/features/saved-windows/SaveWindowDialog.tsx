import { Save, X, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { type SaveWindowResult } from './savedWindowsService';

interface SaveWindowDialogProps {
  onClose: () => void;
  onComplete: (result: SaveWindowResult) => void;
  onSave: (name: string, closeSource: boolean) => Promise<SaveWindowResult>;
  tabCount: number;
  windowLabel: string;
}

function describeSaveError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Chrome could not save this window.';
}

export function SaveWindowDialog({
  onClose,
  onComplete,
  onSave,
  tabCount,
  windowLabel,
}: SaveWindowDialogProps) {
  const [name, setName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState<'save' | 'save-close' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const save = async (closeSource: boolean) => {
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSavingAction(closeSource ? 'save-close' : 'save');
    setErrorMessage(null);
    try {
      const result = await onSave(name, closeSource);
      onComplete(result);
    } catch (error) {
      setErrorMessage(describeSaveError(error));
    } finally {
      savingRef.current = false;
      setSavingAction(null);
    }
  };

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className="save-window-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-window-dialog-title"
        aria-describedby="save-window-dialog-summary"
        tabIndex={-1}
      >
        <header>
          <div>
            <h3 id="save-window-dialog-title">Save window</h3>
            <span id="save-window-dialog-summary">
              {windowLabel} · {tabCount} {tabCount === 1 ? 'tab' : 'tabs'}
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close save window"
            title="Close"
            disabled={savingAction !== null}
            onClick={onClose}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <label className="save-window-name">
            <span>Name</span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              maxLength={120}
              autoComplete="off"
              disabled={savingAction !== null}
              placeholder="Window name"
              onChange={(event) => setName(event.target.value)}
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
              disabled={savingAction !== null}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="toolbar-button"
              type="button"
              disabled={savingAction !== null}
              onClick={() => void save(true)}
            >
              <XCircle aria-hidden="true" size={16} />
              <span>{savingAction === 'save-close' ? 'Saving...' : 'Save & close'}</span>
            </button>
            <button
              className="toolbar-button primary-button"
              type="submit"
              disabled={savingAction !== null}
            >
              <Save aria-hidden="true" size={16} />
              <span>{savingAction === 'save' ? 'Saving...' : 'Save'}</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
