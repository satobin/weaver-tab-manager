import { ListChecks, ListX, Merge, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { type SavedWindow } from './savedWindowModel';

interface MergeSavedWindowsDialogProps {
  disabled: boolean;
  horizontalOffset: number;
  name: string;
  onApply: (name: string) => void;
  onClose: (restoreFocus?: boolean) => void;
  onNameChange: (name: string) => void;
  onSetAllWindows: (selected: boolean) => void;
  onToggleWindow: (savedWindowId: string, selected: boolean) => void;
  selectedWindowIds: ReadonlySet<string>;
  windows: readonly SavedWindow[];
}

function formatSavedTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function getMainTabTitle(savedWindow: SavedWindow): string {
  const tab = savedWindow.tabs.find((candidate) => candidate.active) ?? savedWindow.tabs[0];
  return tab?.title.trim() || tab?.url || 'Untitled tab';
}

export function MergeSavedWindowsDialog({
  disabled,
  horizontalOffset,
  name,
  onApply,
  onClose,
  onNameChange,
  onSetAllWindows,
  onToggleWindow,
  selectedWindowIds,
  windows,
}: MergeSavedWindowsDialogProps) {
  const firstWindowCheckboxRef = useRef<HTMLInputElement>(null);
  const allWindowsSelected =
    windows.length > 0 && windows.every((window) => selectedWindowIds.has(window.id));
  const mergeDisabled = disabled || selectedWindowIds.size < 2 || !name.trim();
  const mergeTitle = disabled
    ? 'A Saved Windows action is in progress.'
    : selectedWindowIds.size < 2 && !name.trim()
      ? 'Select at least two windows and enter a name to merge.'
      : selectedWindowIds.size < 2
        ? 'Select at least two windows to merge.'
        : !name.trim()
          ? 'Enter a name for the merged window.'
          : 'Merge selected saved windows';

  useEffect(() => {
    firstWindowCheckboxRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <form
      id="merge-saved-windows-dialog"
      className="merge-dialog"
      role="dialog"
      aria-labelledby="merge-saved-dialog-title"
      style={{ left: horizontalOffset }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!mergeDisabled) {
          onApply(name);
        }
      }}
      onBlur={(event) => {
        const nextFocusedNode = event.relatedTarget;
        if (nextFocusedNode instanceof Node && !event.currentTarget.contains(nextFocusedNode)) {
          onClose(false);
        }
      }}
    >
      <header>
        <div>
          <h3 id="merge-saved-dialog-title">Merge saved windows</h3>
          <span>{selectedWindowIds.size} selected</span>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close merge saved windows"
          title="Close"
          onClick={() => onClose()}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <p id="merge-saved-window-instructions" className="merge-dialog-instructions">
        Choose at least two windows, then name the merged window.
      </p>

      <div className="merge-window-list">
        {windows.map((savedWindow, index) => {
          const selected = selectedWindowIds.has(savedWindow.id);
          const mainTabTitle = getMainTabTitle(savedWindow);
          return (
            <label className={selected ? 'is-selected' : undefined} key={savedWindow.id}>
              <input
                ref={index === 0 ? firstWindowCheckboxRef : null}
                type="checkbox"
                checked={selected}
                disabled={disabled}
                onChange={(event) => onToggleWindow(savedWindow.id, event.target.checked)}
              />
              <span className="merge-window-copy">
                <span>
                  <span className="merge-window-name">{savedWindow.name}</span>
                </span>
                <small title={`${mainTabTitle} · Saved ${savedWindow.createdAt}`}>
                  {mainTabTitle} · Saved {formatSavedTime(savedWindow.createdAt)}
                </small>
              </span>
              <small>{`${savedWindow.tabs.length} ${savedWindow.tabs.length === 1 ? 'tab' : 'tabs'}`}</small>
            </label>
          );
        })}
      </div>

      <div className="merge-dialog-actions">
        <label className="merge-saved-window-name">
          <span>New saved window name</span>
          <input
            type="text"
            aria-describedby="merge-saved-window-instructions"
            autoComplete="off"
            maxLength={120}
            placeholder="Merged window name"
            required
            value={name}
            disabled={disabled}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </label>

        <footer>
          <button
            className="merge-select-all-button"
            type="button"
            title={allWindowsSelected ? 'Clear saved-window selection' : 'Select all saved windows'}
            disabled={disabled || windows.length === 0}
            onClick={() => onSetAllWindows(!allWindowsSelected)}
          >
            {allWindowsSelected ? (
              <ListX aria-hidden="true" size={15} />
            ) : (
              <ListChecks aria-hidden="true" size={15} />
            )}
            <span>{allWindowsSelected ? 'Clear all' : 'Select all'}</span>
          </button>
          <button
            className="toolbar-button merge-apply-button"
            type="submit"
            aria-disabled={mergeDisabled}
            aria-describedby={mergeDisabled ? 'merge-saved-window-requirement' : undefined}
            data-tooltip={mergeDisabled ? mergeTitle : undefined}
            title={mergeDisabled ? undefined : mergeTitle}
            onClick={(event) => {
              if (mergeDisabled) {
                event.preventDefault();
              }
            }}
          >
            <Merge aria-hidden="true" size={16} />
            <span>
              {selectedWindowIds.size < 2
                ? 'Merge saved windows'
                : `Merge ${selectedWindowIds.size} saved windows`}
            </span>
          </button>
          {mergeDisabled ? (
            <span id="merge-saved-window-requirement" className="sr-only">
              {mergeTitle}
            </span>
          ) : null}
        </footer>
      </div>
    </form>
  );
}
