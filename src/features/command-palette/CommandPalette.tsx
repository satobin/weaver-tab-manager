import {
  Archive,
  Bot,
  CirclePause,
  Command,
  CopyX,
  Info,
  PanelTop,
  PanelsTopLeft,
  Pin,
  Search,
  Settings,
  X,
} from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { type ActiveWindowsService } from '../active-windows/chromeActiveWindowsService';
import { TabIcon } from '../active-windows/TabIcon';
import { useActiveWindows } from '../active-windows/useActiveWindows';
import { type SavedWindowsService } from '../saved-windows/savedWindowsService';
import { useSavedWindows } from '../saved-windows/useSavedWindows';
import {
  buildCommandPaletteSections,
  type CommandPaletteResult,
  type CommandPaletteSection,
} from './commandPaletteModel';

const DIALOG_ID = 'command-palette-dialog';
const LISTBOX_ID = 'command-palette-results';

interface CommandPaletteProps {
  activeWindowsService: ActiveWindowsService;
  savedWindowsService: SavedWindowsService;
}

interface CommandPaletteDialogProps extends CommandPaletteProps {
  onClose: (restoreFocus: boolean) => void;
}

function isPrimaryShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
) {
  return (
    event.key.toLocaleLowerCase() === 'k' &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

function getModifierLabel(): string {
  return /Mac|iPhone|iPad|iPod/u.test(navigator.platform) ? '⌘' : 'Ctrl';
}

function hasBlockingSurface(): boolean {
  return Boolean(
    document.querySelector(
      `[role="dialog"]:not(#${DIALOG_ID}), [role="menu"], [aria-modal="true"]:not(#${DIALOG_ID})`,
    ),
  );
}

function getOptionId(index: number): string {
  return `command-palette-option-${index}`;
}

function highlightMatch(text: string, rawQuery: string) {
  const query = rawQuery.trim();
  if (!query) {
    return text;
  }
  const matchIndex = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (matchIndex === -1) {
    return text;
  }
  return (
    <>
      {text.slice(0, matchIndex)}
      <mark>{text.slice(matchIndex, matchIndex + query.length)}</mark>
      {text.slice(matchIndex + query.length)}
    </>
  );
}

function ResultIcon({ result }: { result: CommandPaletteResult }) {
  if (result.icon === 'tab') {
    return <TabIcon iconUrl={result.iconUrl ?? null} size={20} />;
  }
  if (result.icon === 'tab-group') {
    return (
      <span className={`command-palette-group-icon group-color-${result.groupColor ?? 'grey'}`}>
        <span className="command-palette-group-dot" aria-hidden="true" />
        <PanelTop aria-hidden="true" size={18} strokeWidth={1.8} />
      </span>
    );
  }
  const Icon =
    result.icon === 'active-windows'
      ? PanelsTopLeft
      : result.icon === 'saved-window'
        ? Archive
        : result.icon === 'settings'
          ? Settings
          : result.icon === 'about'
            ? Info
            : CopyX;
  return <Icon aria-hidden="true" size={20} strokeWidth={1.8} />;
}

function ResultStates({ result, stateId }: { result: CommandPaletteResult; stateId: string }) {
  const descriptions: string[] = [];
  if (result.groupColor) {
    descriptions.push(`${result.groupColor} tab group`);
  }
  if (result.state?.active) {
    descriptions.push('Active tab');
  }
  if (result.state?.agentAssociated) {
    descriptions.push(
      result.state.agentDedupeProtected
        ? 'Agent-associated tab with ongoing or unclear activity'
        : 'Agent-associated tab with completed or idle activity',
    );
  }
  if (result.state?.pinned) {
    descriptions.push('Pinned tab');
  }
  if (result.state?.suspended) {
    descriptions.push('Suspended tab');
  }

  return (
    <>
      <span className="command-palette-result-states" aria-hidden="true">
        {result.state?.active ? (
          <span className="command-palette-state-icon" title="Active tab">
            <span className="command-palette-current-dot" />
          </span>
        ) : null}
        {result.state?.agentAssociated ? (
          <span
            className="command-palette-state-icon"
            title={
              result.state.agentDedupeProtected
                ? 'Agent-associated; kept during duplicate cleanup'
                : 'Agent-associated'
            }
          >
            <Bot className="command-palette-agent-state" size={15} strokeWidth={2} />
          </span>
        ) : null}
        {result.state?.pinned ? (
          <span className="command-palette-state-icon" title="Pinned tab">
            <Pin size={15} strokeWidth={1.9} />
          </span>
        ) : null}
        {result.state?.suspended ? (
          <span className="command-palette-state-icon" title="Suspended tab">
            <CirclePause size={15} strokeWidth={1.9} />
          </span>
        ) : null}
      </span>
      {descriptions.length > 0 ? (
        <span className="sr-only" id={stateId}>
          {descriptions.join('. ')}.
        </span>
      ) : null}
    </>
  );
}

function CommandPaletteDialog({
  activeWindowsService,
  onClose,
  savedWindowsService,
}: CommandPaletteDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [busyResultId, setBusyResultId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const activeWindows = useActiveWindows(activeWindowsService);
  const savedWindows = useSavedWindows(savedWindowsService);
  const sections = useMemo(
    () =>
      buildCommandPaletteSections({
        activeSnapshot: activeWindows.snapshot,
        query,
        savedWindows: savedWindows.windows,
      }),
    [activeWindows.snapshot, query, savedWindows.windows],
  );
  const results = useMemo(() => sections.flatMap((section) => section.results), [sections]);
  const modifierLabel = getModifierLabel();
  const resolvedActiveIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));
  const activeOptionId = results.length > 0 ? getOptionId(resolvedActiveIndex) : undefined;

  useEffect(() => {
    inputRef.current?.focus();
    const appShell = document.querySelector<HTMLElement>('.app-shell');
    const previousInert = appShell?.inert ?? false;
    const previousAriaHidden = appShell?.getAttribute('aria-hidden') ?? null;
    const previousOverflow = document.body.style.overflow;
    if (appShell) {
      appShell.inert = true;
      appShell.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = 'hidden';
    return () => {
      if (appShell) {
        appShell.inert = previousInert;
        if (previousAriaHidden === null) {
          appShell.removeAttribute('aria-hidden');
        } else {
          appShell.setAttribute('aria-hidden', previousAriaHidden);
        }
      }
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) {
      return;
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (event.target === backdrop) {
        onClose(true);
      }
    };
    backdrop.addEventListener('mousedown', handleMouseDown);
    return () => backdrop.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  useEffect(() => {
    if (!activeOptionId) {
      return;
    }
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionId]);

  const activateResult = async (result: CommandPaletteResult) => {
    if (busyResultId) {
      return;
    }
    setActionError(null);
    if (result.action.type === 'navigate') {
      onClose(false);
      window.location.assign(result.action.hash);
      return;
    }

    setBusyResultId(result.id);
    try {
      if (result.action.type === 'focus-active-tab') {
        await activeWindowsService.focusTab(result.action.windowId, result.action.tabId);
      } else {
        await savedWindowsService.openTab({
          pinned: result.action.pinned,
          url: result.action.url,
        });
      }
      onClose(false);
    } catch (error) {
      setActionError(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Weaver could not complete that action.',
      );
      setBusyResultId(null);
    }
  };

  const updateActiveIndex = (nextIndex: number) => {
    if (results.length === 0) {
      return;
    }
    setActiveIndex((nextIndex + results.length) % results.length);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (isPrimaryShortcut(event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) {
        return;
      }
      onClose(true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    if (event.key === 'Tab' && dialogRef.current) {
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'input:not(:disabled), button:not(:disabled):not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
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
      return;
    }
    if (event.currentTarget !== inputRef.current) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      updateActiveIndex(resolvedActiveIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      updateActiveIndex(resolvedActiveIndex - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      updateActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      updateActiveIndex(results.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      const activeResult = results[resolvedActiveIndex];
      if (!activeResult) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void activateResult(activeResult);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && /^[1-9]$/u.test(event.key)) {
      const shortcutResult = results[Number(event.key) - 1];
      if (!shortcutResult) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void activateResult(shortcutResult);
      return;
    }
  };

  let resultIndex = 0;
  const renderedSections = sections.map((section: CommandPaletteSection) => {
    const headingId = `command-palette-section-${section.id}`;
    return (
      <div
        className="command-palette-section"
        key={section.id}
        role="group"
        aria-labelledby={headingId}
      >
        <div className="command-palette-section-heading" id={headingId}>
          <span>{section.label}</span>
          <span aria-label={`${section.results.length} results`}>{section.results.length}</span>
        </div>
        {section.results.map((result) => {
          const index = resultIndex++;
          const optionId = getOptionId(index);
          const stateId = `${optionId}-state`;
          const hasStateDescription = Boolean(
            result.groupColor ||
            result.state?.active ||
            result.state?.agentAssociated ||
            result.state?.pinned ||
            result.state?.suspended,
          );
          const shortcut = index < 9 ? `${modifierLabel}${index + 1}` : null;
          return (
            <div
              className={`command-palette-result${resolvedActiveIndex === index ? ' is-active' : ''}${
                busyResultId === result.id ? ' is-busy' : ''
              }${result.state?.suspended ? ' is-suspended' : ''}`}
              id={optionId}
              key={result.id}
              role="option"
              aria-label={`${result.title}. ${result.subtitle}`}
              aria-busy={busyResultId === result.id || undefined}
              aria-describedby={hasStateDescription ? stateId : undefined}
              aria-keyshortcuts={shortcut ? `Meta+${index + 1} Control+${index + 1}` : undefined}
              aria-selected={resolvedActiveIndex === index}
              tabIndex={-1}
              onClick={() => void activateResult(result)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void activateResult(result);
                }
              }}
              onMouseDown={(event: ReactMouseEvent) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="command-palette-result-icon">
                <ResultIcon result={result} />
              </span>
              <span className="command-palette-result-copy">
                <strong>{highlightMatch(result.title, query)}</strong>
                <span>{highlightMatch(result.subtitle, query)}</span>
              </span>
              <ResultStates result={result} stateId={stateId} />
              {shortcut ? <kbd className="command-palette-result-shortcut">{shortcut}</kbd> : null}
            </div>
          );
        })}
      </div>
    );
  });

  const loading = activeWindows.status === 'loading' || savedWindows.status === 'loading';
  const sourceErrors = [
    activeWindows.errorMessage ? 'Open tabs are temporarily unavailable.' : null,
    savedWindows.errorMessage ? 'Saved items are temporarily unavailable.' : null,
  ].filter(Boolean);

  return createPortal(
    <div ref={backdropRef} className="command-palette-backdrop">
      <section
        ref={dialogRef}
        className="command-palette-dialog"
        id={DIALOG_ID}
        role="dialog"
        aria-modal="true"
        aria-label="Search Weaver"
        tabIndex={-1}
      >
        <div className="command-palette-search">
          <Search aria-hidden="true" size={19} strokeWidth={1.8} />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-label="Search Weaver"
            aria-autocomplete="list"
            aria-controls={LISTBOX_ID}
            aria-expanded="true"
            aria-activedescendant={activeOptionId}
            autoComplete="off"
            placeholder="Search Weaver"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <button
            className={`command-palette-clear${query ? '' : ' is-hidden'}`}
            type="button"
            aria-label="Clear search"
            aria-hidden={!query}
            tabIndex={query ? 0 : -1}
            onKeyDown={handleKeyDown}
            onClick={() => {
              setQuery('');
              setActiveIndex(0);
              inputRef.current?.focus();
            }}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <div
          className="command-palette-results"
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Weaver search results"
        >
          {renderedSections}
          {results.length === 0 ? (
            <div className="command-palette-empty" role="status">
              {loading
                ? 'Loading tabs, groups, and saved items…'
                : query.trim()
                  ? `No results for “${query.trim()}”.`
                  : 'No commands are available.'}
            </div>
          ) : null}
        </div>

        {sourceErrors.length > 0 ? (
          <div className="command-palette-source-errors" role="status">
            {sourceErrors.join(' ')}
          </div>
        ) : null}
        {actionError ? (
          <div className="command-palette-action-error" role="alert">
            {actionError}
          </div>
        ) : null}
        <span className="sr-only" aria-live="polite">
          {results.length} {results.length === 1 ? 'result' : 'results'}
        </span>

        <footer className="command-palette-footer">
          <span aria-hidden="true">
            <kbd>↑↓</kbd> Navigate
          </span>
          <span aria-hidden="true">
            <kbd>Enter</kbd> Select
          </span>
          <span aria-hidden="true">
            <kbd>Esc</kbd> Close
          </span>
          <button
            className="command-palette-footer-close"
            type="button"
            onKeyDown={handleKeyDown}
            onClick={() => onClose(true)}
          >
            Close
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function CommandPalette({ activeWindowsService, savedWindowsService }: CommandPaletteProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const modifierLabel = getModifierLabel();

  const openPalette = () => {
    if (hasBlockingSurface()) {
      return;
    }
    const activeElement = document.activeElement;
    returnFocusRef.current =
      activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      activeElement !== document.documentElement &&
      activeElement.isConnected
        ? activeElement
        : triggerRef.current;
    setOpen(true);
  };

  const closePalette = (restoreFocus: boolean) => {
    setOpen(false);
    if (!restoreFocus) {
      returnFocusRef.current = null;
      return;
    }
    const focusTarget = returnFocusRef.current;
    returnFocusRef.current = null;
    queueMicrotask(() => {
      const canRestore =
        focusTarget?.isConnected &&
        !focusTarget.matches(':disabled, [hidden], [aria-hidden="true"]') &&
        !focusTarget.closest('[inert], [aria-hidden="true"]');
      if (canRestore) {
        focusTarget.focus();
        if (document.activeElement === focusTarget) {
          return;
        }
      }
      triggerRef.current?.focus();
    });
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || !isPrimaryShortcut(event)) {
        return;
      }
      event.preventDefault();
      if (event.repeat) {
        return;
      }
      if (open) {
        closePalette(true);
        return;
      }
      openPalette();
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  });

  return (
    <>
      <button
        ref={triggerRef}
        className="toolbar-button command-palette-trigger"
        type="button"
        aria-controls={DIALOG_ID}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Search Weaver"
        aria-keyshortcuts="Meta+K Control+K"
        title={`Search Weaver (${modifierLabel}K)`}
        onClick={() => (open ? closePalette(true) : openPalette())}
      >
        <Search aria-hidden="true" size={16} strokeWidth={1.8} />
        <span>Search Weaver</span>
        <kbd>{modifierLabel === '⌘' ? <Command aria-hidden="true" size={11} /> : 'Ctrl'} K</kbd>
      </button>
      {open ? (
        <CommandPaletteDialog
          activeWindowsService={activeWindowsService}
          onClose={closePalette}
          savedWindowsService={savedWindowsService}
        />
      ) : null}
    </>
  );
}
