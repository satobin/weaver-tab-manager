import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  getCommandShortcutState,
  OPEN_MANAGER_COMMAND,
  openExtensionShortcutSettings,
} from '../../platform/chrome/extensionShortcuts';

type CommandsApi = Pick<typeof chrome.commands, 'getAll'>;

type ShortcutDisplayState = 'assigned' | 'loading' | 'unassigned' | 'unavailable';

interface ShortcutRow {
  description: string;
  label: string;
  name: string;
  shortcut?: string;
  state: ShortcutDisplayState;
}

const SHORTCUT_DEFINITIONS = [
  {
    description: 'Opens the Weaver popup.',
    label: 'Activate the extension',
    name: '_execute_action',
  },
  {
    description: 'Opens the full window and tab manager.',
    label: 'Open Window Manager',
    name: OPEN_MANAGER_COMMAND,
  },
] as const;

function createShortcutRows(
  state: Exclude<ShortcutDisplayState, 'assigned' | 'unassigned'>,
): ShortcutRow[] {
  return SHORTCUT_DEFINITIONS.map((definition) => ({ ...definition, state }));
}

function presentCommands(commands: readonly chrome.commands.Command[]): ShortcutRow[] {
  return SHORTCUT_DEFINITIONS.map((definition) => {
    const { name } = definition;
    const shortcut = getCommandShortcutState(commands, name);
    if (shortcut.status === 'missing') {
      return { ...definition, state: 'unavailable' };
    }
    return shortcut.status === 'assigned'
      ? {
          ...definition,
          shortcut: shortcut.display,
          state: 'assigned',
        }
      : { ...definition, state: 'unassigned' };
  });
}

function getCommandsApi(): CommandsApi | undefined {
  if (typeof chrome === 'undefined') {
    return undefined;
  }
  const commands = (chrome as unknown as { commands?: Partial<CommandsApi> }).commands;
  return typeof commands?.getAll === 'function' ? (commands as CommandsApi) : undefined;
}

function getTabsApi(): Pick<typeof chrome.tabs, 'create'> | undefined {
  if (typeof chrome === 'undefined') {
    return undefined;
  }
  const tabs = (chrome as unknown as { tabs?: Partial<Pick<typeof chrome.tabs, 'create'>> }).tabs;
  return typeof tabs?.create === 'function'
    ? (tabs as Pick<typeof chrome.tabs, 'create'>)
    : undefined;
}

function shortcutStateLabel(state: Exclude<ShortcutDisplayState, 'assigned'>): string {
  switch (state) {
    case 'loading':
      return 'Loading…';
    case 'unassigned':
      return 'Not assigned';
    case 'unavailable':
      return 'Unavailable';
  }
}

export function KeyboardShortcutsSetting() {
  const [rows, setRows] = useState<readonly ShortcutRow[]>(() => createShortcutRows('loading'));
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const canEdit = getTabsApi() !== undefined;

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    const load = async () => {
      const currentRequestId = ++requestId;
      const commands = getCommandsApi();
      if (!commands) {
        if (!cancelled && currentRequestId === requestId) {
          setRows(createShortcutRows('unavailable'));
        }
        return;
      }
      try {
        const nextCommands = await commands.getAll();
        if (!cancelled && currentRequestId === requestId) {
          setRows(presentCommands(nextCommands));
        }
      } catch {
        if (!cancelled && currentRequestId === requestId) {
          setRows(createShortcutRows('unavailable'));
        }
      }
    };
    const reloadWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    };
    const reloadOnFocus = () => {
      void load();
    };

    void load();
    window.addEventListener('focus', reloadOnFocus);
    document.addEventListener('visibilitychange', reloadWhenVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', reloadOnFocus);
      document.removeEventListener('visibilitychange', reloadWhenVisible);
    };
  }, []);

  const editShortcuts = async () => {
    setNavigationError(null);
    const tabs = getTabsApi();
    if (!tabs) {
      setNavigationError('Shortcut settings are unavailable in this browser.');
      return;
    }
    const result = await openExtensionShortcutSettings(tabs, navigator.userAgent);
    if (!result.ok) {
      setNavigationError(
        `Couldn’t open shortcut settings. Enter ${result.manualUrl} in the address bar.`,
      );
    }
  };

  return (
    <section
      className="settings-group keyboard-shortcuts-settings-group"
      aria-labelledby="keyboard-shortcuts-heading"
    >
      <header className="keyboard-shortcuts-header">
        <div className="keyboard-shortcuts-copy">
          <h3 id="keyboard-shortcuts-heading">Keyboard shortcuts</h3>
          <p id="keyboard-shortcuts-description">
            View the shortcuts currently assigned by your browser.
          </p>
        </div>
        <span id="keyboard-shortcuts-edit-description" className="sr-only">
          Opens your browser’s extension shortcut settings in a new tab.
        </span>
        <button
          className="keyboard-shortcuts-action"
          type="button"
          aria-describedby="keyboard-shortcuts-edit-description"
          disabled={!canEdit}
          onClick={() => void editShortcuts()}
        >
          <ExternalLink aria-hidden="true" size={14} />
          Edit shortcuts
        </button>
      </header>
      <dl className="keyboard-shortcuts-list" aria-live="polite">
        {rows.map((row) => (
          <div key={row.name}>
            <dt>
              <span>{row.label}</span>
              <small>{row.description}</small>
            </dt>
            <dd>
              {row.state === 'assigned' ? (
                <kbd>{row.shortcut}</kbd>
              ) : (
                <span className={`keyboard-shortcut-status is-${row.state}`}>
                  {shortcutStateLabel(row.state)}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {navigationError ? (
        <p className="keyboard-shortcuts-error" role="alert">
          {navigationError}
        </p>
      ) : null}
    </section>
  );
}
