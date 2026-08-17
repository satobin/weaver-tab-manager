import { Archive, CircleAlert, Info, PanelsTopLeft, Settings } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AboutPage } from '../pages/AboutPage';
import { ActiveWindowsPage } from '../pages/ActiveWindowsPage';
import { SavedWindowsPage } from '../pages/SavedWindowsPage';
import { SettingsPage } from '../pages/SettingsPage';
import {
  createChromeActiveWindowsService,
  type ActiveWindowsService,
} from '../features/active-windows/chromeActiveWindowsService';
import { CommandPalette } from '../features/command-palette/CommandPalette';
import {
  createSavedWindowsService,
  type SavedWindowsService,
} from '../features/saved-windows/savedWindowsService';
import { AppearanceControl } from '../features/settings/AppearanceControl';
import { createSettingsService, type SettingsService } from '../features/settings/settingsService';
import { useAppearance } from '../features/settings/useAppearance';
import { useSettings } from '../features/settings/useSettings';
import { APP_ROUTES, getAppRouteSearchParams, parseAppRoute, type AppRoute } from './routes';
import { useHashRoute } from './useHashRoute';
import { useActiveWindowCount, useSavedWindowCount } from './useNavigationCounts';

const NAV_ITEMS = [
  { route: APP_ROUTES.windows, label: 'Active Windows', icon: PanelsTopLeft },
  { route: APP_ROUTES.savedWindows, label: 'Saved Windows', icon: Archive },
  { route: APP_ROUTES.settings, label: 'Settings', icon: Settings },
  { route: APP_ROUTES.about, label: 'About', icon: Info },
] as const;

const PAGE_TITLES: Record<AppRoute, string> = {
  [APP_ROUTES.windows]: 'Active Windows',
  [APP_ROUTES.savedWindows]: 'Saved Windows',
  [APP_ROUTES.settings]: 'Settings',
  [APP_ROUTES.about]: 'About Weaver',
};

const FOCUS_TARGET_RETRY_LIMIT = 20;
const FOCUS_READINESS_RETRY_LIMIT = 200;

