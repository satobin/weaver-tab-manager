import { useCallback, useEffect, useRef, useState } from 'react';

import { type SavedWindow } from './savedWindowModel';
import { type SavedWindowsService } from './savedWindowsService';

export interface SavedWindowsState {
  cleanupNotice: string | null;
  dismissCleanupNotice: () => Promise<void>;
  errorMessage: string | null;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
  status: 'error' | 'loading' | 'ready';
  windows: SavedWindow[];
}

function describeLoadError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'The browser could not load saved windows.';
}

export function useSavedWindows(service: SavedWindowsService): SavedWindowsState {
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const [state, setState] = useState<Omit<SavedWindowsState, 'dismissCleanupNotice' | 'refresh'>>({
    cleanupNotice: null,
    errorMessage: null,
    isRefreshing: true,
    status: 'loading',
    windows: [],
  });

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState((current) => ({
      ...current,
      errorMessage: null,
      isRefreshing: true,
      status: current.status === 'ready' ? 'ready' : 'loading',
    }));

    try {
      const windows = await service.load();
      const cleanupNotice = (await service.loadCleanupNotice?.()) ?? null;
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return;
      }
      setState({
        cleanupNotice,
        errorMessage: null,
        isRefreshing: false,
        status: 'ready',
        windows,
      });
    } catch (error) {
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return;
      }
      setState((current) => ({
        ...current,
        errorMessage: describeLoadError(error),
        isRefreshing: false,
        status: current.status === 'ready' ? 'ready' : 'error',
      }));
    }
  }, [service]);

  const dismissCleanupNotice = useCallback(async () => {
    await service.dismissCleanupNotice?.();
    if (mountedRef.current) {
      setState((current) => ({ ...current, cleanupNotice: null }));
    }
  }, [service]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = service.subscribe(() => void refresh());
    window.queueMicrotask(() => void refresh());

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      unsubscribe();
    };
  }, [refresh, service]);

  return { ...state, dismissCleanupNotice, refresh };
}
