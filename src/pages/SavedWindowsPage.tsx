import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Pencil,
  Pin,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { formatTabLocation } from '../features/active-windows/model';
import { type SavedWindow } from '../features/saved-windows/savedWindowModel';
import {
  createSavedWindowsService,
  type RestoreSavedWindowResult,
  type SavedWindowsService,
} from '../features/saved-windows/savedWindowsService';
import { useSavedWindows } from '../features/saved-windows/useSavedWindows';
import { EmptyState } from '../ui/EmptyState';

interface SavedWindowsPageProps {
  headerPortalTarget?: Element | null;
  service?: SavedWindowsService | undefined;
}

type SavedWindowOperation = 'delete' | 'keep' | 'rename' | 'restore';

interface SavedWindowNotice {
  keepSavedWindow?: SavedWindow;
  message: string;
}

function pluralize(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function describeActionError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'The browser could not complete that saved-window action.';
}

function formatSavedTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function summarizeRestore(savedWindow: SavedWindow, result: RestoreSavedWindowResult) {
  const parts = [
    `Restored ${pluralize(result.restoredTabCount, 'tab')} from "${savedWindow.name}".`,
  ];
  if (result.suspendedTabCount > 0) {
    parts.push(`${pluralize(result.suspendedTabCount, 'background tab')} suspended.`);
  }
  if (result.savedWindowRemoved) {
    parts.push('Removed it from Saved Windows.');
  }
  if (result.failures.length > 0) {
    parts.push(
      `${pluralize(result.failures.length, 'tab')} failed. ${result.failures[0]?.message ?? ''}`.trim(),
    );
  }
  if (result.warnings.length > 0) {
    parts.push(result.warnings.join(' '));
  }
  return parts.join(' ');
}

