import { useCallback, useEffect, useRef, useState } from 'react';

import { type ActiveWindowsService } from '../features/active-windows/chromeActiveWindowsService';
import { type SavedWindowsService } from '../features/saved-windows/savedWindowsService';

function useSubscribedCount(
  load: () => Promise<number>,
  subscribe: (listener: () => void) => () => void,
): number | null {
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const refresh = async () => {
      const requestId = ++requestIdRef.current;
      try {
        const nextCount = await load();
        if (mountedRef.current && requestId === requestIdRef.current) {
          setCount(nextCount);
        }
      } catch {
        // Navigation badges are supplementary; page-level errors remain authoritative.
      }
    };
    const unsubscribe = subscribe(() => void refresh());
    window.queueMicrotask(() => void refresh());

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      unsubscribe();
    };
  }, [load, subscribe]);

  return count;
}

export function useActiveWindowCount(service: ActiveWindowsService): number | null {
  const load = useCallback(
    () =>
      service.loadWindowCount?.() ??
      service.loadSnapshot().then((snapshot) => snapshot.windows.length),
    [service],
  );
  const subscribe = useCallback(
    (listener: () => void) =>
      service.subscribeWindowCount?.(listener) ?? service.subscribe(listener),
    [service],
  );

  return useSubscribedCount(load, subscribe);
}

export function useSavedWindowCount(service: SavedWindowsService): number | null {
  const load = useCallback(
    () => service.loadCount?.() ?? service.load().then((windows) => windows.length),
    [service],
  );
  const subscribe = useCallback(
    (listener: () => void) => service.subscribeCount?.(listener) ?? service.subscribe(listener),
    [service],
  );

  return useSubscribedCount(load, subscribe);
}
