import { ListChecks, ListX, Merge, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { type ManagedWindow } from './model';

interface MergeWindowsDialogProps {
  disabled: boolean;
  horizontalOffset: number;
  onApply: () => void;
  onClose: (restoreFocus?: boolean) => void;
  onSetAllWindows: (selected: boolean) => void;
  onToggleWindow: (windowId: number, selected: boolean) => void;
  selectedWindowIds: ReadonlySet<number>;
  windows: readonly ManagedWindow[];
}

function getMainTabTitle(window: ManagedWindow): string {
  const tab = window.tabs.find((candidate) => candidate.active) ?? window.tabs[0];
  return tab?.title.trim() || 'Untitled tab';
}

export function MergeWindowsDialog({
  disabled,
  horizontalOffset,
  onApply,
  onClose,
  onSetAllWindows,
  onToggleWindow,
  selectedWindowIds,
  windows,
}: MergeWindowsDialogProps) {
  const firstWindowCheckboxRef = useRef<HTMLInputElement>(null);
  const allWindowsSelected =
    windows.length > 0 && windows.every((window) => selectedWindowIds.has(window.id));

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
    <div
      id="merge-windows-dialog"
      className="merge-dialog"
      role="dialog"
      aria-labelledby="merge-dialog-title"
      style={{ left: horizontalOffset }}
      onBlur={(event) => {
        const nextFocusedNode = event.relatedTarget;
        if (nextFocusedNode instanceof Node && !event.currentTarget.contains(nextFocusedNode)) {
          onClose(false);
        }
      }}
    >
      <header>
        <div>
          <h3 id="merge-dialog-title">Merge windows</h3>
          <span>{selectedWindowIds.size} selected</span>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close merge windows"
          title="Close"
          onClick={() => onClose()}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <div className="merge-window-list">
        {windows.map((window, index) => {
          const selected = selectedWindowIds.has(window.id);
          const mainTabTitle = getMainTabTitle(window);
          return (
            <label className={selected ? 'is-selected' : undefined} key={window.id}>
              <input
                ref={index === 0 ? firstWindowCheckboxRef : null}
                type="checkbox"
                checked={selected}
                disabled={disabled}
                onChange={(event) => onToggleWindow(window.id, event.target.checked)}
              />
              <span className="merge-window-copy">
                <span>{window.label}</span>
                <small title={mainTabTitle}>{mainTabTitle}</small>
              </span>
              <small>{`${window.tabs.length} ${window.tabs.length === 1 ? 'tab' : 'tabs'}`}</small>
            </label>
          );
        })}
      </div>

      <footer>
        <button
          className="merge-select-all-button"
          type="button"
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
          type="button"
          disabled={disabled || selectedWindowIds.size < 2}
          onClick={onApply}
        >
          <Merge aria-hidden="true" size={16} />
          <span>
            {selectedWindowIds.size < 2
              ? 'Merge windows'
              : `Merge ${selectedWindowIds.size} windows`}
          </span>
        </button>
      </footer>
    </div>
  );
}
