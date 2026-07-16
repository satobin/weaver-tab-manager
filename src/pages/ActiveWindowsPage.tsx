import {
  AlertTriangle,
  AppWindow,
  ArrowDownAZ,
  ArrowUpZA,
  CopyX,
  ListChecks,
  Merge,
  PanelsTopLeft,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  createChromeActiveWindowsService,
  type ActiveWindowsService,
  type RestorableTab,
  type RestoreTabFailure,
  type TabOperationFailure,
  type WindowOperationFailure,
} from '../features/active-windows/chromeActiveWindowsService';
import { MergeWindowsDialog } from '../features/active-windows/MergeWindowsDialog';
import { getMergeDialogHorizontalOffset } from '../features/active-windows/mergeDialogPosition';
import {
  filterActiveWindows,
  isTabSuspended,
  type ManagedWindow,
} from '../features/active-windows/model';
import { createRestorableTabs } from '../features/active-windows/restorableTabs';
import { type ToggleTabSelection } from '../features/active-windows/selection';
import {
  type SortCriterion,
  type SortDirection,
  type TabSortOptions,
} from '../features/active-windows/tabSort';
import { useActiveWindows } from '../features/active-windows/useActiveWindows';
import { useTabSelection } from '../features/active-windows/useTabSelection';
import { SortCriterionMenu } from '../features/active-windows/SortCriterionMenu';
import {
  type TabDragPayload,
  type TabDropTarget,
  WindowCard,
} from '../features/active-windows/WindowCard';
import {
  distributeAcrossWindowColumns,
  estimateWindowCardHeight,
  getWindowColumnCount,
} from '../features/active-windows/windowColumns';
import {
  findClosestWindowDropPlacement,
  insertWindowBefore,
  orderAndLabelWindows,
  reconcileWindowOrder,
  type WindowCardBounds,
  type WindowDropPlacement,
} from '../features/active-windows/windowDisplayOrder';
import { planDuplicateTabs } from '../features/deduplication/deduplication';
import { SaveWindowDialog } from '../features/saved-windows/SaveWindowDialog';
import {
  createSavedWindowsService,
  type SaveWindowResult,
  type SavedWindowsService,
} from '../features/saved-windows/savedWindowsService';
import { createSettingsService, type SettingsService } from '../features/settings/settingsService';
import { useSettings } from '../features/settings/useSettings';
import { EmptyState } from '../ui/EmptyState';

interface ActiveWindowsPageProps {
  actionPortalTarget?: Element | null;
  headerPortalTarget?: Element | null;
  savedWindowsService?: SavedWindowsService | undefined;
  service?: ActiveWindowsService | undefined;
  settingsService?: SettingsService | undefined;
}

const EMPTY_WINDOWS: readonly ManagedWindow[] = [];
type WindowSortSelection = Pick<TabSortOptions, 'criterion' | 'direction'>;
interface NewWindowDropTarget {
  anchorWindowId: number;
  beforeWindowId: number | null;
  placement: WindowDropPlacement['placement'];
}
interface PointerPosition {
  x: number;
  y: number;
}
interface PendingNewWindowDropTarget {
  origin: PointerPosition;
  target: NewWindowDropTarget;
}
interface TabDragSession extends TabDragPayload {
  handled: boolean;
}
const DEFAULT_WINDOW_SORT_SELECTION: WindowSortSelection = {
  criterion: 'title',
  direction: 'asc',
};
const NEW_WINDOW_TARGET_SWITCH_DISTANCE = 12;

function newWindowTargetsMatch(
  first: NewWindowDropTarget | null,
  second: NewWindowDropTarget | null,
): boolean {
  return (
    first?.anchorWindowId === second?.anchorWindowId &&
    first?.beforeWindowId === second?.beforeWindowId &&
    first?.placement === second?.placement
  );
}

