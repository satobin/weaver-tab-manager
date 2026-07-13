import { Archive, CircleAlert, Info, PanelsTopLeft, Settings } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AboutPage } from '../pages/AboutPage';
import { ActiveWindowsPage } from '../pages/ActiveWindowsPage';
import { SavedWindowsPage } from '../pages/SavedWindowsPage';
import { SettingsPage } from '../pages/SettingsPage';
import {
  createChromeActiveWindowsService,
  type ActiveWindowsService,
} from '../features/active-windows/chromeActiveWindowsService';
import { useActiveWindows } from '../features/active-windows/useActiveWindows';
import {
  createSavedWindowsService,
  type SavedWindowsService,
} from '../features/saved-windows/savedWindowsService';
import { useSavedWindows } from '../features/saved-windows/useSavedWindows';
import { AppearanceControl } from '../features/settings/AppearanceControl';
import { createSettingsService, type SettingsService } from '../features/settings/settingsService';
import { useAppearance } from '../features/settings/useAppearance';
import { useSettings } from '../features/settings/useSettings';
import { APP_ROUTES, type AppRoute } from './routes';
import { useHashRoute } from './useHashRoute';

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

function CurrentPage({
  actionPortalTarget,
  activeWindowsService,
  headerPortalTarget,
  route,
  savedWindowsService,
  settingsService,
}: {
  actionPortalTarget: HTMLDivElement | null;
  activeWindowsService?: ActiveWindowsService | undefined;
  headerPortalTarget: HTMLDivElement | null;
  route: AppRoute;
  savedWindowsService?: SavedWindowsService | undefined;
  settingsService: SettingsService;
}) {
  switch (route) {
    case APP_ROUTES.savedWindows:
      return (
        <SavedWindowsPage headerPortalTarget={headerPortalTarget} service={savedWindowsService} />
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
  const { snapshot: navigationActiveWindows } = useActiveWindows(resolvedActiveWindowsService);
  const { status: savedWindowsStatus, windows: navigationSavedWindows } = useSavedWindows(
    resolvedSavedWindowsService,
  );
  const { errorMessage, isLoading, savingSettings, setColorMode, settings } =
    useSettings(resolvedSettingsService);
  useAppearance(settings.colorMode);

  const activeWindowCount = navigationActiveWindows?.windows.length ?? null;
  const savedWindowCount =
    savedWindowsStatus === 'ready'
      ? navigationSavedWindows.length > 0
        ? navigationSavedWindows.length
        : undefined
      : null;

  return (
    <div className="app-shell">
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
          <h1>{PAGE_TITLES[route]}</h1>
          <div className="topbar-page-status" ref={setHeaderPortalTarget} />
        </div>
        <div className="topbar-actions">
          {errorMessage ? (
            <span className="topbar-settings-error" role="alert" title={errorMessage}>
              <CircleAlert aria-hidden="true" size={16} />
              <span className="sr-only">{errorMessage}</span>
            </span>
          ) : null}
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
          route={route}
          savedWindowsService={resolvedSavedWindowsService}
          settingsService={resolvedSettingsService}
        />
      </main>
    </div>
  );
}
