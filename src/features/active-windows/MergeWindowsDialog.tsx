import { ListChecks, ListX, Merge, X } from 'lucide-react';
import { useEffect } from 'react';

import { AnchoredSelectMenu, type AnchoredSelectOption } from '../../ui/AnchoredSelectMenu';
import { type ManagedWindow } from './model';

interface MergeWindowsDialogProps {
  destinationWindowId: number;
  disabled: boolean;
  horizontalOffset: number;
  onApply: () => void;
  onChangeDestination: (windowId: number) => void;
  onClose: () => void;
  onSetAllSources: (selected: boolean) => void;
  onToggleSource: (windowId: number, selected: boolean) => void;
  sourceWindowIds: ReadonlySet<number>;
  windows: readonly ManagedWindow[];
}

function getMainTabTitle(window: ManagedWindow): string {
  const tab = window.tabs.find((candidate) => candidate.active) ?? window.tabs[0];
  return tab?.title.trim() || 'Untitled tab';
}

export function MergeWindowsDialog({
  destinationWindowId,
  disabled,
  horizontalOffset,
  onApply,
  onChangeDestination,
  onClose,
  onSetAllSources,
  onToggleSource,
  sourceWindowIds,
  windows,
}: MergeWindowsDialogProps) {
  const sourceWindows = windows.filter((window) => window.id !== destinationWindowId);
  const destinationOptions: readonly AnchoredSelectOption<number>[] = windows.map((window) => ({
    description: getMainTabTitle(window),
    label: window.label,
    secondary: `${window.tabs.length} ${window.tabs.length === 1 ? 'tab' : 'tabs'}`,
    triggerLabel: `${window.label} (${window.tabs.length})`,
    value: window.id,
  }));
  const allSourcesSelected =
    sourceWindows.length > 0 && sourceWindows.every((window) => sourceWindowIds.has(window.id));

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.merge-destination-popover')) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="merge-dialog"
      role="dialog"
      aria-labelledby="merge-dialog-title"
      style={{ left: horizontalOffset }}
    >
      <header>
        <div>
          <h3 id="merge-dialog-title">Merge windows</h3>
          <span>{sourceWindowIds.size + 1} selected</span>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close merge windows"
          title="Close"
          onClick={onClose}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <div className="merge-destination">
        <span className="merge-section-label">Destination</span>
        <AnchoredSelectMenu
          ariaLabel="Destination"
          disabled={disabled}
          focusOnMount
          minimumWidth={180}
          onChange={onChangeDestination}
          options={destinationOptions}
          popoverClassName="merge-destination-popover"
          triggerClassName="merge-destination-trigger"
          value={destinationWindowId}
        />
      </div>

      <div className="merge-source-heading">
        <span className="merge-section-label">Move into destination</span>
      </div>

      <div className="merge-source-list">
        {sourceWindows.map((window) => {
          const selected = sourceWindowIds.has(window.id);
          const mainTabTitle = getMainTabTitle(window);
          return (
            <label className={selected ? 'is-selected' : undefined} key={window.id}>
              <input
                type="checkbox"
                checked={selected}
                disabled={disabled}
                onChange={(event) => onToggleSource(window.id, event.target.checked)}
              />
              <span className="merge-source-copy">
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
          disabled={disabled || sourceWindows.length === 0}
          onClick={() => onSetAllSources(!allSourcesSelected)}
        >
          {allSourcesSelected ? (
            <ListX aria-hidden="true" size={15} />
          ) : (
            <ListChecks aria-hidden="true" size={15} />
          )}
          <span>{allSourcesSelected ? 'Clear all' : 'Select all'}</span>
        </button>
        <button
          className="toolbar-button merge-apply-button"
          type="button"
          disabled={disabled || sourceWindowIds.size === 0}
          onClick={onApply}
        >
          <Merge aria-hidden="true" size={16} />
          <span>Merge {sourceWindowIds.size + 1} windows</span>
        </button>
      </footer>
    </div>
  );
}