function FocusIntentObserver() {
  useEffect(() => {
    let requestId = 0;
    let timeoutId: number | undefined;
    const consumeFocusIntent = () => {
      const searchParams = getAppRouteSearchParams(window.location.hash);
      const targetId = searchParams.get('focus');
      if (!targetId) {
        return;
      }
      const fallbackTargetId = searchParams.get('fallbackFocus');
      const route = parseAppRoute(window.location.hash);
      searchParams.delete('focus');
      searchParams.delete('fallbackFocus');
      const remainingQuery = searchParams.toString();
      const nextHash = remainingQuery ? `${route}?${remainingQuery}` : route;
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${nextHash}`,
      );
      const currentRequestId = ++requestId;
      let attempts = 0;
      const tryFocus = (target: HTMLElement): boolean => {
        if (target.matches(':disabled, [aria-disabled="true"]')) {
          return false;
        }
        target.scrollIntoView?.({ block: 'center' });
        target.focus({ preventScroll: true });
        return document.activeElement === target;
      };
      const focusTarget = () => {
        if (currentRequestId !== requestId) {
          return;
        }
        const target = document.getElementById(targetId);
        if (target instanceof HTMLElement && tryFocus(target)) {
          return;
        }
        attempts += 1;
        if (fallbackTargetId) {
          const fallbackTarget = document.getElementById(fallbackTargetId);
          if (fallbackTarget instanceof HTMLElement) {
            const fallbackReady =
              fallbackTarget.dataset.commandPaletteFocusReady !== 'false' ||
              attempts >= FOCUS_READINESS_RETRY_LIMIT;
            if (fallbackReady) {
              if (tryFocus(fallbackTarget)) {
                return;
              }
              if (attempts >= FOCUS_READINESS_RETRY_LIMIT) {
                return;
              }
            }
            timeoutId = window.setTimeout(focusTarget, 25);
            return;
          }
        }
        if (attempts < FOCUS_TARGET_RETRY_LIMIT) {
          timeoutId = window.setTimeout(focusTarget, 25);
        }
      };
      queueMicrotask(focusTarget);
    };

    consumeFocusIntent();
    window.addEventListener('hashchange', consumeFocusIntent);
    return () => {
      requestId += 1;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener('hashchange', consumeFocusIntent);
    };
  }, []);

  return null;
}

function SavedWindowCountObserver({
  onCountChange,
  service,
}: {
  onCountChange: (count: number | null) => void;
  service: SavedWindowsService;
}) {
  const count = useSavedWindowCount(service);

  useEffect(() => {
    onCountChange(count);
  }, [count, onCountChange]);
  useEffect(
    () => () => {
      onCountChange(null);
    },
    [onCountChange],
  );

  return null;
}

function CurrentPage({
  actionPortalTarget,
  activeWindowsService,
  headerPortalTarget,
  onSavedWindowCountChange,
  route,
  savedWindowsService,
  settingsService,
}: {
  actionPortalTarget: HTMLDivElement | null;
  activeWindowsService?: ActiveWindowsService | undefined;
  headerPortalTarget: HTMLDivElement | null;
  onSavedWindowCountChange: (count: number | null) => void;
  route: AppRoute;
  savedWindowsService?: SavedWindowsService | undefined;
  settingsService: SettingsService;
}) {
  switch (route) {
    case APP_ROUTES.savedWindows:
      return (
        <SavedWindowsPage
          actionPortalTarget={actionPortalTarget}
          headerPortalTarget={headerPortalTarget}
          onWindowCountChange={onSavedWindowCountChange}
          service={savedWindowsService}
          settingsService={settingsService}
        />
      );
    case APP_ROUTES.settings:
      return <SettingsPage activeWindowsService={activeWindowsService} service={settingsService} />;
    case APP_ROUTES.about:
      return <AboutPage />;
    case APP_ROUTES.windows:
      return (
        <ActiveWindowsPage
          actionPortalTarget={actionPortalTarget}
          headerPortalTarget={headerPortalTarget}
          savedWindowsService={savedWindowsService}
          service={activeWindowsService}
          settingsService={settingsService}
        />
      );
  }
}

export interface AppProps {
  activeWindowsService?: ActiveWindowsService | undefined;
  savedWindowsService?: SavedWindowsService | undefined;
  settingsService?: SettingsService | undefined;
}

export function App({ activeWindowsService, savedWindowsService, settingsService }: AppProps) {
  const route = useHashRoute();
  const [actionPortalTarget, setActionPortalTarget] = useState<HTMLDivElement | null>(null);
  const [headerPortalTarget, setHeaderPortalTarget] = useState<HTMLDivElement | null>(null);
  const [navigationSavedWindowCount, setNavigationSavedWindowCount] = useState<number | null>(null);
  const [savedWindowPageCount, setSavedWindowPageCount] = useState<number | null>(null);
  const resolvedSettingsService = useMemo(
    () => settingsService ?? createSettingsService(),
    [settingsService],
  );
  const resolvedActiveWindowsService = useMemo(
    () => activeWindowsService ?? createChromeActiveWindowsService(),
    [activeWindowsService],
  );
  const resolvedSavedWindowsService = useMemo(
    () => savedWindowsService ?? createSavedWindowsService(),
    [savedWindowsService],
  );
  const navigationActiveWindowCount = useActiveWindowCount(resolvedActiveWindowsService);
  const { errorMessage, isLoading, savingSettings, setColorMode, settings } =
    useSettings(resolvedSettingsService);
  useAppearance(settings.colorMode);

  const activeWindowCount = navigationActiveWindowCount;
  const resolvedSavedWindowCount =
    route === APP_ROUTES.savedWindows ? savedWindowPageCount : navigationSavedWindowCount;
  const savedWindowCount =
    resolvedSavedWindowCount === null
      ? null
      : resolvedSavedWindowCount > 0
        ? resolvedSavedWindowCount
        : undefined;

  return (
    <div className="app-shell">
      <FocusIntentObserver />
      {route !== APP_ROUTES.savedWindows ? (
        <SavedWindowCountObserver
          onCountChange={setNavigationSavedWindowCount}
          service={resolvedSavedWindowsService}
        />
      ) : null}
      <aside className="sidebar" aria-label="Weaver navigation">
        <a className="brand" href={APP_ROUTES.windows} aria-label="Weaver home">
          <img src="/icons/default-128.png" alt="" width="42" height="42" />
          <span className="brand-copy">
            <strong>Weaver</strong>
            <small>Window &amp; Tab Manager</small>
          </span>
        </a>

        <nav className="primary-nav">
          {NAV_ITEMS.map(({ route: itemRoute, label, icon: Icon }) => {
            const count =
              itemRoute === APP_ROUTES.windows
                ? activeWindowCount
                : itemRoute === APP_ROUTES.savedWindows
                  ? savedWindowCount
                  : undefined;
            return (
              <a
                key={itemRoute}
                href={itemRoute}
                className="nav-link"
                aria-label={count === null || count === undefined ? label : `${label}: ${count}`}
                aria-current={route === itemRoute ? 'page' : undefined}
              >
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                <span className="nav-label">{label}</span>
                {count !== undefined ? (
                  <span
                    className={`nav-count${count === null ? ' is-loading' : ''}`}
                    aria-hidden="true"
                  >
                    {count ?? 0}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>
      </aside>

      <header className="topbar">
        <div className="topbar-heading">
          <h1 className="programmatic-focus-target" id="page-title" tabIndex={-1}>
            {PAGE_TITLES[route]}
          </h1>
          <div className="topbar-page-status" ref={setHeaderPortalTarget} />
        </div>
        <div className="topbar-actions">
          {errorMessage ? (
            <span className="topbar-settings-error" role="alert" title={errorMessage}>
              <CircleAlert aria-hidden="true" size={16} />
              <span className="sr-only">{errorMessage}</span>
            </span>
          ) : null}
          <CommandPalette
            activeWindowsService={resolvedActiveWindowsService}
            savedWindowsService={resolvedSavedWindowsService}
          />
          <div className="topbar-page-actions" ref={setActionPortalTarget} />
          <AppearanceControl
            disabled={isLoading || savingSettings.has('colorMode')}
            onChange={(colorMode) => void setColorMode(colorMode)}
            value={settings.colorMode}
          />
        </div>
      </header>

      <main className="main-content" id="main-content" tabIndex={-1}>
        <CurrentPage
          actionPortalTarget={actionPortalTarget}
          activeWindowsService={resolvedActiveWindowsService}
          headerPortalTarget={headerPortalTarget}
          onSavedWindowCountChange={setSavedWindowPageCount}
          route={route}
          savedWindowsService={resolvedSavedWindowsService}
          settingsService={resolvedSettingsService}
        />
      </main>
    </div>
  );
}
