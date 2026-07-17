import {
  ArrowDownAZ,
  ArrowUpZA,
  CirclePause,
  CopyX,
  Eye,
  Pause,
  Play,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { APP_LAUNCH_ROUTES, APP_ROUTES } from '../app/routes';
import {
  createChromeActiveWindowsService,
  type ActiveWindowsService,
  type RestorableTab,
} from '../features/active-windows/chromeActiveWindowsService';
import { formatTabLocation, isNewTabUrl, isTabSuspended } from '../features/active-windows/model';
import { createRestorableTabs } from '../features/active-windows/restorableTabs';
import { SortCriterionMenu } from '../features/active-windows/SortCriterionMenu';
import { TabIcon } from '../features/active-windows/TabIcon';
import { type SortCriterion, type SortDirection } from '../features/active-windows/tabSort';
import { useActiveWindows } from '../features/active-windows/useActiveWindows';
import { planDuplicateTabs } from '../features/deduplication/deduplication';
import { createSettingsService, type SettingsService } from '../features/settings/settingsService';
import { useSettings } from '../features/settings/useSettings';
import { useAppearance } from '../features/settings/useAppearance';
import {
  getCommandShortcutState,
  getSuggestedOpenManagerShortcut,
  OPEN_MANAGER_COMMAND,
  openExtensionShortcutSettings,
} from '../platform/chrome/extensionShortcuts';
import { OPEN_APP_MESSAGE, isOpenAppResponse, type OpenAppMessage } from '../shared/messages';

interface PopupProps {
  service?: ActiveWindowsService | undefined;
  settingsService?: SettingsService | undefined;
}

function defaultManagerShortcut(): string {
  return getSuggestedOpenManagerShortcut(navigator.platform);
}

export function Popup({
  service: providedService,
  settingsService: providedSettingsService,
}: PopupProps) {
  const service = useMemo(
    () => providedService ?? createChromeActiveWindowsService(),
    [providedService],
  );
  const settingsService = useMemo(
    () => providedSettingsService ?? createSettingsService(),
    [providedSettingsService],
  );
  const { errorMessage, refresh, snapshot } = useActiveWindows(service);
  const { isLoading: settingsLoading, settings } = useSettings(settingsService);
  useAppearance(settings.colorMode);
  const [managerShortcut, setManagerShortcut] = useState<string | null>(defaultManagerShortcut);
  const [query, setQuery] = useState('');
  const [sortCriterion, setSortCriterion] = useState<SortCriterion>('title');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [duplicateUndoTabs, setDuplicateUndoTabs] = useState<readonly RestorableTab[] | null>(null);
  const [pendingAction, setPendingAction] = useState<
    'dedupe' | 'sort' | 'suspend' | 'undo' | 'unsuspend' | null
  >(null);
  const pendingCloseTabIds = useRef(new Set<number>());
  const actionInFlight = useRef(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const results = useMemo(
    () =>
      normalizedQuery && snapshot
        ? snapshot.windows.flatMap((window) =>
            window.tabs.flatMap((tab) =>
              tab.title.toLocaleLowerCase().includes(normalizedQuery) ||
              tab.url.toLocaleLowerCase().includes(normalizedQuery)
                ? [{ tab, windowLabel: window.label }]
                : [],
            ),
          )
        : [],
    [normalizedQuery, snapshot],
  );
  const currentWindow = snapshot?.windows.find((window) => window.isCurrent);
  const duplicatePlan = useMemo(
    () =>
      planDuplicateTabs(
        currentWindow?.tabs ?? [],
        settings.advancedDuplicateMatchingEnabled ? settings.deduplicationRules : [],
        {
          tabId: currentWindow?.tabs.find((tab) => tab.active)?.id,
          windowId: currentWindow?.id,
        },
      ),
    [currentWindow, settings.advancedDuplicateMatchingEnabled, settings.deduplicationRules],
  );
  const sortUnavailable = !currentWindow || settingsLoading;
  const dedupeUnavailable = sortUnavailable || duplicatePlan.duplicateTabIds.length === 0;
  const suspendableTabIds =
    currentWindow?.tabs.filter((tab) => !tab.active && !isTabSuspended(tab)).map((tab) => tab.id) ??
    [];
  const suspendedTabIds = currentWindow?.tabs.filter(isTabSuspended).map((tab) => tab.id) ?? [];

  useEffect(() => {
    let cancelled = false;
    if (typeof chrome === 'undefined' || !chrome.commands?.getAll) {
      return;
    }
    void chrome.commands
      .getAll()
      .then((commands) => {
        const shortcut = getCommandShortcutState(commands, OPEN_MANAGER_COMMAND);
        if (!cancelled && shortcut.status !== 'missing') {
          setManagerShortcut(shortcut.status === 'assigned' ? shortcut.display : null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const openManager = async (route: string = APP_ROUTES.windows) => {
    const message: OpenAppMessage = { type: OPEN_APP_MESSAGE, route };
    setActionError(null);
    try {
      const response: unknown = await chrome.runtime.sendMessage(message);
      if (!isOpenAppResponse(response)) {
        setActionError('The browser could not open the Window Manager.');
        return;
      }
      if (!response.ok) {
        setActionError(response.error);
        return;
      }
      window.close();
    } catch {
      setActionError('The browser could not open the Window Manager.');
    }
  };

  const openShortcutSettings = async () => {
    setActionError(null);
    const result = await openExtensionShortcutSettings(chrome.tabs, navigator.userAgent);
    if (result.ok) {
      window.close();
      return;
    }
    setActionError(`Open ${result.manualUrl} in the address bar to set Weaver's shortcut.`);
  };

  const focusTab = async (windowId: number, tabId: number) => {
    setActionError(null);
    try {
      await service.focusTab(windowId, tabId);
      window.close();
    } catch {
      setActionError('The browser could not focus that tab.');
    }
  };

  const closeTab = async (tabId: number) => {
    if (pendingCloseTabIds.current.has(tabId)) {
      return;
    }
    pendingCloseTabIds.current.add(tabId);
    setActionError(null);
    setActionNotice(null);
    setDuplicateUndoTabs(null);
    try {
      const result = await service.closeTabs([tabId]);
      if (result.failures.length > 0) {
        setActionError(result.failures[0]?.message ?? 'The browser could not close that tab.');
        return;
      }
      await refresh();
    } catch {
      setActionError('The browser could not close that tab.');
    } finally {
      pendingCloseTabIds.current.delete(tabId);
    }
  };

  const sortCurrentWindow = async () => {
    if (!currentWindow || actionInFlight.current || settingsLoading) {
      return;
    }

    actionInFlight.current = true;
    setActionError(null);
    setActionNotice(null);
    setDuplicateUndoTabs(null);
    setPendingAction('sort');
    try {
      const result = await service.sortWindow(currentWindow.id, {
        criterion: sortCriterion,
        direction: sortDirection,
        preserveGroups: settings.preserveGroupsDuringSort,
      });
      const issue = result.failures[0]?.message ?? result.warnings[0];
      if (issue) {
        setActionError(issue);
        await refresh();
        return;
      }
      await refresh();
    } catch {
      setActionError('The browser could not sort the current window.');
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
    }
  };

  const removeDuplicateTabs = async () => {
    if (duplicatePlan.duplicateTabIds.length === 0 || actionInFlight.current || settingsLoading) {
      return;
    }

    const undoCandidates = snapshot
      ? createRestorableTabs(snapshot, duplicatePlan.duplicateTabIds)
      : [];
    actionInFlight.current = true;
    setActionError(null);
    setActionNotice(null);
    setDuplicateUndoTabs(null);
    setPendingAction('dedupe');
    try {
      const result = await service.closeTabs(duplicatePlan.duplicateTabIds);
      if (result.closedTabIds.length > 0) {
        const closedTabIds = new Set(result.closedTabIds);
        const closedTabs = undoCandidates.filter((tab) => closedTabIds.has(tab.originalTabId));
        setDuplicateUndoTabs(closedTabs.length > 0 ? closedTabs : null);
        setActionNotice(
          `${result.closedTabIds.length} duplicate ${result.closedTabIds.length === 1 ? 'tab' : 'tabs'} removed.`,
        );
      }
      if (result.failures.length > 0) {
        setActionError(
          `${result.failures.length} duplicate ${result.failures.length === 1 ? 'tab' : 'tabs'} could not be closed. ${result.failures[0]?.message ?? ''}`.trim(),
        );
      }
      await refresh();
    } catch {
      setActionError('The browser could not remove duplicate tabs.');
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
    }
  };

  const undoDuplicateRemoval = async () => {
    const tabs = duplicateUndoTabs;
    if (!tabs || tabs.length === 0 || actionInFlight.current) {
      return;
    }

    actionInFlight.current = true;
    setActionError(null);
    setActionNotice(null);
    setDuplicateUndoTabs(null);
    setPendingAction('undo');
    try {
      const result = await service.restoreTabs(tabs);
      const issues = [
        result.failures.length > 0
          ? `${result.failures.length} ${result.failures.length === 1 ? 'tab' : 'tabs'} could not be restored. ${result.failures[0]?.message ?? ''}`.trim()
          : '',
        ...result.warnings,
      ].filter(Boolean);
      setActionError(issues.length > 0 ? issues.join(' ') : null);
      await refresh();
    } catch {
      setActionError('The browser could not restore the removed duplicate tabs.');
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
    }
  };

  const changeCurrentWindowSuspension = async (mode: 'suspend' | 'unsuspend') => {
    const tabIds = mode === 'suspend' ? suspendableTabIds : suspendedTabIds;
    if (tabIds.length === 0 || actionInFlight.current) {
      return;
    }

    actionInFlight.current = true;
    setActionError(null);
    setActionNotice(null);
    setDuplicateUndoTabs(null);
    setPendingAction(mode);
    try {
      const result =
        mode === 'suspend'
          ? await service.suspendTabs(tabIds)
          : await service.unsuspendTabs(tabIds);
      if (result.failures.length > 0) {
        const action = mode === 'suspend' ? 'suspended' : 'unsuspended';
        setActionError(
          `${result.failures.length} ${result.failures.length === 1 ? 'tab' : 'tabs'} could not be ${action}. ${result.failures[0]?.message ?? ''}`.trim(),
        );
      }
      await refresh();
    } catch {
      setActionError(
        mode === 'suspend'
          ? 'The browser could not suspend the other tabs in this window.'
          : 'The browser could not unsuspend the tabs in this window.',
      );
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
    }
  };

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <img src="/icons/default-48.png" alt="" width="32" height="32" />
        <div>
          <h1>Weaver</h1>
          <p>Window &amp; Tab Manager</p>
        </div>
      </header>

      <label className="popup-search">
        <Search aria-hidden="true" size={16} />
        <span className="popup-sr-only">Search open tabs</span>
        <input
          type="text"
          role="searchbox"
          value={query}
          placeholder="Search tabs"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
            <X aria-hidden="true" size={14} />
          </button>
        ) : null}
      </label>

      <div className="popup-actions">
        <section
          className="popup-current-window-actions"
          aria-labelledby="popup-current-window-heading"
        >
          <h2 id="popup-current-window-heading" className="popup-current-window-summary">
            Current window
          </h2>
          <div
            className="popup-sort-controls"
            role="group"
            aria-label="Sort current window"
            data-operation-locked={pendingAction !== null && !sortUnavailable ? 'true' : undefined}
          >
            <SortCriterionMenu
              ariaLabel="Sort current window by"
              disabled={sortUnavailable || pendingAction !== null}
              onChange={setSortCriterion}
              value={sortCriterion}
            />
            <button
              className="popup-sort-direction"
              type="button"
              aria-label={`Sort current window direction ${sortDirection === 'asc' ? 'A to Z' : 'Z to A'}`}
              title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
              disabled={sortUnavailable || pendingAction !== null}
              onClick={() => setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
            >
              {sortDirection === 'asc' ? (
                <ArrowDownAZ aria-hidden="true" size={16} />
              ) : (
                <ArrowUpZA aria-hidden="true" size={16} />
              )}
            </button>
            <button
              className="popup-sort-apply"
              type="button"
              aria-label="Sort current window"
              aria-busy={pendingAction === 'sort'}
              disabled={sortUnavailable || pendingAction !== null}
              onClick={() => void sortCurrentWindow()}
            >
              Sort
            </button>
          </div>
          <div className="popup-duplicate-control" role="group" aria-label="Duplicate tab actions">
            <button
              className="popup-quick-action popup-duplicate-close-action"
              type="button"
              data-operation-locked={
                pendingAction !== null && !dedupeUnavailable ? 'true' : undefined
              }
              disabled={dedupeUnavailable || pendingAction !== null}
              aria-busy={pendingAction === 'dedupe'}
              onClick={() => void removeDuplicateTabs()}
            >
              <CopyX aria-hidden="true" size={16} />
              <span>Close duplicate tabs</span>
              <small>{duplicatePlan.duplicateTabIds.length}</small>
            </button>
            <button
              className="popup-quick-action popup-duplicate-preview-action"
              type="button"
              aria-label="Show duplicate tabs across all windows in Window Manager"
              title="Show duplicate tabs across all windows in Window Manager"
              disabled={!snapshot || settingsLoading || pendingAction !== null}
              onClick={() => void openManager(APP_LAUNCH_ROUTES.duplicateTabs)}
            >
              <Eye aria-hidden="true" size={16} />
            </button>
          </div>
          <div
            className="popup-suspension-actions"
            role="group"
            aria-label="Current window tab suspension"
          >
            <button
              className="popup-quick-action"
              type="button"
              data-operation-locked={
                pendingAction !== null && suspendableTabIds.length > 0 ? 'true' : undefined
              }
              disabled={suspendableTabIds.length === 0 || pendingAction !== null}
              aria-busy={pendingAction === 'suspend'}
              title="Suspend loaded background tabs in this window. Tabs resume or reload when opened."
              onClick={() => void changeCurrentWindowSuspension('suspend')}
            >
              <Pause aria-hidden="true" size={16} />
              <span>Suspend tabs</span>
              <small>{suspendableTabIds.length}</small>
            </button>
            <button
              className="popup-quick-action"
              type="button"
              data-operation-locked={
                pendingAction !== null && suspendedTabIds.length > 0 ? 'true' : undefined
              }
              disabled={suspendedTabIds.length === 0 || pendingAction !== null}
              aria-busy={pendingAction === 'unsuspend'}
              title="Unsuspend every suspended tab in this window now."
              onClick={() => void changeCurrentWindowSuspension('unsuspend')}
            >
              <Play aria-hidden="true" size={16} />
              <span>Unsuspend all</span>
              <small>{suspendedTabIds.length}</small>
            </button>
            {suspendedTabIds.length > 0 ? (
              <span className="popup-suspension-state">
                <CirclePause aria-hidden="true" size={13} />
                {suspendedTabIds.length}{' '}
                {suspendedTabIds.length === 1 ? 'tab suspended' : 'tabs suspended'} · Resumes or
                reloads when opened
              </span>
            ) : null}
          </div>
        </section>
        <span className="popup-sr-only" role="status">
          {pendingAction === 'sort'
            ? 'Sorting current window'
            : pendingAction === 'dedupe'
              ? 'Closing duplicate tabs'
              : pendingAction === 'undo'
                ? 'Restoring duplicate tabs'
                : pendingAction === 'suspend'
                  ? 'Suspending other tabs'
                  : pendingAction === 'unsuspend'
                    ? 'Unsuspending tabs'
                    : ''}
        </span>
      </div>

      {actionNotice ? (
        <div className="popup-notice" role="status">
          <span>{actionNotice}</span>
          <button type="button" onClick={() => void undoDuplicateRemoval()}>
            Undo
          </button>
          <button
            type="button"
            onClick={() => {
              setActionNotice(null);
              setDuplicateUndoTabs(null);
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {errorMessage || actionError ? (
        <div className="popup-alert" role="alert">
          <span>{actionError ?? errorMessage}</span>
          {errorMessage ? (
            <button type="button" onClick={() => void refresh()}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {normalizedQuery ? (
        results.length > 0 && snapshot ? (
          <div className="popup-results" aria-label="Matching tabs">
            <div className="popup-context-count popup-result-count" aria-live="polite">
              {results.length} {results.length === 1 ? 'result' : 'results'}
            </div>
            <ul>
              {results.map(({ tab, windowLabel }) => (
                <li key={tab.id}>
                  <button
                    className="popup-result-main"
                    type="button"
                    title={tab.url || tab.title}
                    onClick={() => void focusTab(tab.windowId, tab.id)}
                  >
                    <TabIcon
                      fallback={isNewTabUrl(tab.url) ? 'new-tab' : 'page'}
                      iconUrl={tab.iconUrl}
                    />
                    <span>
                      <strong>{tab.title}</strong>
                      <small>
                        {windowLabel} · {formatTabLocation(tab.url, snapshot.extensionOrigin)}
                      </small>
                    </span>
                  </button>
                  <button
                    className="popup-close-tab"
                    type="button"
                    aria-label={`Close ${tab.title}`}
                    title="Close tab"
                    onClick={() => void closeTab(tab.id)}
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="popup-empty">No matching tabs</p>
        )
      ) : (
        <p className="popup-context-count popup-summary" aria-live="polite">
          {snapshot
            ? `${snapshot.windows.length} ${snapshot.windows.length === 1 ? 'window' : 'windows'} · ${snapshot.totalTabs} ${snapshot.totalTabs === 1 ? 'tab' : 'tabs'}`
            : 'Loading tabs'}
        </p>
      )}

      {managerShortcut === null ? (
        <div className="open-manager-split" role="group" aria-label="Window Manager actions">
          <button
            className="open-manager-split-primary"
            type="button"
            onClick={() => void openManager()}
          >
            Open Window Manager
          </button>
          <button
            className="open-manager-shortcut-action"
            type="button"
            title="Open browser extension shortcut settings"
            onClick={() => void openShortcutSettings()}
          >
            Set Shortcut
          </button>
        </div>
      ) : (
        <button
          className="open-manager-button"
          type="button"
          aria-label="Open Window Manager"
          onClick={() => void openManager()}
        >
          <span className="open-manager-label">Open Window Manager</span>
          <kbd
            className="open-manager-shortcut"
            aria-hidden="true"
            title={`Keyboard shortcut: ${managerShortcut}`}
          >
            {managerShortcut}
          </kbd>
        </button>
      )}
    </main>
  );
}
