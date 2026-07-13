import { type ManagedWindow } from './model';
import { formatWindowLabel } from './windowLabel';

export interface WindowCardBounds {
  bottom: number;
  id: number;
  left: number;
  right: number;
  top: number;
}

export interface WindowDropPlacement {
  anchorWindowId: number;
  placement: 'after' | 'before';
}

export function reconcileWindowOrder(
  windows: readonly ManagedWindow[],
  preferredOrder: readonly number[],
): number[] {
  const availableIds = new Set(windows.map((window) => window.id));
  const currentWindowId = windows.find((window) => window.isCurrent)?.id;
  const result: number[] = [];

  if (currentWindowId !== undefined) {
    result.push(currentWindowId);
  }

  const addWindowId = (windowId: number) => {
    if (availableIds.has(windowId) && windowId !== currentWindowId && !result.includes(windowId)) {
      result.push(windowId);
    }
  };
  preferredOrder.forEach(addWindowId);
  windows.forEach((window) => addWindowId(window.id));
  return result;
}

export function orderAndLabelWindows(
  windows: readonly ManagedWindow[],
  preferredOrder: readonly number[],
): ManagedWindow[] {
  const windowsById = new Map(windows.map((window) => [window.id, window]));
  let windowNumber = 1;
  return reconcileWindowOrder(windows, preferredOrder).flatMap((windowId) => {
    const window = windowsById.get(windowId);
    if (!window) {
      return [];
    }
    return [
      {
        ...window,
        label: formatWindowLabel(windowNumber++),
      },
    ];
  });
}

export function insertWindowBefore(
  order: readonly number[],
  windowId: number,
  beforeWindowId: number | null,
  currentWindowId: number | undefined,
): number[] {
  const next = order.filter((candidate) => candidate !== windowId);
  const requestedIndex =
    beforeWindowId === null
      ? next.length
      : next.findIndex((candidate) => candidate === beforeWindowId);
  const insertionIndex = Math.max(
    currentWindowId !== undefined && next[0] === currentWindowId ? 1 : 0,
    requestedIndex < 0 ? next.length : requestedIndex,
  );
  next.splice(insertionIndex, 0, windowId);
  return next;
}

function distanceToRectangle(x: number, y: number, bounds: WindowCardBounds): number {
  const horizontalDistance =
    x < bounds.left ? bounds.left - x : x > bounds.right ? x - bounds.right : 0;
  const verticalDistance =
    y < bounds.top ? bounds.top - y : y > bounds.bottom ? y - bounds.bottom : 0;
  return horizontalDistance ** 2 + verticalDistance ** 2;
}

export function findClosestWindowDropPlacement(
  cards: readonly WindowCardBounds[],
  pointer: { x: number; y: number },
): WindowDropPlacement | null {
  let closest: WindowCardBounds | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const card of cards) {
    const distance = distanceToRectangle(pointer.x, pointer.y, card);
    if (distance < closestDistance) {
      closest = card;
      closestDistance = distance;
    }
  }

  if (!closest) {
    return null;
  }
  return {
    anchorWindowId: closest.id,
    placement: pointer.y < (closest.top + closest.bottom) / 2 ? 'before' : 'after',
  };
}