function SavedWindowPreview({
  disabled,
  onOpenTab,
  savedWindow,
}: {
  disabled: boolean;
  onOpenTab: (url: string) => void;
  savedWindow: SavedWindow;
}) {
  const groupsByKey = new Map(savedWindow.groups.map((group) => [group.key, group]));

  return (
    <ul className="saved-tab-list">
      {savedWindow.tabs.map((tab, index) => {
        const group = tab.groupKey ? groupsByKey.get(tab.groupKey) : undefined;
        const beginsGroup = group && savedWindow.tabs[index - 1]?.groupKey !== group.key;
        return (
          <Fragment key={`${tab.order}-${tab.url}`}>
            {beginsGroup ? (
              <li className="saved-group-heading">
                <span
                  className={`saved-group-color group-color-${group.color}`}
                  aria-hidden="true"
                />
                <span>{group.title || 'Untitled group'}</span>
                {group.collapsed ? <small>Collapsed</small> : null}
              </li>
            ) : null}
            <li className="saved-tab-row">
              <span className="saved-tab-order">{tab.order + 1}</span>
              <button
                className="saved-tab-open-button"
                type="button"
                aria-label={`Open ${tab.title} in a new tab`}
                title="Open in a new tab"
                disabled={disabled}
                onClick={() => onOpenTab(tab.url)}
              >
                <span className="saved-tab-copy">
                  <strong>{tab.title}</strong>
                  <span>{formatTabLocation(tab.url)}</span>
                </span>
                <span className="saved-tab-meta">
                  {tab.pinned ? <Pin aria-label="Pinned" size={13} /> : null}
                  <ExternalLink aria-hidden="true" size={14} />
                </span>
              </button>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}

export function SavedWindowsPage({
  headerPortalTarget,
  service: providedService,
}: SavedWindowsPageProps) {
  const service = useMemo(() => providedService ?? createSavedWindowsService(), [providedService]);
  const { cleanupNotice, dismissCleanupNotice, errorMessage, refresh, status, windows } =
    useSavedWindows(service);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<SavedWindowNotice | null>(null);
  const [operation, setOperation] = useState<{
    id: string;
    type: SavedWindowOperation;
  } | null>(null);
  const operationRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
    }
  }, [renamingId]);

  const beginOperation = (id: string, type: SavedWindowOperation) => {
    if (operationRef.current) {
      return false;
    }
    operationRef.current = true;
    setOperation({ id, type });
    setActionError(null);
    setActionNotice(null);
    return true;
  };

  const finishOperation = () => {
    operationRef.current = false;
    setOperation(null);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const startRename = (savedWindow: SavedWindow) => {
    setDeletingId(null);
    setRenamingId(savedWindow.id);
    setRenameValue(savedWindow.name);
    setActionError(null);
  };

  const renameWindow = async (savedWindow: SavedWindow) => {
    if (!beginOperation(savedWindow.id, 'rename')) {
      return;
    }
    try {
      const renamed = await service.renameWindow(savedWindow.id, renameValue);
      setRenamingId(null);
      setActionNotice({ message: `Renamed saved window to "${renamed.name}".` });
      await refresh();
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      finishOperation();
    }
  };

  const deleteWindow = async (savedWindow: SavedWindow) => {
    if (!beginOperation(savedWindow.id, 'delete')) {
      return;
    }
    try {
      await service.deleteWindow(savedWindow.id);
      setDeletingId(null);
      setRenamingId(null);
      setActionNotice({ message: `Deleted "${savedWindow.name}".` });
      await refresh();
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      finishOperation();
    }
  };

  const openSavedTab = async (url: string) => {
    setActionError(null);
    setActionNotice(null);
    try {
      await service.openTab(url);
    } catch (error) {
      setActionError(describeActionError(error));
    }
  };

  const restoreWindow = async (savedWindow: SavedWindow) => {
    if (!beginOperation(savedWindow.id, 'restore')) {
      return;
    }
    try {
      const result = await service.restoreWindow(savedWindow.id);
      if (result.savedWindowRemoved) {
        setExpandedIds((current) => {
          const next = new Set(current);
          next.delete(savedWindow.id);
          return next;
        });
        setRenamingId((current) => (current === savedWindow.id ? null : current));
        setDeletingId((current) => (current === savedWindow.id ? null : current));
      }
      await refresh();
      const summary = summarizeRestore(savedWindow, result);
      if (result.failures.length > 0) {
        setActionError(summary);
      } else {
        setActionNotice(
          result.savedWindowRemoved
            ? { keepSavedWindow: savedWindow, message: summary }
            : result.warnings.length > 0
              ? null
              : { message: summary },
        );
        if (!result.savedWindowRemoved && result.warnings.length > 0) {
          setActionError(summary);
        }
      }
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      finishOperation();
    }
  };

  const keepRestoredWindow = async () => {
    const notice = actionNotice;
    const savedWindow = notice?.keepSavedWindow;
    if (!notice || !savedWindow || !beginOperation(savedWindow.id, 'keep')) {
      return;
    }
    try {
      await service.keepWindow(savedWindow);
      await refresh();
      setActionNotice({ message: `Kept "${savedWindow.name}" in Saved Windows.` });
    } catch (error) {
      setActionError(describeActionError(error));
      setActionNotice(notice);
    } finally {
      finishOperation();
    }
  };
  const savedTabCount = windows.reduce((total, savedWindow) => total + savedWindow.tabs.length, 0);
  const totalSummary =
    status === 'loading'
      ? 'Loading saved windows'
      : `${pluralize(windows.length, 'saved window')} · ${pluralize(savedTabCount, 'tab')}`;
  const compactTotalSummary =
    status === 'loading' ? 'Loading' : `${windows.length}s · ${savedTabCount}t`;
  const headerStatus = (
    <div className="saved-window-header-status">
      <span className="window-summary" aria-live="polite">
        <span className="window-summary-full">{totalSummary}</span>
        <span className="window-summary-compact">{compactTotalSummary}</span>
      </span>
    </div>
  );

  return (
    <section className="page-section saved-windows-page" aria-labelledby="saved-windows-heading">
      {headerPortalTarget ? createPortal(headerStatus, headerPortalTarget) : null}
      {headerPortalTarget === undefined ? headerStatus : null}

      <h2 id="saved-windows-heading" className="sr-only">
        Saved browser windows
      </h2>

      {errorMessage && status === 'ready' ? (
        <div className="inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>Saved windows refresh failed: {errorMessage}</span>
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : null}

      {cleanupNotice ? (
        <div className="inline-alert" role="status">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>{cleanupNotice}</span>
          <button type="button" onClick={() => void dismissCleanupNotice()}>
            Dismiss
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div className="inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {actionNotice ? (
        <div className="inline-notice" role="status">
          <span>{actionNotice.message}</span>
          <div className="inline-notice-actions">
            {actionNotice.keepSavedWindow ? (
              <button
                className="notice-undo-button"
                type="button"
                onClick={() => void keepRestoredWindow()}
              >
                Keep saved
              </button>
            ) : null}
            <button type="button" onClick={() => setActionNotice(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {status === 'loading' ? (
        <div className="saved-window-list saved-window-list-loading" aria-hidden="true">
          {[0, 1, 2].map((item) => (
            <div className="saved-window-skeleton" key={item} />
          ))}
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="load-error" role="alert">
          <AlertTriangle aria-hidden="true" size={24} />
          <h3>Could not load saved windows</h3>
          <p>{errorMessage}</p>
          <button type="button" onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" size={16} />
            Retry
          </button>
        </div>
      ) : null}

      {status === 'ready' && windows.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="No saved windows"
          description="Save a window from Active Windows to keep its tabs for later."
        />
      ) : null}

      {status === 'ready' && windows.length > 0 ? (
        <div className="saved-window-list">
          {windows.map((savedWindow) => {
            const expanded = expandedIds.has(savedWindow.id);
            const isRenaming = renamingId === savedWindow.id;
            const isDeleting = deletingId === savedWindow.id;
            const currentOperation = operation?.id === savedWindow.id ? operation.type : null;
            const disabled = operation !== null;

            return (
              <article className="saved-window-card" key={savedWindow.id}>
                <header>
                  <button
                    className="saved-window-expand"
                    type="button"
                    aria-label={`${expanded ? 'Hide' : 'Show'} preview for ${savedWindow.name}`}
                    aria-expanded={expanded}
                    aria-controls={`saved-window-${savedWindow.id}-preview`}
                    onClick={() => toggleExpanded(savedWindow.id)}
                  >
                    {expanded ? (
                      <ChevronDown aria-hidden="true" size={18} />
                    ) : (
                      <ChevronRight aria-hidden="true" size={18} />
                    )}
                    <span className="saved-window-copy">
                      <strong>{savedWindow.name}</strong>
                      <span>
                        {pluralize(savedWindow.tabs.length, 'tab')} ·{' '}
                        {pluralize(savedWindow.groups.length, 'group')} · Saved{' '}
                        {formatSavedTime(savedWindow.createdAt)}
                      </span>
                    </span>
                  </button>

                  <div className="saved-window-actions">
                    <button
                      className="toolbar-button primary-button"
                      type="button"
                      disabled={disabled}
                      onClick={() => void restoreWindow(savedWindow)}
                    >
                      <ArchiveRestore aria-hidden="true" size={16} />
                      <span>{currentOperation === 'restore' ? 'Restoring...' : 'Restore'}</span>
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Rename ${savedWindow.name}`}
                      title="Rename saved window"
                      disabled={disabled}
                      onClick={() => startRename(savedWindow)}
                    >
                      <Pencil aria-hidden="true" size={16} />
                    </button>
                    <button
                      className="icon-button danger-icon-button"
                      type="button"
                      aria-label={`Delete ${savedWindow.name}`}
                      title="Delete saved window"
                      disabled={disabled}
                      onClick={() => {
                        setRenamingId(null);
                        setDeletingId(savedWindow.id);
                        setActionError(null);
                      }}
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  </div>
                </header>

                {isRenaming ? (
                  <form
                    className="saved-window-inline-action"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void renameWindow(savedWindow);
                    }}
                  >
                    <label>
                      <span className="sr-only">New name for {savedWindow.name}</span>
                      <input
                        ref={renameInputRef}
                        type="text"
                        maxLength={120}
                        value={renameValue}
                        disabled={disabled}
                        onChange={(event) => setRenameValue(event.target.value)}
                      />
                    </label>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Cancel rename"
                      title="Cancel"
                      disabled={disabled}
                      onClick={() => setRenamingId(null)}
                    >
                      <X aria-hidden="true" size={16} />
                    </button>
                    <button
                      className="icon-button primary-icon-button"
                      type="submit"
                      aria-label="Save name"
                      title="Save name"
                      disabled={disabled}
                    >
                      <Save aria-hidden="true" size={16} />
                    </button>
                  </form>
                ) : null}

                {isDeleting ? (
                  <div className="saved-window-delete-confirmation" role="alert">
                    <span>Delete this saved window?</span>
                    <button type="button" disabled={disabled} onClick={() => setDeletingId(null)}>
                      Cancel
                    </button>
                    <button
                      className="danger-confirm-button"
                      type="button"
                      disabled={disabled}
                      onClick={() => void deleteWindow(savedWindow)}
                    >
                      {currentOperation === 'delete' ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                ) : null}

                {expanded ? (
                  <div id={`saved-window-${savedWindow.id}-preview`}>
                    <SavedWindowPreview
                      disabled={disabled}
                      onOpenTab={(url) => void openSavedTab(url)}
                      savedWindow={savedWindow}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