function pointerDistance(first: PointerPosition, second: PointerPosition): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function pluralize(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function summarizeFailures(
  verb: string,
  failures: readonly TabOperationFailure[],
  warnings: readonly string[] = [],
): string | null {
  const parts: string[] = [];
  if (failures.length > 0) {
    parts.push(
      `${pluralize(failures.length, 'tab')} could not be ${verb}. ${failures[0]?.message ?? ''}`.trim(),
    );
  }
  if (warnings.length > 0) {
    parts.push(warnings.join(' '));
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function summarizeWindowFailures(
  failures: readonly WindowOperationFailure[],
  warnings: readonly string[],
): string | null {
  const parts: string[] = [];
  if (failures.length > 0) {
    parts.push(
      `${pluralize(failures.length, 'window')} could not be sorted. ${failures[0]?.message ?? ''}`.trim(),
    );
  }
  if (warnings.length > 0) {
    parts.push(warnings.join(' '));
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function summarizeRestoreFailures(
  failures: readonly RestoreTabFailure[],
  warnings: readonly string[],
): string | null {
  const parts: string[] = [];
  if (failures.length > 0) {
    parts.push(
      `${pluralize(failures.length, 'tab')} could not be restored. ${failures[0]?.message ?? ''}`.trim(),
    );
  }
  if (warnings.length > 0) {
    parts.push(warnings.join(' '));
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

export function ActiveWindowsPage({
  actionPortalTarget,
  headerPortalTarget,
  savedWindowsService: providedSavedWindowsService,
  service: providedService,
  settingsService: providedSettingsService,
}: ActiveWindowsPageProps) {
  const service = useMemo(
    () => providedService ?? createChromeActiveWindowsService(),
    [providedService],
  );
  const settingsService = useMemo(
    () => providedSettingsService ?? createSettingsService(),
    [providedSettingsService],
  );
  const savedWindowsService = useMemo(
    () => providedSavedWindowsService ?? createSavedWindowsService(),
    [providedSavedWindowsService],
  );
  const { errorMessage, refresh, snapshot: liveSnapshot, status } = useActiveWindows(service);
  const {
    errorMessage: settingsError,
    isLoading: settingsLoading,
    settings,
  } = useSettings(settingsService);
  const [windowOrderIds, setWindowOrderIds] = useState<readonly number[]>([]);
  const snapshot = useMemo(
    () =>
      liveSnapshot
        ? {
            ...liveSnapshot,
            windows: orderAndLabelWindows(liveSnapshot.windows, windowOrderIds),
          }
        : null,
    [liveSnapshot, windowOrderIds],
  );
  const selection = useTabSelection(snapshot?.windows ?? EMPTY_WINDOWS);
  const [selectedGroupIds, setSelectedGroupIds] = useState<ReadonlySet<number>>(() => new Set());
  const [collapsedWindowIds, setCollapsedWindowIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [query, setQuery] = useState('');
  const [sortCriterion, setSortCriterion] = useState<SortCriterion>('title');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [windowSortSelections, setWindowSortSelections] = useState<
    ReadonlyMap<number, WindowSortSelection>
  >(() => new Map());
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeDialogHorizontalOffset, setMergeDialogHorizontalOffset] = useState(0);
  const [mergeDestinationWindowId, setMergeDestinationWindowId] = useState<number | null>(null);
  const [mergeSourceWindowIds, setMergeSourceWindowIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [draggedGroupId, setDraggedGroupId] = useState<number | null>(null);
  const [draggedTabIds, setDraggedTabIds] = useState<ReadonlySet<number>>(() => new Set());
  const [tabDropTarget, setTabDropTarget] = useState<TabDropTarget | null>(null);
  const [newWindowDropTarget, setNewWindowDropTarget] = useState<NewWindowDropTarget | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  const [duplicateUndoTabs, setDuplicateUndoTabs] = useState<readonly RestorableTab[] | null>(null);
  const [operationLabel, setOperationLabel] = useState<string | null>(null);
  const [saveWindowId, setSaveWindowId] = useState<number | null>(null);
  const [windowColumnCount, setWindowColumnCount] = useState(1);
  const [windowGridElement, setWindowGridElement] = useState<HTMLDivElement | null>(null);
  const operationInFlightRef = useRef(false);
  const dragSessionRef = useRef<TabDragSession | null>(null);
  const dragWindowCardBoundsRef = useRef<readonly WindowCardBounds[]>([]);
  const newWindowDropTargetRef = useRef<NewWindowDropTarget | null>(null);
  const pendingNewWindowDropTargetRef = useRef<PendingNewWindowDropTarget | null>(null);
  const cardTargetPointerRef = useRef<PointerPosition | null>(null);
  const mergeButtonRef = useRef<HTMLButtonElement>(null);
  const mergeControlRef = useRef<HTMLDivElement>(null);
  const saveWindowTriggerRef = useRef<HTMLButtonElement | null>(null);
  const updateMergeDialogPosition = useCallback(() => {
    const buttonLeft = mergeButtonRef.current?.getBoundingClientRect().left;
    if (buttonLeft === undefined) {
      return;
    }
    setMergeDialogHorizontalOffset(getMergeDialogHorizontalOffset(buttonLeft, window.innerWidth));
  }, []);
  const filtered = useMemo(
    () => (snapshot ? filterActiveWindows(snapshot, query) : null),
    [query, snapshot],
  );
  const filteredWindowCount = filtered?.windows.length ?? 0;
  const windowColumns = useMemo(
    () =>
      distributeAcrossWindowColumns(
        filtered?.windows ?? EMPTY_WINDOWS,
        windowColumnCount,
        (window) =>
          estimateWindowCardHeight(window, settings.showTabUrls, collapsedWindowIds.has(window.id)),
      ),
    [collapsedWindowIds, filtered?.windows, settings.showTabUrls, windowColumnCount],
  );

  const updateNewWindowDropTarget = (target: NewWindowDropTarget | null) => {
    if (newWindowTargetsMatch(newWindowDropTargetRef.current, target)) {
      return;
    }
    newWindowDropTargetRef.current = target;
    setNewWindowDropTarget(target);
  };

  const clearNewWindowDropTarget = () => {
    pendingNewWindowDropTargetRef.current = null;
    updateNewWindowDropTarget(null);
  };

  const getDocumentPointer = (pointer: PointerPosition): PointerPosition => ({
    x: pointer.x + window.scrollX,
    y: pointer.y + window.scrollY,
  });

  const captureWindowCardBounds = (): WindowCardBounds[] => {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    return Array.from(
      windowGridElement?.querySelectorAll<HTMLElement>('.window-card[data-window-id]') ?? [],
    ).flatMap((element) => {
      const id = Number(element.dataset.windowId);
      if (!Number.isInteger(id)) {
        return [];
      }
      const bounds = element.getBoundingClientRect();
      return [
        {
          bottom: bounds.bottom + scrollY,
          id,
          left: bounds.left + scrollX,
          right: bounds.right + scrollX,
          top: bounds.top + scrollY,
        },
      ];
    });
  };

  const resetDragTargetState = () => {
    dragWindowCardBoundsRef.current = [];
    cardTargetPointerRef.current = null;
    clearNewWindowDropTarget();
  };

  useEffect(() => {
    if (!windowGridElement || typeof ResizeObserver === 'undefined') {
      return;
    }

    const updateColumnCount = (width: number) => {
      const nextColumnCount = getWindowColumnCount(width, filteredWindowCount);
      setWindowColumnCount((current) => (current === nextColumnCount ? current : nextColumnCount));
    };
    updateColumnCount(windowGridElement.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      updateColumnCount(entries[0]?.contentRect.width ?? windowGridElement.clientWidth);
    });
    observer.observe(windowGridElement);
    return () => observer.disconnect();
  }, [filteredWindowCount, windowGridElement]);

  useEffect(() => {
    if (!mergeDialogOpen) {
      return;
    }
    window.addEventListener('resize', updateMergeDialogPosition);
    return () => window.removeEventListener('resize', updateMergeDialogPosition);
  }, [mergeDialogOpen, updateMergeDialogPosition]);

  const visibleTabIds = useMemo(
    () => filtered?.windows.flatMap((window) => window.tabs.map((tab) => tab.id)) ?? [],
    [filtered],
  );
  const hasFilter = query.trim().length > 0;
  const selectionButtonClears = selection.selectedCount > 0;
  const selectedTabIdsInOrder = useMemo(
    () =>
      snapshot?.windows.flatMap((window) =>
        window.tabs.flatMap((tab) => (selection.selectedIds.has(tab.id) ? [tab.id] : [])),
      ) ?? [],
    [selection.selectedIds, snapshot],
  );
  const validSelectedGroupIds = useMemo(() => {
    const validGroupIds = new Set<number>();
    snapshot?.windows.forEach((window) => {
      window.groups.forEach((group) => {
        if (!selectedGroupIds.has(group.id)) {
          return;
        }
        const groupTabIds = window.tabs.flatMap((tab) =>
          tab.groupId === group.id ? [tab.id] : [],
        );
        if (
          groupTabIds.length > 0 &&
          groupTabIds.every((tabId) => selection.selectedIds.has(tabId))
        ) {
          validGroupIds.add(group.id);
        }
      });
    });
    return validGroupIds;
  }, [selectedGroupIds, selection.selectedIds, snapshot]);
  const selectedGroupIdsInOrder = useMemo(
    () =>
      snapshot?.windows.flatMap((window) =>
        window.groups.flatMap((group) => (validSelectedGroupIds.has(group.id) ? [group.id] : [])),
      ) ?? [],
    [snapshot, validSelectedGroupIds],
  );
  const selectedTabIsOnlyTabInWindow = useMemo(() => {
    if (!snapshot || selectedTabIdsInOrder.length !== 1) {
      return false;
    }
    const selectedTabId = selectedTabIdsInOrder[0];
    return snapshot.windows.some(
      (window) => window.tabs.length === 1 && window.tabs[0]?.id === selectedTabId,
    );
  }, [selectedTabIdsInOrder, snapshot]);
  const canMoveSelectedTabsToNewWindow =
    selectedTabIdsInOrder.length > 0 && !selectedTabIsOnlyTabInWindow;
  const resolvedMergeDestinationId = useMemo(() => {
    if (
      mergeDestinationWindowId !== null &&
      snapshot?.windows.some((window) => window.id === mergeDestinationWindowId)
    ) {
      return mergeDestinationWindowId;
    }
    return snapshot?.windows[0]?.id ?? null;
  }, [mergeDestinationWindowId, snapshot]);
  const orderedMergeSourceIds = useMemo(
    () =>
      snapshot?.windows.flatMap((window) =>
        window.id !== resolvedMergeDestinationId && mergeSourceWindowIds.has(window.id)
          ? [window.id]
          : [],
      ) ?? [],
    [mergeSourceWindowIds, resolvedMergeDestinationId, snapshot],
  );
  const visibleMergeSourceIds = useMemo(
    () => new Set(orderedMergeSourceIds),
    [orderedMergeSourceIds],
  );
  const duplicatePlan = useMemo(() => {
    const tabs = snapshot?.windows.flatMap((window) => window.tabs) ?? [];
    const preferredWindow =
      snapshot?.windows.find((window) => window.isCurrent) ??
      snapshot?.windows.find((window) => window.focused);
    return planDuplicateTabs(
      tabs,
      settings.advancedDuplicateMatchingEnabled ? settings.deduplicationRules : [],
      {
        tabId: preferredWindow?.tabs.find((tab) => tab.active)?.id,
        windowId: preferredWindow?.id,
      },
    );
  }, [settings.advancedDuplicateMatchingEnabled, settings.deduplicationRules, snapshot]);
  const saveWindowTarget = snapshot?.windows.find((window) => window.id === saveWindowId) ?? null;

  const beginOperation = (label: string | null, resetFeedback = true) => {
    if (operationInFlightRef.current) {
      return false;
    }
    operationInFlightRef.current = true;
    if (resetFeedback) {
      setOperationError(null);
      setOperationNotice(null);
      setDuplicateUndoTabs(null);
    }
    setOperationLabel(label);
    return true;
  };

  const finishOperation = () => {
    operationInFlightRef.current = false;
    setOperationLabel(null);
  };

  const updateWindowSortSelection = (windowId: number, update: Partial<WindowSortSelection>) => {
    setWindowSortSelections((current) => {
      const next = new Map(current);
      next.set(windowId, {
        ...(current.get(windowId) ?? DEFAULT_WINDOW_SORT_SELECTION),
        ...update,
      });
      return next;
    });
  };

  const toggleWindowCollapsed = (windowId: number) => {
    setCollapsedWindowIds((current) => {
      const next = new Set(current);
      if (next.has(windowId)) {
        next.delete(windowId);
      } else {
        next.add(windowId);
      }
      return next;
    });
  };

  const closeMergeDialog = useCallback((restoreFocus = true) => {
    setMergeDialogOpen(false);
    if (restoreFocus) {
      queueMicrotask(() => mergeButtonRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!mergeDialogOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      const targetElement = target instanceof Element ? target : null;
      if (
        target instanceof Node &&
        !mergeControlRef.current?.contains(target) &&
        !targetElement?.closest('.merge-destination-popover')
      ) {
        closeMergeDialog(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [closeMergeDialog, mergeDialogOpen]);

  const closeSaveWindowDialog = useCallback(() => {
    setSaveWindowId(null);
    queueMicrotask(() => saveWindowTriggerRef.current?.focus());
  }, []);

  const openSaveWindowDialog = (windowId: number, trigger: HTMLButtonElement) => {
    saveWindowTriggerRef.current = trigger;
    setMergeDialogOpen(false);
    setSaveWindowId(windowId);
  };

  const completeSaveWindow = (result: SaveWindowResult) => {
    const warningText = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
    setDuplicateUndoTabs(null);
    setOperationNotice(`Saved "${result.savedWindow.name}".${warningText}`);
    closeSaveWindowDialog();
    void refresh();
  };

  const clearSelectedGroupIntentForTabs = (tabIds: readonly number[]) => {
    if (selectedGroupIds.size === 0 || tabIds.length === 0) {
      return;
    }
    const affectedTabIds = new Set(tabIds);
    const affectedGroupIds = new Set(
      snapshot?.windows.flatMap((window) =>
        window.tabs.flatMap((tab) =>
          tab.groupId !== null && affectedTabIds.has(tab.id) ? [tab.groupId] : [],
        ),
      ) ?? [],
    );
    if (affectedGroupIds.size === 0) {
      return;
    }
    setSelectedGroupIds((current) => {
      const next = new Set([...current].filter((groupId) => !affectedGroupIds.has(groupId)));
      return next.size === current.size ? current : next;
    });
  };

  const clearSelection = () => {
    selection.clear();
    setSelectedGroupIds((current) => (current.size === 0 ? current : new Set()));
  };

  const setTabsSelected = (tabIds: readonly number[], checked: boolean) => {
    clearSelectedGroupIntentForTabs(tabIds);
    selection.setTabs(tabIds, checked);
  };

  const toggleTabSelected = (nextSelection: ToggleTabSelection) => {
    const affectedTabIds = snapshot?.windows
      .find((window) => window.id === nextSelection.windowId)
      ?.tabs.map((tab) => tab.id) ?? [nextSelection.tabId];
    clearSelectedGroupIntentForTabs(affectedTabIds);
    selection.toggleTab(nextSelection);
  };

  const updateQuery = (nextQuery: string) => {
    if (query.trim() && !nextQuery.trim()) {
      clearSelection();
    }
    setQuery(nextQuery);
  };

  const toggleFilteredSelection = () => {
    if (selectionButtonClears) {
      clearSelection();
      return;
    }
    setTabsSelected(visibleTabIds, true);
  };

  const setGroupSelected = (groupId: number, tabIds: readonly number[], checked: boolean) => {
    selection.setTabs(tabIds, checked);
    setSelectedGroupIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(groupId);
      } else {
        next.delete(groupId);
      }
      return next;
    });
  };

  const focusWindow = async (windowId: number) => {
    setNavigationError(null);
    try {
      await service.focusWindow(windowId);
    } catch {
      setNavigationError('The browser could not focus that window.');
    }
  };

  const focusTab = async (windowId: number, tabId: number) => {
    setNavigationError(null);
    try {
      await service.focusTab(windowId, tabId);
    } catch {
      setNavigationError('The browser could not focus that tab.');
    }
  };

  const suspendWindowTabs = async (windowId: number) => {
    const tabIds =
      snapshot?.windows
        .find((window) => window.id === windowId)
        ?.tabs.filter((tab) => !tab.active && !isTabSuspended(tab))
        .map((tab) => tab.id) ?? [];
    if (tabIds.length === 0 || !beginOperation(`Suspending ${pluralize(tabIds.length, 'tab')}`)) {
      return;
    }

    try {
      const result = await service.suspendTabs(tabIds);
      setOperationError(summarizeFailures('suspended', result.failures));
      await refresh();
    } catch {
      setOperationError('The browser could not suspend tabs in that window.');
    } finally {
      finishOperation();
    }
  };

  const unsuspendWindowTabs = async (windowId: number) => {
    const tabIds =
      snapshot?.windows
        .find((window) => window.id === windowId)
        ?.tabs.filter(isTabSuspended)
        .map((tab) => tab.id) ?? [];
    if (tabIds.length === 0 || !beginOperation(`Unsuspending ${pluralize(tabIds.length, 'tab')}`)) {
      return;
    }

    try {
      const result = await service.unsuspendTabs(tabIds);
      setOperationError(summarizeFailures('unsuspended', result.failures));
      await refresh();
    } catch {
      setOperationError('The browser could not unsuspend tabs in that window.');
    } finally {
      finishOperation();
    }
  };

  const unsuspendTab = async (tabId: number) => {
    const tabIsStillSuspended =
      snapshot?.windows.some((window) =>
        window.tabs.some((tab) => tab.id === tabId && isTabSuspended(tab)),
      ) ?? false;
    if (!tabIsStillSuspended) {
      return;
    }
    if (!beginOperation('Unsuspending 1 tab')) {
      return;
    }

    try {
      const result = await service.unsuspendTabs([tabId]);
      setOperationError(summarizeFailures('unsuspended', result.failures));
      await refresh();
    } catch {
      setOperationError('The browser could not unsuspend that tab.');
    } finally {
      finishOperation();
    }
  };

  const closeTab = async (tabId: number) => {
    if (!beginOperation('Closing tab')) {
      return;
    }
    try {
      const result = await service.closeTabs([tabId]);
      setTabsSelected(result.closedTabIds, false);
      setOperationError(summarizeFailures('closed', result.failures));
      await refresh();
    } catch {
      setOperationError('The browser could not close that tab.');
    } finally {
      finishOperation();
    }
  };

  const closeSelectedTabs = async () => {
    if (
      selectedTabIdsInOrder.length === 0 ||
      !beginOperation(`Closing ${pluralize(selectedTabIdsInOrder.length, 'tab')}`)
    ) {
      return;
    }
    try {
      const result = await service.closeTabs(selectedTabIdsInOrder);
      if (result.failures.length === 0) {
        clearSelection();
      } else {
        setTabsSelected(result.closedTabIds, false);
      }
      setOperationError(summarizeFailures('closed', result.failures));
      await refresh();
    } catch {
      setOperationError('The browser could not close the selected tabs.');
    } finally {
      finishOperation();
    }
  };

  const moveSelectedTabs = async () => {
    if (
      !canMoveSelectedTabsToNewWindow ||
      !beginOperation(`Moving ${pluralize(selectedTabIdsInOrder.length, 'tab')}`)
    ) {
      return;
    }
    try {
      const result = await service.moveTabsToNewWindow(
        selectedTabIdsInOrder,
        selectedGroupIdsInOrder,
      );
      if (result.failures.length === 0) {
        clearSelection();
      } else {
        setTabsSelected(result.movedTabIds, false);
      }
      setQuery('');
      setOperationError(summarizeFailures('moved', result.failures, result.warnings));
      await refresh();
    } catch {
      setOperationError('The browser could not move the selected tabs into a new window.');
    } finally {
      finishOperation();
    }
  };

  const closeWindow = async (windowId: number) => {
    if (!beginOperation('Closing window')) {
      return;
    }
    try {
      await service.closeWindow(windowId);
      clearSelectedGroupIntentForTabs(
        snapshot?.windows.find((window) => window.id === windowId)?.tabs.map((tab) => tab.id) ?? [],
      );
      await refresh();
    } catch {
      setOperationError('The browser could not close that window.');
    } finally {
      finishOperation();
    }
  };

  const removeDuplicateTabs = async () => {
    const undoCandidates = snapshot
      ? createRestorableTabs(snapshot, duplicatePlan.duplicateTabIds)
      : [];
    if (
      duplicatePlan.duplicateTabIds.length === 0 ||
      settingsLoading ||
      !beginOperation(`Removing ${pluralize(duplicatePlan.duplicateTabIds.length, 'duplicate')}`)
    ) {
      return;
    }

    try {
      const result = await service.closeTabs(duplicatePlan.duplicateTabIds);
      setTabsSelected(result.closedTabIds, false);
      setOperationError(summarizeFailures('closed', result.failures));
      if (result.closedTabIds.length > 0) {
        const closedTabIds = new Set(result.closedTabIds);
        const closedTabs = undoCandidates.filter((tab) => closedTabIds.has(tab.originalTabId));
        setDuplicateUndoTabs(closedTabs.length > 0 ? closedTabs : null);
        setOperationNotice(`${pluralize(result.closedTabIds.length, 'duplicate tab')} removed.`);
      }
      await refresh();
    } catch {
      setOperationError('The browser could not remove duplicate tabs.');
    } finally {
      finishOperation();
    }
  };

  const undoDuplicateRemoval = async () => {
    const tabs = duplicateUndoTabs;
    if (
      !tabs ||
      tabs.length === 0 ||
      !beginOperation(`Restoring ${pluralize(tabs.length, 'tab')}`)
    ) {
      return;
    }
    try {
      const result = await service.restoreTabs(tabs);
      setOperationError(summarizeRestoreFailures(result.failures, result.warnings));
      await refresh();
    } catch {
      setOperationError('The browser could not restore the removed duplicate tabs.');
    } finally {
      finishOperation();
    }
  };

  const dismissOperationNotice = () => {
    setOperationNotice(null);
    setDuplicateUndoTabs(null);
  };

  const sortTabs = async (
    windowId: number | undefined,
    sortOptions: Pick<TabSortOptions, 'criterion' | 'direction'>,
  ) => {
    if (!snapshot || settingsLoading || !beginOperation(null, false)) {
      return;
    }

    const options = {
      ...sortOptions,
      preserveGroups: settings.preserveGroupsDuringSort,
    };
    try {
      const result =
        windowId === undefined
          ? await service.sortAllWindows(options)
          : await service.sortWindow(windowId, options);
      setOperationError(summarizeWindowFailures(result.failures, result.warnings));
      await refresh();
    } catch {
      setOperationError('The browser could not sort the requested tabs.');
    } finally {
      finishOperation();
    }
  };

  const openMergeDialog = () => {
    if (!snapshot || snapshot.windows.length < 2) {
      return;
    }
    setMergeDestinationWindowId(snapshot.windows[0]?.id ?? null);
    setMergeSourceWindowIds(new Set());
    updateMergeDialogPosition();
    setMergeDialogOpen(true);
  };

  const changeMergeDestination = (windowId: number) => {
    setMergeDestinationWindowId(windowId);
    setMergeSourceWindowIds((current) => {
      const next = new Set(current);
      next.delete(windowId);
      return next;
    });
  };

  const toggleMergeSource = (windowId: number, selected: boolean) => {
    setMergeSourceWindowIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(windowId);
      } else {
        next.delete(windowId);
      }
      return next;
    });
  };

  const setAllMergeSources = (selected: boolean) => {
    setMergeSourceWindowIds(
      new Set(
        selected
          ? (snapshot?.windows.flatMap((window) =>
              window.id === resolvedMergeDestinationId ? [] : [window.id],
            ) ?? [])
          : [],
      ),
    );
  };

  const mergeWindows = async () => {
    if (
      resolvedMergeDestinationId === null ||
      orderedMergeSourceIds.length === 0 ||
      !beginOperation(`Merging ${pluralize(orderedMergeSourceIds.length + 1, 'window')}`)
    ) {
      return;
    }
    setMergeDialogOpen(false);

    try {
      const result = await service.mergeWindows([
        resolvedMergeDestinationId,
        ...orderedMergeSourceIds,
      ]);
      clearSelection();
      setQuery('');
      setMergeSourceWindowIds(new Set());
      setOperationError(summarizeFailures('moved', result.failures, result.warnings));
      await refresh();
    } catch {
      setOperationError('The browser could not merge the selected windows.');
    } finally {
      finishOperation();
      queueMicrotask(() => mergeButtonRef.current?.focus());
    }
  };

  const moveDraggedTabsToNewWindow = async (
    tabIds: readonly number[],
    beforeWindowId: number | null = null,
    preserveGroupIds: readonly number[] = [],
  ) => {
    if (!beginOperation(`Moving ${pluralize(tabIds.length, 'tab')} to a new window`)) {
      return;
    }
    resetDragTargetState();
    try {
      const result = await service.moveTabsToNewWindow(tabIds, preserveGroupIds);
      if (result.destinationWindowId !== null && snapshot) {
        const currentWindowId = snapshot.windows.find((window) => window.isCurrent)?.id;
        setWindowOrderIds((current) =>
          insertWindowBefore(
            reconcileWindowOrder(snapshot.windows, current),
            result.destinationWindowId as number,
            beforeWindowId,
            currentWindowId,
          ),
        );
      }
      setTabsSelected(result.movedTabIds, false);
      setOperationError(summarizeFailures('moved', result.failures, result.warnings));
      await refresh();
    } catch {
      setOperationError(
        tabIds.length === 1
          ? 'The browser could not move that tab into a new window.'
          : 'The browser could not move that tab group into a new window.',
      );
    } finally {
      finishOperation();
    }
  };

  const startTabDrag = (payload: TabDragPayload) => {
    const tabIds = [...new Set(payload.tabIds)];
    if (operationInFlightRef.current || tabIds.length === 0) {
      return;
    }
    dragSessionRef.current = { groupId: payload.groupId, handled: false, tabIds };
    resetDragTargetState();
    dragWindowCardBoundsRef.current = captureWindowCardBounds();
    setDraggedGroupId(payload.groupId);
    setDraggedTabIds(new Set(tabIds));
    setTabDropTarget(null);
  };

  const setTabDropTargetForWindow = (target: TabDropTarget, pointer: PointerPosition) => {
    cardTargetPointerRef.current = getDocumentPointer(pointer);
    clearNewWindowDropTarget();
    setTabDropTarget(target);
  };

  const clearTabDropTargetForWindow = (windowId: number) => {
    setTabDropTarget((current) => (current?.windowId === windowId ? null : current));
  };

  const clearTabDropTargetOutsideCards = (event: React.DragEvent<HTMLElement>) => {
    if (
      draggedTabIds.size === 0 ||
      (event.target instanceof Element && event.target.closest('.window-card'))
    ) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const pointer = getDocumentPointer({ x: event.clientX, y: event.clientY });
    if (
      cardTargetPointerRef.current &&
      pointerDistance(cardTargetPointerRef.current, pointer) < NEW_WINDOW_TARGET_SWITCH_DISTANCE
    ) {
      return;
    }
    cardTargetPointerRef.current = null;
    setTabDropTarget((current) => (current === null ? current : null));
    const visibleWindows = filtered?.windows ?? EMPTY_WINDOWS;
    const cards =
      dragWindowCardBoundsRef.current.length > 0
        ? dragWindowCardBoundsRef.current
        : captureWindowCardBounds();
    const placement = findClosestWindowDropPlacement(cards, pointer);
    if (!placement) {
      clearNewWindowDropTarget();
      return;
    }
    const anchorIndex = visibleWindows.findIndex(
      (window) => window.id === placement.anchorWindowId,
    );
    if (anchorIndex < 0) {
      clearNewWindowDropTarget();
      return;
    }
    const requestedIndex = anchorIndex + (placement.placement === 'after' ? 1 : 0);
    const minimumIndex = visibleWindows[0]?.isCurrent ? 1 : 0;
    const insertionIndex = Math.max(minimumIndex, requestedIndex);
    const beforeWindowId = visibleWindows[insertionIndex]?.id ?? null;
    const placementWasClamped = insertionIndex !== requestedIndex;
    const nextTarget: NewWindowDropTarget = {
      anchorWindowId: placementWasClamped
        ? (visibleWindows[0]?.id ?? placement.anchorWindowId)
        : placement.anchorWindowId,
      beforeWindowId,
      placement: placementWasClamped ? 'after' : placement.placement,
    };
    const currentTarget = newWindowDropTargetRef.current;
    if (!currentTarget || newWindowTargetsMatch(currentTarget, nextTarget)) {
      pendingNewWindowDropTargetRef.current = null;
      updateNewWindowDropTarget(nextTarget);
      return;
    }

    const pendingTarget = pendingNewWindowDropTargetRef.current;
    if (!pendingTarget || !newWindowTargetsMatch(pendingTarget.target, nextTarget)) {
      pendingNewWindowDropTargetRef.current = { origin: pointer, target: nextTarget };
      return;
    }
    if (pointerDistance(pendingTarget.origin, pointer) < NEW_WINDOW_TARGET_SWITCH_DISTANCE) {
      return;
    }
    pendingNewWindowDropTargetRef.current = null;
    updateNewWindowDropTarget(nextTarget);
  };

  const dropDraggedTabsOutsideCards = (event: React.DragEvent<HTMLElement>) => {
    if (
      draggedTabIds.size === 0 ||
      (event.target instanceof Element && event.target.closest('.window-card'))
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dropDraggedTabsIntoNewWindow();
  };

  const dropDraggedTabs = async (target: TabDropTarget) => {
    const session = dragSessionRef.current;
    if (!session) {
      return;
    }
    session.handled = true;
    setTabDropTarget(null);
    resetDragTargetState();
    if (!beginOperation(session.groupId === null ? 'Moving tab' : 'Moving tab group')) {
      return;
    }

    try {
      if (session.groupId === null) {
        const tabId = session.tabIds[0];
        if (tabId === undefined) {
          throw new Error('The dragged tab is unavailable.');
        }
        const result = await service.moveTab(
          tabId,
          target.windowId,
          target.browserIndex,
          target.groupId,
        );
        setTabsSelected([result.movedTabId], false);
        setOperationError(result.warnings.length > 0 ? result.warnings.join(' ') : null);
      } else {
        const result = await service.moveTabGroup(
          session.groupId,
          target.windowId,
          target.browserIndex,
        );
        setTabsSelected(result.movedTabIds, false);
        setOperationError(summarizeFailures('moved', result.failures, result.warnings));
      }
      await refresh();
    } catch {
      setOperationError(
        session.groupId === null
          ? target.groupId === null
            ? 'The browser could not move that tab.'
            : 'The browser could not add that tab to the group.'
          : 'The browser could not move that tab group.',
      );
    } finally {
      finishOperation();
    }
  };

  const dropDraggedTabsIntoNewWindow = () => {
    const session = dragSessionRef.current;
    if (!session) {
      return;
    }
    const beforeWindowId = newWindowDropTargetRef.current?.beforeWindowId ?? null;
    session.handled = true;
    setTabDropTarget(null);
    resetDragTargetState();
    void moveDraggedTabsToNewWindow(
      session.tabIds,
      beforeWindowId,
      session.groupId === null ? [] : [session.groupId],
    );
  };

  const endTabDrag = () => {
    dragSessionRef.current = null;
    setDraggedGroupId(null);
    setDraggedTabIds(new Set());
    setTabDropTarget(null);
    resetDragTargetState();
  };

  const totalSummary = snapshot
    ? `${pluralize(snapshot.windows.length, 'window')} · ${pluralize(snapshot.totalTabs, 'tab')}`
    : 'Loading windows';
  const compactTotalSummary = snapshot
    ? `${snapshot.windows.length}w · ${snapshot.totalTabs}t`
    : 'Loading';
  const headerStatus = (
    <div className="active-window-header-status">
      <span className="window-summary" aria-live="polite">
        <span className="window-summary-full">{totalSummary}</span>
        <span className="window-summary-compact">{compactTotalSummary}</span>
      </span>
    </div>
  );
  const removeDuplicatesControl = (
    <button
      className="toolbar-button topbar-remove-duplicates-button"
      type="button"
      title="Close duplicate tabs"
      disabled={
        settingsLoading || duplicatePlan.duplicateTabIds.length === 0 || operationLabel !== null
      }
      onClick={() => void removeDuplicateTabs()}
    >
      <CopyX aria-hidden="true" size={16} />
      <span className="topbar-action-label">Close duplicate tabs</span>
      <span className="toolbar-count">{duplicatePlan.duplicateTabIds.length}</span>
    </button>
  );
  const mergeControl = (
    <div className="merge-control" ref={mergeControlRef}>
      <button
        ref={mergeButtonRef}
        className="toolbar-button topbar-merge-button"
        type="button"
        aria-label="Merge windows"
        aria-expanded={mergeDialogOpen}
        title="Merge windows"
        disabled={!snapshot || snapshot.windows.length < 2 || operationLabel !== null}
        onClick={() => (mergeDialogOpen ? closeMergeDialog() : openMergeDialog())}
      >
        <Merge aria-hidden="true" size={16} />
        <span>Merge windows</span>
      </button>

      {mergeDialogOpen && snapshot && resolvedMergeDestinationId !== null ? (
        <MergeWindowsDialog
          destinationWindowId={resolvedMergeDestinationId}
          disabled={operationLabel !== null}
          horizontalOffset={mergeDialogHorizontalOffset}
          onApply={() => void mergeWindows()}
          onChangeDestination={changeMergeDestination}
          onClose={() => closeMergeDialog()}
          onSetAllSources={setAllMergeSources}
          onToggleSource={toggleMergeSource}
          sourceWindowIds={visibleMergeSourceIds}
          windows={snapshot.windows}
        />
      ) : null}
    </div>
  );
  const windowActionControls = (
    <div className="topbar-window-actions">
      {removeDuplicatesControl}
      {mergeControl}
    </div>
  );
  const showToolbarStatus = operationLabel !== null || headerPortalTarget === undefined;

  return (
    <section
      className="page-section active-windows-page"
      aria-labelledby="active-windows-heading"
      aria-busy={status === 'loading'}
      onDragOver={clearTabDropTargetOutsideCards}
      onDrop={dropDraggedTabsOutsideCards}
    >
      {headerPortalTarget ? createPortal(headerStatus, headerPortalTarget) : null}
      {actionPortalTarget ? createPortal(windowActionControls, actionPortalTarget) : null}

      <h2 id="active-windows-heading" className="sr-only">
        Active browser windows
      </h2>

      <div className="active-windows-toolbar">
        <div className="active-toolbar-main">
          <label className="window-search">
            <Search aria-hidden="true" size={17} />
            <span className="sr-only">Filter tabs by title or URL</span>
            <input
              type="text"
              role="searchbox"
              value={query}
              placeholder="Filter tabs"
              disabled={!snapshot}
              onChange={(event) => updateQuery(event.target.value)}
            />
            <button
              className={`window-search-clear${query ? '' : ' is-hidden'}`}
              type="button"
              aria-label="Clear filter"
              aria-hidden={!query}
              tabIndex={query ? 0 : -1}
              title="Clear filter"
              disabled={!query || !snapshot}
              onClick={() => updateQuery('')}
            >
              <X aria-hidden="true" size={15} />
            </button>
          </label>

          <button
            className="toolbar-button"
            type="button"
            disabled={
              operationLabel !== null ||
              (!selectionButtonClears && (!hasFilter || visibleTabIds.length === 0))
            }
            aria-pressed={selectionButtonClears}
            onClick={toggleFilteredSelection}
          >
            <ListChecks aria-hidden="true" size={16} />
            <span>{selectionButtonClears ? 'Clear selected' : 'Select filtered'}</span>
            <span className="toolbar-count">
              {selectionButtonClears ? selection.selectedCount : visibleTabIds.length}
            </span>
          </button>

          <div className="sort-controls" role="group" aria-label="Sort all windows">
            <SortCriterionMenu
              ariaLabel="Sort all windows by"
              value={sortCriterion}
              disabled={!snapshot || operationLabel !== null}
              onChange={setSortCriterion}
            />
            <button
              className="icon-button"
              type="button"
              aria-label={`Sort direction ${sortDirection === 'asc' ? 'A to Z' : 'Z to A'}`}
              title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
              disabled={!snapshot || operationLabel !== null}
              onClick={() => setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
            >
              {sortDirection === 'asc' ? (
                <ArrowDownAZ aria-hidden="true" size={17} />
              ) : (
                <ArrowUpZA aria-hidden="true" size={17} />
              )}
            </button>
            <button
              className="toolbar-button"
              type="button"
              disabled={
                !snapshot ||
                snapshot.windows.length === 0 ||
                settingsLoading ||
                operationLabel !== null
              }
              onClick={() =>
                void sortTabs(undefined, { criterion: sortCriterion, direction: sortDirection })
              }
            >
              <span>Sort all</span>
            </button>
          </div>

          {actionPortalTarget === undefined ? windowActionControls : null}

          <button
            className="toolbar-button"
            type="button"
            disabled={!canMoveSelectedTabsToNewWindow || operationLabel !== null}
            onClick={() => void moveSelectedTabs()}
          >
            <AppWindow aria-hidden="true" size={16} />
            <span>New window</span>
            <span className="toolbar-count">{selection.selectedCount}</span>
          </button>

          <button
            className="toolbar-button danger-toolbar-button"
            type="button"
            disabled={selection.selectedCount === 0 || operationLabel !== null}
            onClick={() => void closeSelectedTabs()}
          >
            <Trash2 aria-hidden="true" size={16} />
            <span>Close</span>
            <span className="toolbar-count">{selection.selectedCount}</span>
          </button>
        </div>

        {showToolbarStatus ? (
          <div className="active-toolbar-status">
            {operationLabel ? (
              <span className="operation-summary" role="status">
                {operationLabel}
              </span>
            ) : null}
            {headerPortalTarget === undefined ? headerStatus : null}
          </div>
        ) : null}
      </div>

      {errorMessage && snapshot ? (
        <div className="inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>Live refresh failed: {errorMessage}</span>
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : null}

      {navigationError ? (
        <div className="inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>{navigationError}</span>
          <button type="button" onClick={() => setNavigationError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {settingsError ? (
        <div className="inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>Settings could not be loaded: {settingsError}</span>
        </div>
      ) : null}

      {operationError ? (
        <div className="inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>{operationError}</span>
          <button type="button" onClick={() => setOperationError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {operationNotice ? (
        <div className="inline-notice" role="status">
          <span>{operationNotice}</span>
          <div className="inline-notice-actions">
            {duplicateUndoTabs ? (
              <button
                className="notice-undo-button"
                type="button"
                onClick={() => void undoDuplicateRemoval()}
              >
                Undo
              </button>
            ) : null}
            <button type="button" onClick={dismissOperationNotice}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {status === 'loading' ? (
        <div className="window-grid window-grid-loading" aria-hidden="true">
          {[0, 1, 2].map((item) => (
            <div className="window-card-skeleton" key={item} />
          ))}
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="load-error" role="alert">
          <AlertTriangle aria-hidden="true" size={24} />
          <h3>Could not load browser windows</h3>
          <p>{errorMessage}</p>
          <button type="button" onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" size={16} />
            Retry
          </button>
        </div>
      ) : null}

      {status === 'ready' && snapshot && snapshot.windows.length === 0 ? (
        <EmptyState
          icon={PanelsTopLeft}
          title="No browser windows available"
          description="Open a normal browser window to see it here."
        />
      ) : null}

      {status === 'ready' && filtered && snapshot && snapshot.windows.length > 0 ? (
        filtered.windows.length > 0 ? (
          <div
            className="window-grid window-grid-columns"
            ref={setWindowGridElement}
            style={{ gridTemplateColumns: `repeat(${windowColumns.length}, minmax(0, 1fr))` }}
          >
            {windowColumns.map((column, columnIndex) => (
              <div className="window-grid-column" key={`window-column-${columnIndex}`}>
                {column.map((window) => {
                  const allWindowTabs =
                    snapshot.windows.find((candidate) => candidate.id === window.id)?.tabs ??
                    window.tabs;
                  const windowSortSelection =
                    windowSortSelections.get(window.id) ?? DEFAULT_WINDOW_SORT_SELECTION;
                  const dropZone =
                    newWindowDropTarget?.anchorWindowId === window.id ? (
                      <div
                        className="new-window-drop-zone"
                        role="status"
                        aria-label="New window drop target"
                        data-anchor-window-id={newWindowDropTarget.anchorWindowId}
                        data-placement={newWindowDropTarget.placement}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          dropDraggedTabsIntoNewWindow();
                        }}
                      >
                        <AppWindow aria-hidden="true" size={20} />
                        <span>New window</span>
                      </div>
                    ) : null;
                  return (
                    <Fragment key={window.id}>
                      {newWindowDropTarget?.placement === 'before' ? dropZone : null}
                      <WindowCard
                        allWindowTabs={allWindowTabs}
                        collapsed={collapsedWindowIds.has(window.id)}
                        disabled={operationLabel !== null}
                        extensionOrigin={snapshot.extensionOrigin}
                        draggedGroupId={draggedGroupId}
                        draggedTabIds={draggedTabIds}
                        dropTarget={tabDropTarget}
                        mergeSourceSelected={
                          mergeDialogOpen && visibleMergeSourceIds.has(window.id)
                        }
                        onCloseTab={(tabId) => void closeTab(tabId)}
                        onCloseWindow={(windowId) => void closeWindow(windowId)}
                        onSortCriterionChange={(criterion) =>
                          updateWindowSortSelection(window.id, { criterion })
                        }
                        onSortDirectionChange={(direction) =>
                          updateWindowSortSelection(window.id, { direction })
                        }
                        onSortWindow={(windowId, options) => void sortTabs(windowId, options)}
                        window={window}
                        selectedTabIds={selection.selectedIds}
                        showTabUrls={settings.showTabUrls}
                        sortCriterion={windowSortSelection.criterion}
                        sortDirection={windowSortSelection.direction}
                        onSetTabsSelected={setTabsSelected}
                        onToggleTabSelected={toggleTabSelected}
                        onToggleCollapsed={toggleWindowCollapsed}
                        onFocusWindow={(windowId) => void focusWindow(windowId)}
                        onFocusTab={(windowId, tabId) => void focusTab(windowId, tabId)}
                        onSaveWindow={openSaveWindowDialog}
                        onSuspendWindow={(windowId) => void suspendWindowTabs(windowId)}
                        onUnsuspendTab={(tabId) => void unsuspendTab(tabId)}
                        onUnsuspendWindow={(windowId) => void unsuspendWindowTabs(windowId)}
                        onSetGroupSelected={setGroupSelected}
                        onTabDragEnd={endTabDrag}
                        onTabDragLeave={clearTabDropTargetForWindow}
                        onTabDragOver={setTabDropTargetForWindow}
                        onTabDragStart={startTabDrag}
                        onTabDrop={(target) => void dropDraggedTabs(target)}
                        selectedGroupIds={validSelectedGroupIds}
                      />
                      {newWindowDropTarget?.placement === 'after' ? dropZone : null}
                    </Fragment>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="filter-empty">
            <Search aria-hidden="true" size={24} />
            <h3>No matching tabs</h3>
            <button type="button" onClick={() => updateQuery('')}>
              Clear filter
            </button>
          </div>
        )
      ) : null}

      {saveWindowTarget ? (
        <SaveWindowDialog
          key={saveWindowTarget.id}
          onClose={closeSaveWindowDialog}
          onComplete={completeSaveWindow}
          onSave={(name, closeSource) =>
            savedWindowsService.saveWindow(saveWindowTarget.id, name, closeSource)
          }
          tabCount={saveWindowTarget.tabs.length}
          windowLabel={saveWindowTarget.label}
        />
      ) : null}
    </section>
  );
}
