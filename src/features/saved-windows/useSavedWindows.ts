import { useCallback, useEffect, useRef, useState } from 'react';

import { type SavedWindow } from './savedWindowModel';
import { type SavedWindowsService } from './savedWindowsService';

export interface SavedWindowsState {
  cleanupNotice: string | null;
  dismissCleanupNotice: () => Promise<void>;
  errorMessage: string | null;
  refresh: () => Promise<void>;
  status: 'error' | 'loading' | 'ready';
  windows: SavedWindow[];
}

export type SavedWindowsReadService = Pick<
  SavedWindowsService,
  'dismissCleanupNotice' | 'load' | 'loadCleanupNotice' | 'subscribe'
>;

function describeLoadError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'The browser could not load saved windows.';
}

export function useSavedWindows(service: SavedWindowsReadService): SavedWindowsState {
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const [state, setState] = useState<Omit<SavedWindowsState, 'dismissCleanupNotice' | 'refresh'>>({
    cleanupNotice: null,
    errorMessage: null,
    status: 'loading',
    windows: [],
  });

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState((current) => ({
      ...current,
      errorMessage: null,
      status: current.status === 'ready' ? 'ready' : 'loading',
    }));

    try {
      const windows = await service.load();
      let cleanupNotice: string | null | undefined = null;
      if (service.loadCleanupNotice) {
        try {
          cleanupNotice = await service.loadCleanupNotice();
        } catch {
          cleanupNotice = undefined;
        }
      }
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return;
      }
      setState((current) => ({
        cleanupNotice: cleanupNotice === undefined ? current.cleanupNotice : cleanupNotice,
        errorMessage: null,
        status: 'ready',
        windows,
      }));
    } catch (error) {
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return;
      }
      setState((current) => ({
        ...current,
        errorMessage: describeLoadError(error),
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
