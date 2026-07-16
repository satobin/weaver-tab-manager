import { useSyncExternalStore } from 'react';

import { type ActiveWindowsService } from './chromeActiveWindowsService';
import { type ActiveWindowsSnapshot } from './model';

const EVENT_REFRESH_DELAY_MS = 100;

export interface ActiveWindowsState {
  errorMessage: string | null;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
  snapshot: ActiveWindowsSnapshot | null;
  status: 'error' | 'loading' | 'ready';
}

export type ActiveWindowsDataSource = Pick<ActiveWindowsService, 'loadSnapshot' | 'subscribe'>;

type ActiveWindowsStoreState = Omit<ActiveWindowsState, 'refresh'>;

function describeLoadError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'The browser did not return window and tab data.';
}

function retainFocusedWindow(
  snapshot: ActiveWindowsSnapshot,
  lastFocusedWindowId: number | null,
): { focusedWindowId: number | null; snapshot: ActiveWindowsSnapshot } {
  const reportedFocusedWindow = snapshot.windows.find((window) => window.focused);
  const retainedFocusedWindow = snapshot.windows.find(
    (window) => window.id === lastFocusedWindowId,
  );
  const focusedWindowId =
    reportedFocusedWindow?.id ??
    retainedFocusedWindow?.id ??
    snapshot.windows.find((window) => window.isCurrent)?.id ??
    null;

  if (reportedFocusedWindow) {
    return { focusedWindowId, snapshot };
  }

  return {
    focusedWindowId,
    snapshot: {
      ...snapshot,
      windows: snapshot.windows.map((window) => ({
        ...window,
        focused: window.id === focusedWindowId,
      })),
    },
  };
}

class ActiveWindowsStore {
  private changedWhileHidden = false;
  private followUpRefreshNeeded = false;
  private inFlightRefresh: Promise<void> | null = null;
  private lastFocusedWindowId: number | null = null;
  private readonly listeners = new Set<() => void>();
  private refreshTimer: number | undefined;
  private state: ActiveWindowsStoreState = {
    errorMessage: null,
    isRefreshing: true,
    snapshot: null,
    status: 'loading',
  };
  private unsubscribeFromSource: (() => void) | null = null;

  constructor(private readonly source: ActiveWindowsDataSource) {}

  readonly getSnapshot = (): ActiveWindowsStoreState => this.state;

  readonly refresh = (): Promise<void> => {
    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }

    this.setState({
      ...this.state,
      errorMessage: null,
      isRefreshing: true,
      status: this.state.snapshot ? 'ready' : 'loading',
    });

    const operation = this.source
      .loadSnapshot()
      .then((loadedSnapshot) => {
        const retained = retainFocusedWindow(loadedSnapshot, this.lastFocusedWindowId);
        this.lastFocusedWindowId = retained.focusedWindowId;
        this.setState({
          errorMessage: null,
          isRefreshing: false,
          snapshot: retained.snapshot,
          status: 'ready',
        });
      })
      .catch((error: unknown) => {
        this.setState({
          errorMessage: describeLoadError(error),
          isRefreshing: false,
          snapshot: this.state.snapshot,
          status: this.state.snapshot ? 'ready' : 'error',
        });
      })
      .finally(() => {
        this.inFlightRefresh = null;
        if (this.followUpRefreshNeeded && this.unsubscribeFromSource) {
          this.followUpRefreshNeeded = false;
          window.queueMicrotask(() => {
            if (this.unsubscribeFromSource && !this.inFlightRefresh) {
              void this.refresh();
            }
          });
        }
      });

    this.inFlightRefresh = operation;
    return operation;
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.start();
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop();
      }
    };
  };

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && this.changedWhileHidden) {
      this.changedWhileHidden = false;
      this.scheduleRefresh();
    }
  };

  private scheduleRefresh = () => {
    if (document.visibilityState !== 'visible') {
      this.changedWhileHidden = true;
      return;
    }

    if (this.refreshTimer !== undefined) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      if (this.inFlightRefresh) {
        this.followUpRefreshNeeded = true;
        return;
      }
      void this.refresh();
    }, EVENT_REFRESH_DELAY_MS);
  };

  private setState(nextState: ActiveWindowsStoreState) {
    this.state = nextState;
    this.listeners.forEach((listener) => listener());
  }

  private start() {
    this.unsubscribeFromSource = this.source.subscribe(this.scheduleRefresh);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.queueMicrotask(() => {
      if (this.unsubscribeFromSource) {
        void this.refresh();
      }
    });
  }

  private stop() {
    this.unsubscribeFromSource?.();
    this.unsubscribeFromSource = null;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.refreshTimer !== undefined) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.changedWhileHidden = false;
    this.followUpRefreshNeeded = false;
  }
}

const stores = new WeakMap<ActiveWindowsDataSource, ActiveWindowsStore>();

function getActiveWindowsStore(source: ActiveWindowsDataSource): ActiveWindowsStore {
  const existing = stores.get(source);
  if (existing) {
    return existing;
  }

  const store = new ActiveWindowsStore(source);
  stores.set(source, store);
  return store;
}

export function useActiveWindows(service: ActiveWindowsDataSource): ActiveWindowsState {
  const store = getActiveWindowsStore(service);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...state, refresh: store.refresh };
}
