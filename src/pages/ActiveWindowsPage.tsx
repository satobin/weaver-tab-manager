import {
  AlertTriangle,
  AppWindow,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CopyX,
  Eye,
  ListChecks,
  Merge,
  PanelsTopLeft,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { APP_ROUTES, getAppRouteSearchParams, parseAppRoute } from '../app/routes';
import {
  createChromeActiveWindowsService,
  PINNED_TAB_GROUP_MOVE_ERROR_MESSAGE,
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
  type ActiveWindowsSnapshot,
  type ManagedWindow,
} from '../features/active-windows/model';
import { type ToggleTabSelection } from '../features/active-windows/selection';
import {
  isTabOrderSorted,
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
import { formatWindowLabel } from '../features/active-windows/windowLabel';
import { planDuplicateTabs } from '../features/deduplication/deduplication';
import { type DedupePreviewTab } from '../features/deduplication/dedupeRulePresentation';
import { SaveWindowDialog } from '../features/saved-windows/SaveWindowDialog';
import {
  createSavedWindowsService,
  type FastSourceWindowCloseOperation,
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
type PaletteViewRequest = 'duplicates' | 'merge';
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
type TabDragSession = TabDragPayload;
interface PendingWindowClose {
  batchErrorMessage: string | null;
  delayed: boolean;
  displayIndex: number;
  displayWindow: ManagedWindow;
  dismissed: boolean;
  finalizationState: 'accepted' | 'idle';
  operation: FastSourceWindowCloseOperation;
  savedWindowId: string;
  savedWindowName: string;
  terminalErrorMessage: string | null;
  warningText: string;
  windowId: number;
  windowLabel: string;
}
interface PendingWindowCloseProgress {
  remainingNonAnchorTabCount: number;
  remainingTargetTabCount: number;
}
interface PendingWindowCloseTimers {
  delayTimer: ReturnType<typeof globalThis.setTimeout>;
  savedWindowId: string;
  timeoutTimer: ReturnType<typeof globalThis.setTimeout>;
}
interface WindowCloseCompletionNotice {
  message: string;
  savedWindowId: string;
  savedWindowName: string;
}
interface PendingWindowCloseFocus {
  savedWindowId: string;
  windowId: number;
}
type PendingWindowCloseResultFocus = 'error' | 'page' | { savedWindowId: string } | null;
const DEFAULT_WINDOW_SORT_SELECTION: WindowSortSelection = {
  criterion: 'title',
  direction: 'asc',
};
const NEW_WINDOW_TARGET_SWITCH_DISTANCE = 12;
const WINDOW_CLOSE_DELAY_NOTICE_MS = 3_000;
const WINDOW_CLOSE_TIMEOUT_MS = 60_000;

function finishFastCloseWithoutPage(operation: FastSourceWindowCloseOperation): void {
  void operation.batchCompletion
    .then(({ errorMessage }) => {
      if (errorMessage) {
        return;
      }
      return operation.finish().then((result) => {
        if (result.completion) {
          void result.completion.catch(() => undefined);
        }
      });
    })
    .catch(() => undefined);
}

function sortSelectionsMatch(
  first: TabSortOptions | null | undefined,
  second: TabSortOptions,
): boolean {
  return first?.criterion === second.criterion && first.direction === second.direction;
}

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

function getOpenTabIds(snapshot: ActiveWindowsSnapshot): ReadonlySet<number> {
  return new Set(
    snapshot.windows.flatMap((activeWindow) => activeWindow.tabs.map((tab) => tab.id)),
  );
}

function getPendingWindowCloseKey(pendingClose: PendingWindowClose): string {
  return `${pendingClose.windowId}:${pendingClose.savedWindowId}`;
}

function getPendingWindowCloseProgress(
  pendingClose: PendingWindowClose,
  snapshot: ActiveWindowsSnapshot,
): PendingWindowCloseProgress {
  const openTabIds = getOpenTabIds(snapshot);
  const remainingTargetTabCount = pendingClose.operation.targetTabIds.filter((tabId) =>
    openTabIds.has(tabId),
  ).length;
  const remainingNonAnchorTabCount = pendingClose.operation.nonAnchorTabIds.filter((tabId) =>
    openTabIds.has(tabId),
  ).length;
  return {
    remainingNonAnchorTabCount,
    remainingTargetTabCount,
  };
}

function getPendingWindowCloseNotice(pendingClose: PendingWindowClose): string {
  return `Saved "${pendingClose.savedWindowName}". Still closing the original window. A page may need extra time or confirmation.${pendingClose.warningText}`;
}

function getCompletedWindowCloseNotice(pendingClose: PendingWindowClose): string {
  return `Saved "${pendingClose.savedWindowName}" and closed the original window.${pendingClose.warningText}`;
}

function getFailedWindowCloseMessage(
  pendingClose: PendingWindowClose,
  errorMessage: string,
): string {
  return `Saved "${pendingClose.savedWindowName}", but the original window did not finish closing. ${errorMessage}`;
}

function appendOperationError(current: string | null, next: string): string {
  if (!current) {
    return next;
  }
  return current.includes(next) ? current : `${current} ${next}`;
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
  const clearTabSelection = selection.clear;
  const [selectedGroupIds, setSelectedGroupIds] = useState<ReadonlySet<number>>(() => new Set());
  const [collapsedWindowIds, setCollapsedWindowIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [query, setQuery] = useState('');
  const [sortCriterion, setSortCriterion] = useState<SortCriterion>('title');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [appliedGlobalSortSelection, setAppliedGlobalSortSelection] =
    useState<TabSortOptions | null>(null);
  const [windowSortSelections, setWindowSortSelections] = useState<
    ReadonlyMap<number, WindowSortSelection>
  >(() => new Map());
  const [appliedWindowSortSelections, setAppliedWindowSortSelections] = useState<
    ReadonlyMap<number, TabSortOptions>
  >(() => new Map());
  const [duplicatePreviewMode, setDuplicatePreviewMode] = useState(false);
  const [paletteViewRequest, setPaletteViewRequest] = useState<PaletteViewRequest | null>(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeDialogHorizontalOffset, setMergeDialogHorizontalOffset] = useState(0);
  const [mergeWindowIds, setMergeWindowIds] = useState<ReadonlySet<number>>(() => new Set());
  const [draggedGroupId, setDraggedGroupId] = useState<number | null>(null);
  const [draggedTabIds, setDraggedTabIds] = useState<ReadonlySet<number>>(() => new Set());
  const [tabDropTarget, setTabDropTarget] = useState<TabDropTarget | null>(null);
  const [newWindowDropTarget, setNewWindowDropTarget] = useState<NewWindowDropTarget | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  const [windowCloseCompletionNotices, setWindowCloseCompletionNotices] = useState<
    readonly WindowCloseCompletionNotice[]
  >([]);
  const [duplicateUndoTabs, setDuplicateUndoTabs] = useState<readonly RestorableTab[] | null>(null);
  const [operationLabel, setOperationLabel] = useState<string | null>(null);
  const [duplicateRemovalTabIds, setDuplicateRemovalTabIds] = useState<readonly number[] | null>(
    null,
  );
  const [saveWindowId, setSaveWindowId] = useState<number | null>(null);
  const [pendingWindowCloses, setPendingWindowCloses] = useState<
    ReadonlyMap<number, PendingWindowClose>
  >(() => new Map());
  const [pendingWindowCloseSummaryBaseline, setPendingWindowCloseSummaryBaseline] = useState<{
    tabCount: number;
    windowCount: number;
  } | null>(null);
  const [windowColumnCount, setWindowColumnCount] = useState(1);
  const [windowGridElement, setWindowGridElement] = useState<HTMLDivElement | null>(null);
  const operationInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const pendingWindowCloseFocusRef = useRef<PendingWindowCloseFocus | null>(null);
  const pendingWindowCloseOwnedFocusIdRef = useRef<number | null>(null);
  const pendingWindowCloseResultFocusRef = useRef<PendingWindowCloseResultFocus>(null);
  const pendingWindowClosesRef = useRef(pendingWindowCloses);
  const pendingWindowCloseFinalizationsRef = useRef<Set<string>>(new Set());
  const pendingWindowCloseTimersRef = useRef<Map<number, PendingWindowCloseTimers>>(new Map());
  const dragSessionRef = useRef<TabDragSession | null>(null);
  const dragWindowCardBoundsRef = useRef<readonly WindowCardBounds[]>([]);
  const newWindowDropTargetRef = useRef<NewWindowDropTarget | null>(null);
  const pendingNewWindowDropTargetRef = useRef<PendingNewWindowDropTarget | null>(null);
  const cardTargetPointerRef = useRef<PointerPosition | null>(null);
  const mergeButtonRef = useRef<HTMLButtonElement>(null);
  const mergeControlRef = useRef<HTMLDivElement>(null);
  const duplicatePreviewButtonRef = useRef<HTMLButtonElement>(null);
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
  const globalSortSelection = useMemo<TabSortOptions>(
    () => ({
      criterion: sortCriterion,
      direction: sortDirection,
    }),
    [sortCriterion, sortDirection],
  );
  const globalSortMatchesCurrentOrder = useMemo(
    () =>
      Boolean(
        snapshot &&
        snapshot.windows.length > 0 &&
        sortSelectionsMatch(appliedGlobalSortSelection, globalSortSelection) &&
        snapshot.windows.every((activeWindow) =>
          isTabOrderSorted(activeWindow.tabs, globalSortSelection),
        ),
      ),
    [appliedGlobalSortSelection, globalSortSelection, snapshot],
  );
  const globalSortActionDirection: SortDirection = globalSortMatchesCurrentOrder
    ? sortDirection === 'asc'
      ? 'desc'
      : 'asc'
    : sortDirection;
  const globalSortActionDirectionLabel = globalSortActionDirection === 'asc' ? 'A to Z' : 'Z to A';
  const currentGlobalSortDirectionLabel = sortDirection === 'asc' ? 'A to Z' : 'Z to A';

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
    if (!mergeDialogOpen) {
      return;
    }
    window.addEventListener('resize', updateMergeDialogPosition);
    return () => window.removeEventListener('resize', updateMergeDialogPosition);
  }, [mergeDialogOpen, updateMergeDialogPosition]);

  const hasFilter = query.trim().length > 0;
  const selectionButtonClears = selection.selectedCount > 0;
  const selectedTabIdsInOrder = useMemo(
    () =>
      snapshot?.windows.flatMap((window) =>
        pendingWindowCloses.has(window.id)
          ? []
          : window.tabs.flatMap((tab) => (selection.selectedIds.has(tab.id) ? [tab.id] : [])),
      ) ?? [],
    [pendingWindowCloses, selection.selectedIds, snapshot],
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
  const orderedMergeWindowIds = useMemo(
    () =>
      snapshot?.windows.flatMap((window) => (mergeWindowIds.has(window.id) ? [window.id] : [])) ??
      [],
    [mergeWindowIds, snapshot],
  );
  const visibleMergeWindowIds = useMemo(
    () => new Set(orderedMergeWindowIds),
    [orderedMergeWindowIds],
  );
  const duplicateTabs = useMemo<DedupePreviewTab[]>(
    () =>
      snapshot?.windows.flatMap((window) =>
        window.tabs.map((tab) => ({
          ...tab,
          windowLabel: window.label,
        })),
      ) ?? [],
    [snapshot],
  );
  const duplicateRules = useMemo(
    () => (settings.advancedDuplicateMatchingEnabled ? settings.deduplicationRules : []),
    [settings.advancedDuplicateMatchingEnabled, settings.deduplicationRules],
  );
  const duplicateKeeperPreference = useMemo(() => {
    const preferredWindow =
      snapshot?.windows.find((window) => window.isCurrent) ??
      snapshot?.windows.find((window) => window.focused);
    return {
      tabId: preferredWindow?.tabs.find((tab) => tab.active)?.id,
      windowId: preferredWindow?.id,
    };
  }, [snapshot]);
  const duplicatePlan = useMemo(
    () => planDuplicateTabs(duplicateTabs, duplicateRules, duplicateKeeperPreference),
    [duplicateKeeperPreference, duplicateRules, duplicateTabs],
  );
  const filteredTabIds = useMemo(
    () =>
      new Set(
        filtered?.windows.flatMap((activeWindow) => activeWindow.tabs.map((tab) => tab.id)) ?? [],
      ),
    [filtered],
  );
  const visibleDuplicateGroups = useMemo(
    () =>
      hasFilter
        ? duplicatePlan.duplicateGroups.filter((group) =>
            [...group.keepTabIds, ...group.duplicateTabIds].some((tabId) =>
              filteredTabIds.has(tabId),
            ),
          )
        : duplicatePlan.duplicateGroups,
    [duplicatePlan.duplicateGroups, filteredTabIds, hasFilter],
  );
  const duplicateKeeperTabIds = useMemo(
    () => new Set(visibleDuplicateGroups.flatMap((group) => group.keepTabIds)),
    [visibleDuplicateGroups],
  );
  const duplicateCloseTabIds = useMemo(
    () => new Set(visibleDuplicateGroups.flatMap((group) => group.duplicateTabIds)),
    [visibleDuplicateGroups],
  );
  const visibleDuplicateCloseTabIds = useMemo(
    () => duplicatePlan.duplicateTabIds.filter((tabId) => duplicateCloseTabIds.has(tabId)),
    [duplicateCloseTabIds, duplicatePlan.duplicateTabIds],
  );
  const duplicatePreviewTabIds = useMemo(
    () => new Set([...duplicateKeeperTabIds, ...duplicateCloseTabIds]),
    [duplicateCloseTabIds, duplicateKeeperTabIds],
  );
  const actionSelectedTabIdsInOrder = useMemo(
    () =>
      duplicatePreviewMode
        ? selectedTabIdsInOrder.filter((tabId) => duplicatePreviewTabIds.has(tabId))
        : selectedTabIdsInOrder,
    [duplicatePreviewMode, duplicatePreviewTabIds, selectedTabIdsInOrder],
  );
  const actionSelectedTabIsOnlyTabInWindow = useMemo(() => {
    if (!snapshot || actionSelectedTabIdsInOrder.length !== 1) {
      return false;
    }
    const selectedTabId = actionSelectedTabIdsInOrder[0];
    return snapshot.windows.some(
      (window) => window.tabs.length === 1 && window.tabs[0]?.id === selectedTabId,
    );
  }, [actionSelectedTabIdsInOrder, snapshot]);
  const actionSelectedCount = actionSelectedTabIdsInOrder.length;
  const actionSelectedGroupIdsInOrder = useMemo(() => {
    if (!duplicatePreviewMode) {
      return selectedGroupIdsInOrder;
    }
    const actionSelectedTabIds = new Set(actionSelectedTabIdsInOrder);
    return selectedGroupIdsInOrder.filter((groupId) =>
      snapshot?.windows.some((window) => {
        const groupTabIds = window.tabs.flatMap((tab) => (tab.groupId === groupId ? [tab.id] : []));
        return (
          groupTabIds.length > 0 && groupTabIds.every((tabId) => actionSelectedTabIds.has(tabId))
        );
      }),
    );
  }, [actionSelectedTabIdsInOrder, duplicatePreviewMode, selectedGroupIdsInOrder, snapshot]);
  const canMoveSelectedTabsToNewWindow =
    actionSelectedCount > 0 && !actionSelectedTabIsOnlyTabInWindow;
  const displayedSelectedGroupIds = duplicatePreviewMode ? selectedGroupIds : validSelectedGroupIds;
  const duplicateActionTabIds = duplicatePreviewMode
    ? visibleDuplicateCloseTabIds
    : duplicatePlan.duplicateTabIds;
  const duplicateRemovalRemainingCount = useMemo(() => {
    if (!duplicateRemovalTabIds) {
      return null;
    }
    if (!snapshot) {
      return duplicateRemovalTabIds.length;
    }
    const openTabIds = getOpenTabIds(snapshot);
    return duplicateRemovalTabIds.filter((tabId) => openTabIds.has(tabId)).length;
  }, [duplicateRemovalTabIds, snapshot]);

  const displayed = useMemo(() => {
    if (!filtered || !snapshot || !duplicatePreviewMode) {
      return filtered;
    }

    return {
      ...filtered,
      windows: snapshot.windows
        .map((activeWindow) => {
          const tabs = activeWindow.tabs.filter((tab) => duplicatePreviewTabIds.has(tab.id));
          const groupIds = new Set(
            tabs.flatMap((tab) => (tab.groupId === null ? [] : [tab.groupId])),
          );

          return {
            ...activeWindow,
            groups: activeWindow.groups.filter((group) => groupIds.has(group.id)),
            tabs,
          };
        })
        .filter((activeWindow) => activeWindow.tabs.length > 0),
    };
  }, [duplicatePreviewMode, duplicatePreviewTabIds, filtered, snapshot]);

  const displayedWindowsById = useMemo(
    () =>
      new Map(
        (displayed?.windows ?? EMPTY_WINDOWS).map((activeWindow) => [
          activeWindow.id,
          activeWindow,
        ]),
      ),
    [displayed?.windows],
  );
  const layoutWindows = useMemo(() => {
    const baseWindows = duplicatePreviewMode
      ? (snapshot?.windows ?? EMPTY_WINDOWS)
      : (displayed?.windows ?? EMPTY_WINDOWS);
    if (duplicatePreviewMode || pendingWindowCloses.size === 0) {
      return baseWindows;
    }

    const baseWindowsById = new Map(
      baseWindows.map((activeWindow) => [activeWindow.id, activeWindow] as const),
    );
    const augmentedWindows = [...(snapshot?.windows ?? EMPTY_WINDOWS)];
    [...pendingWindowCloses.values()]
      .sort((first, second) => first.displayIndex - second.displayIndex)
      .forEach((pendingClose) => {
        if (augmentedWindows.some((activeWindow) => activeWindow.id === pendingClose.windowId)) {
          return;
        }
        augmentedWindows.splice(
          Math.min(Math.max(0, pendingClose.displayIndex), augmentedWindows.length),
          0,
          pendingClose.displayWindow,
        );
      });
    return augmentedWindows.flatMap((activeWindow, index) => {
      const displayedWindow = baseWindowsById.get(activeWindow.id);
      const pendingClose = pendingWindowCloses.get(activeWindow.id);
      if (!displayedWindow && !pendingClose) {
        return [];
      }
      return [
        {
          ...(pendingClose?.displayWindow ?? displayedWindow ?? activeWindow),
          label: pendingClose?.windowLabel ?? formatWindowLabel(index + 1),
        },
      ];
    });
  }, [displayed?.windows, duplicatePreviewMode, pendingWindowCloses, snapshot?.windows]);
  const layoutWindowCount = layoutWindows.length;
  const visibleTabIds = useMemo(
    () =>
      displayed?.windows.flatMap((activeWindow) =>
        pendingWindowCloses.has(activeWindow.id) ? [] : activeWindow.tabs.map((tab) => tab.id),
      ) ?? [],
    [displayed, pendingWindowCloses],
  );
  const windowColumns = useMemo(() => {
    const columns = distributeAcrossWindowColumns(
      layoutWindows,
      windowColumnCount,
      (activeWindow) =>
        estimateWindowCardHeight(
          activeWindow,
          settings.showTabUrls,
          pendingWindowCloses.has(activeWindow.id)
            ? false
            : collapsedWindowIds.has(activeWindow.id),
        ),
    );

    if (!duplicatePreviewMode) {
      return columns;
    }

    return columns.map((column) =>
      column.flatMap((activeWindow) => {
        const displayedWindow = displayedWindowsById.get(activeWindow.id);
        return displayedWindow ? [displayedWindow] : [];
      }),
    );
  }, [
    collapsedWindowIds,
    displayedWindowsById,
    duplicatePreviewMode,
    layoutWindows,
    pendingWindowCloses,
    settings.showTabUrls,
    windowColumnCount,
  ]);

  useEffect(() => {
    if (!windowGridElement || typeof ResizeObserver === 'undefined') {
      return;
    }

    const updateColumnCount = (width: number) => {
      const nextColumnCount = getWindowColumnCount(width, layoutWindowCount);
      setWindowColumnCount((current) => (current === nextColumnCount ? current : nextColumnCount));
    };
    updateColumnCount(windowGridElement.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      updateColumnCount(entries[0]?.contentRect.width ?? windowGridElement.clientWidth);
    });
    observer.observe(windowGridElement);
    return () => observer.disconnect();
  }, [layoutWindowCount, windowGridElement]);

  useEffect(() => {
    pendingWindowClosesRef.current = pendingWindowCloses;
  }, [pendingWindowCloses]);

  const saveWindowTarget = snapshot?.windows.find((window) => window.id === saveWindowId) ?? null;

  const clearPendingWindowCloseTimer = useCallback((windowId: number) => {
    const timers = pendingWindowCloseTimersRef.current.get(windowId);
    if (timers) {
      globalThis.clearTimeout(timers.delayTimer);
      globalThis.clearTimeout(timers.timeoutTimer);
      pendingWindowCloseTimersRef.current.delete(windowId);
    }
  }, []);

  const schedulePendingWindowCloseNotice = useCallback(
    (pendingClose: PendingWindowClose) => {
      clearPendingWindowCloseTimer(pendingClose.windowId);
      const delayTimer = globalThis.setTimeout(() => {
        if (
          pendingWindowCloseTimersRef.current.get(pendingClose.windowId)?.savedWindowId !==
          pendingClose.savedWindowId
        ) {
          return;
        }
        setPendingWindowCloses((current) => {
          const latest = current.get(pendingClose.windowId);
          if (!latest || latest.savedWindowId !== pendingClose.savedWindowId || latest.delayed) {
            return current;
          }
          const next = new Map(current);
          next.set(pendingClose.windowId, { ...latest, delayed: true });
          return next;
        });
      }, WINDOW_CLOSE_DELAY_NOTICE_MS);
      const timeoutTimer = globalThis.setTimeout(() => {
        const latestTimers = pendingWindowCloseTimersRef.current.get(pendingClose.windowId);
        if (latestTimers?.savedWindowId !== pendingClose.savedWindowId) {
          return;
        }
        globalThis.clearTimeout(latestTimers.delayTimer);
        pendingWindowCloseTimersRef.current.delete(pendingClose.windowId);
        const latestPendingClose = pendingWindowClosesRef.current.get(pendingClose.windowId);
        const finalCloseRequested =
          latestPendingClose?.savedWindowId === pendingClose.savedWindowId &&
          latestPendingClose.finalizationState === 'accepted' &&
          latestPendingClose.terminalErrorMessage === null;
        const finalizationVerificationPending =
          latestPendingClose?.savedWindowId === pendingClose.savedWindowId &&
          latestPendingClose.finalizationState === 'idle' &&
          pendingWindowCloseFinalizationsRef.current.has(
            getPendingWindowCloseKey(latestPendingClose),
          );
        if (latestPendingClose?.savedWindowId === pendingClose.savedWindowId) {
          latestPendingClose.operation.cancelFinalization();
        }
        pendingWindowCloseFinalizationsRef.current.delete(getPendingWindowCloseKey(pendingClose));
        if (pendingWindowCloseOwnedFocusIdRef.current === pendingClose.windowId) {
          pendingWindowCloseResultFocusRef.current = 'error';
          pendingWindowCloseOwnedFocusIdRef.current = null;
        }
        setPendingWindowCloses((current) => {
          if (current.get(pendingClose.windowId)?.savedWindowId !== pendingClose.savedWindowId) {
            return current;
          }
          const next = new Map(current);
          next.delete(pendingClose.windowId);
          return next;
        });
        setDuplicateUndoTabs(null);
        const timeoutMessage = finalCloseRequested
          ? `Saved "${pendingClose.savedWindowName}", but your browser is still waiting to close the final tab in the original window. Weaver unlocked the window; closing may still finish after you respond to a page confirmation.`
          : finalizationVerificationPending
            ? `Saved "${pendingClose.savedWindowName}", but Weaver could not finish verifying the final tab in the original window. Weaver stopped automatic closing and unlocked the window.`
            : `Saved "${pendingClose.savedWindowName}", but your browser did not finish closing every saved tab in the original window. Weaver stopped before closing the final tab. Focus the original window to check for a confirmation.`;
        setOperationError((current) => appendOperationError(current, timeoutMessage));
      }, WINDOW_CLOSE_TIMEOUT_MS);
      pendingWindowCloseTimersRef.current.set(pendingClose.windowId, {
        delayTimer,
        savedWindowId: pendingClose.savedWindowId,
        timeoutTimer,
      });
    },
    [clearPendingWindowCloseTimer],
  );

  useEffect(() => {
    if (!snapshot || pendingWindowCloses.size === 0) {
      return;
    }
    const finalizationCandidates = [...pendingWindowCloses.values()].filter((pendingClose) => {
      if (
        pendingClose.finalizationState !== 'idle' ||
        pendingWindowCloseFinalizationsRef.current.has(getPendingWindowCloseKey(pendingClose))
      ) {
        return false;
      }
      const progress = getPendingWindowCloseProgress(pendingClose, snapshot);
      return progress.remainingNonAnchorTabCount === 0;
    });
    if (finalizationCandidates.length === 0) {
      return;
    }

    finalizationCandidates.forEach((pendingClose) => {
      pendingWindowCloseFinalizationsRef.current.add(getPendingWindowCloseKey(pendingClose));
      const operation = pendingClose.operation;
      void operation
        .finish()
        .then(async (result) => {
          await refresh();
          if (!mountedRef.current) {
            return;
          }
          setPendingWindowCloses((current) => {
            const latest = current.get(pendingClose.windowId);
            if (latest?.savedWindowId !== pendingClose.savedWindowId) {
              return current;
            }
            const next = new Map(current);
            next.set(pendingClose.windowId, {
              ...latest,
              finalizationState: 'accepted',
              terminalErrorMessage:
                result.status === 'partial'
                  ? (result.errorMessage ??
                    'Your browser left some tabs open in the original window.')
                  : null,
            });
            return next;
          });
          if (result.completion) {
            void result.completion.then(async ({ errorMessage }) => {
              await refresh();
              if (!mountedRef.current || !errorMessage) {
                return;
              }
              setPendingWindowCloses((current) => {
                const latest = current.get(pendingClose.windowId);
                if (latest?.savedWindowId !== pendingClose.savedWindowId) {
                  return current;
                }
                const next = new Map(current);
                next.set(pendingClose.windowId, {
                  ...latest,
                  finalizationState: 'accepted',
                  terminalErrorMessage: `The final saved tab could not be closed: ${errorMessage}`,
                });
                return next;
              });
            });
          }
        })
        .catch(async (error: unknown) => {
          await refresh();
          if (!mountedRef.current) {
            return;
          }
          setPendingWindowCloses((current) => {
            const latest = current.get(pendingClose.windowId);
            if (latest?.savedWindowId !== pendingClose.savedWindowId) {
              return current;
            }
            const next = new Map(current);
            next.set(pendingClose.windowId, {
              ...latest,
              finalizationState: 'accepted',
              terminalErrorMessage:
                error instanceof Error && error.message.trim()
                  ? error.message
                  : 'Your browser could not finish closing the original window.',
            });
            return next;
          });
        });
    });
  }, [pendingWindowCloses, refresh, snapshot]);

  useEffect(() => {
    if (!snapshot || pendingWindowCloses.size === 0) {
      return;
    }
    const openWindowIds = new Set(snapshot.windows.map((activeWindow) => activeWindow.id));
    const completedCloses = [...pendingWindowCloses.values()].filter(
      (pendingClose) =>
        pendingClose.finalizationState === 'accepted' &&
        pendingClose.terminalErrorMessage === null &&
        getPendingWindowCloseProgress(pendingClose, snapshot).remainingTargetTabCount === 0 &&
        !openWindowIds.has(pendingClose.windowId),
    );
    const completedKeys = new Set(
      completedCloses.map(
        (pendingClose) => `${pendingClose.windowId}:${pendingClose.savedWindowId}`,
      ),
    );
    const failedCloses = [...pendingWindowCloses.values()].filter((pendingClose) => {
      if (completedKeys.has(`${pendingClose.windowId}:${pendingClose.savedWindowId}`)) {
        return false;
      }
      const progress = getPendingWindowCloseProgress(pendingClose, snapshot);
      return (
        pendingClose.terminalErrorMessage !== null ||
        (pendingClose.batchErrorMessage !== null && progress.remainingNonAnchorTabCount > 0)
      );
    });
    const settledCloses = [...completedCloses, ...failedCloses];
    if (settledCloses.length === 0) {
      return;
    }

    settledCloses.forEach((pendingClose) =>
      pendingWindowCloseFinalizationsRef.current.delete(getPendingWindowCloseKey(pendingClose)),
    );
    settledCloses.forEach((pendingClose) => clearPendingWindowCloseTimer(pendingClose.windowId));
    const completionTimer = globalThis.setTimeout(() => {
      const focusedCompletedClose = completedCloses.find(
        (pendingClose) => pendingWindowCloseOwnedFocusIdRef.current === pendingClose.windowId,
      );
      if (
        failedCloses.some(
          (pendingClose) => pendingWindowCloseOwnedFocusIdRef.current === pendingClose.windowId,
        )
      ) {
        pendingWindowCloseResultFocusRef.current = 'error';
      } else if (focusedCompletedClose) {
        pendingWindowCloseResultFocusRef.current = {
          savedWindowId: focusedCompletedClose.savedWindowId,
        };
      }
      if (
        settledCloses.some(
          (pendingClose) => pendingWindowCloseOwnedFocusIdRef.current === pendingClose.windowId,
        )
      ) {
        pendingWindowCloseOwnedFocusIdRef.current = null;
      }
      setPendingWindowCloses((current) => {
        const next = new Map(current);
        settledCloses.forEach((pendingClose) => {
          if (next.get(pendingClose.windowId)?.savedWindowId === pendingClose.savedWindowId) {
            next.delete(pendingClose.windowId);
          }
        });
        return next;
      });
      const completionNotices = completedCloses.map((pendingClose) => ({
        message: getCompletedWindowCloseNotice(pendingClose),
        savedWindowId: pendingClose.savedWindowId,
        savedWindowName: pendingClose.savedWindowName,
      }));
      if (completionNotices.length > 0) {
        setWindowCloseCompletionNotices((current) => {
          const existingIds = new Set(current.map((notice) => notice.savedWindowId));
          const additions = completionNotices.filter(
            (notice) => !existingIds.has(notice.savedWindowId),
          );
          return additions.length > 0 ? [...current, ...additions] : current;
        });
      }
      const failureNotice = failedCloses
        .map((pendingClose) =>
          getFailedWindowCloseMessage(
            pendingClose,
            pendingClose.terminalErrorMessage ??
              pendingClose.batchErrorMessage ??
              'Your browser left some tabs open in the original window.',
          ),
        )
        .join(' ');
      if (failureNotice) {
        setDuplicateUndoTabs(null);
        setOperationError((current) => appendOperationError(current, failureNotice));
      }
    }, 0);
    return () => globalThis.clearTimeout(completionTimer);
  }, [clearPendingWindowCloseTimer, pendingWindowCloses, snapshot]);

  useEffect(() => {
    const timers = pendingWindowCloseTimersRef.current;
    const finalizations = pendingWindowCloseFinalizationsRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timers.forEach(({ delayTimer, timeoutTimer }) => {
        globalThis.clearTimeout(delayTimer);
        globalThis.clearTimeout(timeoutTimer);
      });
      pendingWindowClosesRef.current.forEach((pendingClose) =>
        finishFastCloseWithoutPage(pendingClose.operation),
      );
      timers.clear();
      finalizations.clear();
    };
  }, []);

  useEffect(() => {
    const getPendingWindowCloseId = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return null;
      }
      const closingCard = target.closest<HTMLElement>('.window-card.is-closing[data-window-id]');
      const pendingNotice = target.closest<HTMLElement>('[data-window-close-id]');
      const windowId = Number(
        closingCard?.dataset.windowId ?? pendingNotice?.dataset.windowCloseId ?? Number.NaN,
      );
      return Number.isInteger(windowId) ? windowId : null;
    };
    const trackPendingWindowCloseFocus = (event: FocusEvent) => {
      pendingWindowCloseOwnedFocusIdRef.current = getPendingWindowCloseId(event.target);
    };
    const trackPendingWindowClosePointer = (event: PointerEvent) => {
      pendingWindowCloseOwnedFocusIdRef.current = getPendingWindowCloseId(event.target);
    };
    document.addEventListener('focusin', trackPendingWindowCloseFocus);
    document.addEventListener('pointerdown', trackPendingWindowClosePointer);
    return () => {
      document.removeEventListener('focusin', trackPendingWindowCloseFocus);
      document.removeEventListener('pointerdown', trackPendingWindowClosePointer);
    };
  }, []);

  useEffect(() => {
    const focusIntent = pendingWindowCloseFocusRef.current;
    if (focusIntent === null) {
      return;
    }
    const closingStatus = document.querySelector<HTMLElement>(
      `.window-card[data-window-id="${focusIntent.windowId}"] .window-card-closing-status`,
    );
    if (closingStatus) {
      closingStatus.focus();
      pendingWindowCloseFocusRef.current = null;
      return;
    }
    if (!pendingWindowCloses.has(focusIntent.windowId)) {
      [...document.querySelectorAll<HTMLElement>('.window-close-completion-notice')]
        .find((notice) => notice.dataset.savedWindowId === focusIntent.savedWindowId)
        ?.querySelector<HTMLButtonElement>('button[title="Undo Save & close"]')
        ?.focus();
      pendingWindowCloseFocusRef.current = null;
    }
  }, [pendingWindowCloses, windowCloseCompletionNotices]);

  useEffect(() => {
    const focusTarget = pendingWindowCloseResultFocusRef.current;
    if (focusTarget === null) {
      return;
    }
    const element =
      focusTarget === 'error'
        ? document.querySelector<HTMLElement>('.operation-error button[title="Dismiss error"]')
        : focusTarget === 'page'
          ? document.querySelector<HTMLElement>('.window-search input')
          : [...document.querySelectorAll<HTMLElement>('.window-close-completion-notice')]
              .find((notice) => notice.dataset.savedWindowId === focusTarget.savedWindowId)
              ?.querySelector<HTMLElement>('button[title="Undo Save & close"]');
    if (element) {
      element.focus();
      pendingWindowCloseResultFocusRef.current = null;
    }
  }, [operationError, pendingWindowCloses, windowCloseCompletionNotices]);

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

  const restoreTabActionFocus = (tabId: number, action: 'pin' | 'suspend') => {
    const className = action === 'pin' ? 'tab-pin-button' : 'tab-suspended-button';
    queueMicrotask(() => {
      const actionButton = document.querySelector<HTMLButtonElement>(
        `.${className}[data-tab-action-id="${tabId}"]`,
      );
      const tabFocusButton = document.querySelector<HTMLButtonElement>(
        `.tab-focus-button[data-tab-focus-id="${tabId}"]`,
      );
      (actionButton ?? tabFocusButton)?.focus();
    });
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
      if (target instanceof Node && !mergeControlRef.current?.contains(target)) {
        closeMergeDialog(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [closeMergeDialog, mergeDialogOpen]);

  const closeSaveWindowDialog = useCallback((restoreFocus = true) => {
    setSaveWindowId(null);
    if (restoreFocus) {
      queueMicrotask(() => saveWindowTriggerRef.current?.focus());
    }
  }, []);

  const openSaveWindowDialog = (windowId: number, trigger: HTMLButtonElement) => {
    saveWindowTriggerRef.current = trigger;
    setMergeDialogOpen(false);
    setDuplicatePreviewMode(false);
    setSaveWindowId(windowId);
  };

  const completeSaveWindow = (result: SaveWindowResult) => {
    if (!mountedRef.current) {
      if (result.sourceWindowClose) {
        finishFastCloseWithoutPage(result.sourceWindowClose);
      }
      return;
    }
    const warningText = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
    setOperationError(null);
    setDuplicateUndoTabs(null);
    if (result.sourceWindowClose && saveWindowTarget) {
      const pendingClose: PendingWindowClose = {
        batchErrorMessage: null,
        delayed: false,
        displayIndex: Math.max(
          0,
          snapshot?.windows.findIndex((activeWindow) => activeWindow.id === saveWindowTarget.id) ??
            0,
        ),
        displayWindow: saveWindowTarget,
        dismissed: false,
        finalizationState: 'idle',
        operation: result.sourceWindowClose,
        savedWindowId: result.savedWindow.id,
        savedWindowName: result.savedWindow.name,
        terminalErrorMessage: null,
        warningText,
        windowId: saveWindowTarget.id,
        windowLabel: saveWindowTarget.label,
      };
      selection.setTabs(
        saveWindowTarget.tabs.map((tab) => tab.id),
        false,
      );
      const closingGroupIds = new Set(saveWindowTarget.groups.map((group) => group.id));
      setSelectedGroupIds((current) => {
        const next = new Set([...current].filter((groupId) => !closingGroupIds.has(groupId)));
        return next.size === current.size ? current : next;
      });
      setPendingWindowCloses((current) => {
        const next = new Map(current);
        next.set(pendingClose.windowId, pendingClose);
        return next;
      });
      if (pendingWindowCloses.size === 0 && snapshot) {
        setPendingWindowCloseSummaryBaseline({
          tabCount: snapshot.totalTabs,
          windowCount: snapshot.windows.length,
        });
      }
      pendingWindowCloseFocusRef.current = {
        savedWindowId: pendingClose.savedWindowId,
        windowId: pendingClose.windowId,
      };
      setOperationNotice(null);
      schedulePendingWindowCloseNotice(pendingClose);
      closeSaveWindowDialog(false);
      void result.sourceWindowClose.batchCompletion.then(async ({ errorMessage }) => {
        await refresh();
        if (!mountedRef.current || !errorMessage) {
          return;
        }
        setPendingWindowCloses((current) => {
          const latest = current.get(pendingClose.windowId);
          if (latest?.savedWindowId !== pendingClose.savedWindowId) {
            return current;
          }
          const next = new Map(current);
          next.set(pendingClose.windowId, { ...latest, batchErrorMessage: errorMessage });
          return next;
        });
      });
    } else {
      setOperationNotice(`Saved "${result.savedWindow.name}".${warningText}`);
      closeSaveWindowDialog();
    }
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

  const clearSelection = useCallback(() => {
    clearTabSelection();
    setSelectedGroupIds((current) => (current.size === 0 ? current : new Set()));
  }, [clearTabSelection]);

  useEffect(() => {
    if (
      !duplicatePreviewMode ||
      ![...selection.selectedIds].some((tabId) => !duplicatePreviewTabIds.has(tabId))
    ) {
      return;
    }
    const timeoutId = globalThis.setTimeout(clearSelection, 0);
    return () => globalThis.clearTimeout(timeoutId);
  }, [clearSelection, duplicatePreviewMode, duplicatePreviewTabIds, selection.selectedIds]);

  const enterDuplicatePreview = useCallback(() => {
    closeMergeDialog(false);
    clearSelection();
    setQuery('');
    setDuplicatePreviewMode(true);
  }, [clearSelection, closeMergeDialog]);

  useEffect(() => {
    const consumePaletteView = () => {
      if (parseAppRoute(window.location.hash) !== APP_ROUTES.windows) {
        return;
      }
      const view = getAppRouteSearchParams(window.location.hash).get('view');
      if (view !== 'duplicates' && view !== 'merge') {
        return;
      }
      setPaletteViewRequest(view);
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${APP_ROUTES.windows}`,
      );
    };

    consumePaletteView();
    window.addEventListener('hashchange', consumePaletteView);
    return () => window.removeEventListener('hashchange', consumePaletteView);
  }, []);

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
    if (duplicatePreviewMode ? nextQuery !== query : query.trim() && !nextQuery.trim()) {
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

  const suspendTab = async (tabId: number) => {
    const tabIsStillSuspendable =
      snapshot?.windows.some((window) =>
        window.tabs.some((tab) => tab.id === tabId && !tab.active && !isTabSuspended(tab)),
      ) ?? false;
    if (!tabIsStillSuspendable || !beginOperation('Suspending 1 tab')) {
      return;
    }

    try {
      const result = await service.suspendTabs([tabId]);
      setOperationError(summarizeFailures('suspended', result.failures));
      await refresh();
      restoreTabActionFocus(tabId, 'suspend');
    } catch {
      setOperationError('The browser could not suspend that tab.');
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
      restoreTabActionFocus(tabId, 'suspend');
    } catch {
      setOperationError('The browser could not unsuspend that tab.');
    } finally {
      finishOperation();
    }
  };

  const setTabPinned = async (tabId: number, pinned: boolean) => {
    if (!beginOperation(pinned ? 'Pinning tab' : 'Unpinning tab')) {
      return;
    }

    try {
      await (pinned ? service.pinTab(tabId) : service.unpinTab(tabId));
      await refresh();
      restoreTabActionFocus(tabId, 'pin');
    } catch {
      setOperationError(`The browser could not ${pinned ? 'pin' : 'unpin'} that tab.`);
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
      actionSelectedCount === 0 ||
      !beginOperation(`Closing ${pluralize(actionSelectedCount, 'tab')}`)
    ) {
      return;
    }
    try {
      const result = await service.closeTabs(actionSelectedTabIdsInOrder);
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
      !beginOperation(`Moving ${pluralize(actionSelectedCount, 'tab')}`)
    ) {
      return;
    }
    try {
      const result = await service.moveTabsToNewWindow(
        actionSelectedTabIdsInOrder,
        actionSelectedGroupIdsInOrder,
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
    const duplicateTabIds = [...duplicateActionTabIds];
    const duplicateCount = duplicateTabIds.length;
    if (
      duplicateCount === 0 ||
      settingsLoading ||
      !beginOperation(`Removing ${pluralize(duplicateCount, 'duplicate')}`)
    ) {
      return;
    }
    setDuplicateRemovalTabIds(duplicateTabIds);
    try {
      const result = await service.closeDuplicateTabs({
        duplicateGroups: duplicatePlan.duplicateGroups,
        rules: duplicateRules,
        tabIds: duplicateTabIds,
      });
      setTabsSelected(result.closedTabIds, false);
      setOperationError(
        summarizeFailures('closed', result.failures, [
          ...(result.skippedPinnedTabIds.length > 0
            ? [
                `${pluralize(result.skippedPinnedTabIds.length, 'duplicate tab')} left open because ${result.skippedPinnedTabIds.length === 1 ? 'it is' : 'they are'} now pinned.`,
              ]
            : []),
          ...(result.skippedAgentAssociatedTabIds.length > 0
            ? [
                `${pluralize(result.skippedAgentAssociatedTabIds.length, 'duplicate tab')} left open because ${result.skippedAgentAssociatedTabIds.length === 1 ? 'it may' : 'they may'} still be in active agent use.`,
              ]
            : []),
          ...(result.skippedChangedTabIds.length > 0
            ? [
                `${pluralize(result.skippedChangedTabIds.length, 'tab')} left open because Weaver could not safely confirm ${result.skippedChangedTabIds.length === 1 ? 'it was still a duplicate' : 'they were still duplicates'}.`,
              ]
            : []),
        ]),
      );
      if (result.closedTabIds.length > 0) {
        setDuplicateUndoTabs(result.closedTabs.length > 0 ? result.closedTabs : null);
        setOperationNotice(`${pluralize(result.closedTabIds.length, 'duplicate tab')} removed.`);
      }
      await refresh();
    } catch {
      setOperationError('The browser could not remove duplicate tabs.');
    } finally {
      setDuplicateRemovalTabIds(null);
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

  const dismissWindowCloseCompletionNotice = (savedWindowId: string) => {
    pendingWindowCloseResultFocusRef.current = 'page';
    setWindowCloseCompletionNotices((current) =>
      current.filter((notice) => notice.savedWindowId !== savedWindowId),
    );
  };

  const undoCompletedSaveAndClose = async (notice: WindowCloseCompletionNotice) => {
    if (!beginOperation(`Reopening "${notice.savedWindowName}"`)) {
      return;
    }
    try {
      const result = await savedWindowsService.restoreWindow(notice.savedWindowId);
      await refresh();
      if (result.restoredTabCount > 0) {
        pendingWindowCloseResultFocusRef.current = 'page';
        setWindowCloseCompletionNotices((current) =>
          current.filter((candidate) => candidate.savedWindowId !== notice.savedWindowId),
        );
      }

      const warnings = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
      if (result.failures.length === 0 && result.savedWindowRemoved) {
        setOperationNotice(
          `Reopened "${notice.savedWindowName}" and removed it from Saved Windows.${warnings}`,
        );
        return;
      }

      const firstFailure = result.failures[0]?.message;
      const failureDetail = firstFailure ? ` ${firstFailure}` : '';
      if (result.restoredTabCount > 0) {
        setOperationError(
          result.failures.length > 0
            ? `Reopened ${pluralize(result.restoredTabCount, 'tab')} from "${notice.savedWindowName}". ${pluralize(result.failures.length, 'tab')} could not be reopened. A recovery copy remains in Saved Windows.${failureDetail}${warnings}`
            : `Reopened "${notice.savedWindowName}", but its saved copy remains in Saved Windows.${warnings}`,
        );
        return;
      }

      pendingWindowCloseResultFocusRef.current = {
        savedWindowId: notice.savedWindowId,
      };
      setOperationError(
        `The browser could not reopen "${notice.savedWindowName}". Its saved copy remains in Saved Windows.${failureDetail}${warnings}`,
      );
    } catch (error) {
      const detail =
        error instanceof Error && error.message.trim() ? ` ${error.message.trim()}` : '';
      pendingWindowCloseResultFocusRef.current = {
        savedWindowId: notice.savedWindowId,
      };
      setOperationError(
        `The browser could not reopen "${notice.savedWindowName}". Check Saved Windows to see whether the saved copy is still available.${detail}`,
      );
    } finally {
      finishOperation();
    }
  };

  const dismissOperationNotice = () => {
    setOperationNotice(null);
    setDuplicateUndoTabs(null);
  };

  const dismissPendingWindowClose = (pendingClose: PendingWindowClose) => {
    pendingWindowCloseFocusRef.current = {
      savedWindowId: pendingClose.savedWindowId,
      windowId: pendingClose.windowId,
    };
    setPendingWindowCloses((current) => {
      const latest = current.get(pendingClose.windowId);
      if (!latest || latest.savedWindowId !== pendingClose.savedWindowId || latest.dismissed) {
        return current;
      }
      const next = new Map(current);
      next.set(pendingClose.windowId, { ...latest, dismissed: true });
      return next;
    });
  };

  const sortTabs = async (windowId: number | undefined, options: TabSortOptions) => {
    if (!snapshot || settingsLoading || !beginOperation(null, false)) {
      return null;
    }

    try {
      const result =
        windowId === undefined
          ? await service.sortAllWindows(options)
          : await service.sortWindow(windowId, options);
      setOperationError(summarizeWindowFailures(result.failures, result.warnings));
      await refresh();
      return result;
    } catch {
      setOperationError('The browser could not sort the requested tabs.');
      return null;
    } finally {
      finishOperation();
    }
  };

  const applyGlobalSort = async () => {
    const selection: TabSortOptions = {
      criterion: sortCriterion,
      direction: globalSortActionDirection,
    };
    setSortDirection(globalSortActionDirection);
    const result = await sortTabs(undefined, selection);
    if (!result || result.sortedWindowIds.length === 0) {
      return;
    }

    setAppliedGlobalSortSelection(selection);
    setAppliedWindowSortSelections((current) => {
      const next = new Map(current);
      result.sortedWindowIds.forEach((windowId) => next.set(windowId, selection));
      return next;
    });
  };

  const applyWindowSort = async (
    windowId: number,
    selection: Pick<TabSortOptions, 'criterion' | 'direction'>,
  ) => {
    const appliedSelection: TabSortOptions = {
      ...selection,
    };
    updateWindowSortSelection(windowId, { direction: selection.direction });
    const result = await sortTabs(windowId, appliedSelection);
    if (!result?.sortedWindowIds.includes(windowId)) {
      return;
    }

    setAppliedWindowSortSelections((current) => {
      const next = new Map(current);
      next.set(windowId, appliedSelection);
      return next;
    });
  };

  const openMergeDialog = () => {
    if (!snapshot || snapshot.windows.length < 2) {
      return;
    }
    setDuplicatePreviewMode(false);
    setMergeWindowIds(new Set());
    updateMergeDialogPosition();
    setMergeDialogOpen(true);
  };

  const toggleMergeWindow = (windowId: number, selected: boolean) => {
    setMergeWindowIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(windowId);
      } else {
        next.delete(windowId);
      }
      return next;
    });
  };

  const setAllMergeWindows = (selected: boolean) => {
    setMergeWindowIds(
      new Set(selected ? (snapshot?.windows.map((window) => window.id) ?? []) : []),
    );
  };

  const mergeWindows = async () => {
    if (
      orderedMergeWindowIds.length < 2 ||
      !beginOperation(`Merging ${pluralize(orderedMergeWindowIds.length, 'window')}`)
    ) {
      return;
    }
    setMergeDialogOpen(false);

    try {
      const result = await service.mergeWindows(orderedMergeWindowIds);
      clearSelection();
      setQuery('');
      setMergeWindowIds(new Set());
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
    dragSessionRef.current = { groupId: payload.groupId, tabIds };
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
    } catch (error) {
      if (error instanceof Error && error.message === PINNED_TAB_GROUP_MOVE_ERROR_MESSAGE) {
        setOperationError(PINNED_TAB_GROUP_MOVE_ERROR_MESSAGE);
        return;
      }
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

  const displayedSnapshotTotals = snapshot
    ? pendingWindowCloses.size > 0 && pendingWindowCloseSummaryBaseline
      ? pendingWindowCloseSummaryBaseline
      : { tabCount: snapshot.totalTabs, windowCount: snapshot.windows.length }
    : null;
  const totalSummary = displayedSnapshotTotals
    ? `${pluralize(displayedSnapshotTotals.windowCount, 'window')} · ${pluralize(displayedSnapshotTotals.tabCount, 'tab')}`
    : 'Loading windows';
  const compactTotalSummary = displayedSnapshotTotals
    ? `${displayedSnapshotTotals.windowCount}w · ${displayedSnapshotTotals.tabCount}t`
    : 'Loading';
  const visiblePendingWindowClose =
    [...pendingWindowCloses.values()]
      .reverse()
      .find((pendingClose) => pendingClose.delayed && !pendingClose.dismissed) ?? null;
  const hasPendingWindowCloses = pendingWindowCloses.size > 0;
  const headerStatus = (
    <div className="active-window-header-status">
      <span className="window-summary" role="status" aria-label={totalSummary} aria-live="polite">
        <span className="window-summary-full" aria-hidden="true">
          {totalSummary}
        </span>
        <span className="window-summary-compact" aria-hidden="true">
          {compactTotalSummary}
        </span>
      </span>
    </div>
  );
  const duplicateActionLabel =
    duplicatePreviewMode && hasFilter ? 'Close filtered duplicate tabs' : 'Close duplicate tabs';
  const isRemovingDuplicates = duplicateRemovalTabIds !== null;
  const displayedDuplicateActionCount =
    duplicateRemovalRemainingCount ?? duplicateActionTabIds.length;
  const duplicateActionDisabled =
    settingsLoading ||
    duplicateActionTabIds.length === 0 ||
    operationLabel !== null ||
    hasPendingWindowCloses;
  const duplicatePreviewDisabled =
    settingsLoading ||
    operationLabel !== null ||
    hasPendingWindowCloses ||
    (!duplicatePreviewMode && duplicatePlan.duplicateGroups.length === 0);

  useEffect(() => {
    if (
      !paletteViewRequest ||
      status !== 'ready' ||
      !snapshot ||
      (paletteViewRequest === 'duplicates' &&
        (settingsLoading || operationLabel !== null || hasPendingWindowCloses))
    ) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      if (paletteViewRequest === 'duplicates') {
        enterDuplicatePreview();
        setPaletteViewRequest(null);
        queueMicrotask(() => {
          const previewButton = duplicatePreviewButtonRef.current;
          if (previewButton && !previewButton.disabled) {
            previewButton.focus();
          }
        });
        return;
      }
      if (snapshot.windows.length < 2) {
        pendingWindowCloseResultFocusRef.current = 'error';
        setOperationError('Open at least two windows before merging them.');
        setPaletteViewRequest(null);
        return;
      }
      if (operationLabel !== null || hasPendingWindowCloses) {
        return;
      }
      setOperationError(null);
      setDuplicatePreviewMode(false);
      clearSelection();
      setMergeWindowIds(new Set());
      updateMergeDialogPosition();
      setMergeDialogOpen(true);
      setPaletteViewRequest(null);
    });
    return () => {
      cancelled = true;
    };
  }, [
    clearSelection,
    enterDuplicatePreview,
    hasPendingWindowCloses,
    operationLabel,
    paletteViewRequest,
    snapshot,
    status,
    settingsLoading,
    updateMergeDialogPosition,
  ]);
  const removeDuplicatesControl = (
    <div className="duplicate-preview-control">
      <div
        className="duplicate-split-button"
        id="active-duplicate-actions"
        role="group"
        aria-label="Duplicate tab actions"
        tabIndex={-1}
      >
        <button
          id="close-duplicate-tabs-button"
          className={`toolbar-button topbar-remove-duplicates-button duplicate-removal-button${isRemovingDuplicates ? ' is-removing-duplicates' : ''}`}
          type="button"
          aria-label={
            isRemovingDuplicates
              ? 'Closing duplicate tabs'
              : `${duplicateActionLabel}: ${pluralize(displayedDuplicateActionCount, 'tab')}`
          }
          title={duplicateActionLabel}
          disabled={duplicateActionDisabled}
          aria-busy={isRemovingDuplicates || undefined}
          onClick={() => void removeDuplicateTabs()}
        >
          <CopyX aria-hidden="true" size={16} />
          <span className="topbar-action-label">{duplicateActionLabel}</span>
          <span className="toolbar-count" aria-hidden={isRemovingDuplicates || undefined}>
            {displayedDuplicateActionCount}
          </span>
        </button>
        <button
          ref={duplicatePreviewButtonRef}
          id="open-duplicate-preview-button"
          className="toolbar-button topbar-duplicate-preview-button"
          type="button"
          aria-label="Show duplicate tabs only"
          aria-pressed={duplicatePreviewMode}
          title={duplicatePreviewMode ? 'Show all tabs' : 'Show duplicate tabs only'}
          disabled={duplicatePreviewDisabled}
          onClick={() => {
            if (duplicatePreviewMode) {
              closeMergeDialog(false);
              setDuplicatePreviewMode(false);
              return;
            }
            enterDuplicatePreview();
          }}
        >
          <Eye aria-hidden="true" size={16} />
        </button>
      </div>
    </div>
  );
  const mergeControl = (
    <div
      className="merge-control"
      id="active-merge-actions"
      ref={mergeControlRef}
      role="group"
      aria-label="Merge windows"
      tabIndex={-1}
    >
      <button
        ref={mergeButtonRef}
        id="merge-windows-button"
        className="toolbar-button topbar-merge-button"
        type="button"
        aria-label="Merge windows"
        aria-controls="merge-windows-dialog"
        aria-expanded={mergeDialogOpen}
        aria-haspopup="dialog"
        title="Merge windows"
        disabled={
          duplicatePreviewMode ||
          !snapshot ||
          snapshot.windows.length < 2 ||
          operationLabel !== null ||
          hasPendingWindowCloses
        }
        onClick={() => (mergeDialogOpen ? closeMergeDialog() : openMergeDialog())}
      >
        <Merge aria-hidden="true" size={16} />
        <span>Merge windows</span>
      </button>

      {mergeDialogOpen && snapshot ? (
        <MergeWindowsDialog
          disabled={operationLabel !== null || hasPendingWindowCloses}
          horizontalOffset={mergeDialogHorizontalOffset}
          onApply={() => void mergeWindows()}
          onClose={closeMergeDialog}
          onSetAllWindows={setAllMergeWindows}
          onToggleWindow={toggleMergeWindow}
          selectedWindowIds={visibleMergeWindowIds}
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
  const showToolbarStatus =
    (operationLabel !== null && !isRemovingDuplicates) || headerPortalTarget === undefined;

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
      {isRemovingDuplicates ? (
        <span className="sr-only" role="status">
          Closing {pluralize(duplicateRemovalTabIds.length, 'duplicate tab')}
        </span>
      ) : null}

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
              title="Filter tabs by title or URL"
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
            title={selectionButtonClears ? 'Clear selected tabs' : 'Select filtered tabs'}
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
              disabled={
                duplicatePreviewMode ||
                !snapshot ||
                operationLabel !== null ||
                hasPendingWindowCloses
              }
              onChange={setSortCriterion}
            />
            <button
              className="toolbar-button sort-action-button"
              type="button"
              aria-label={`Sort all windows by ${sortCriterion === 'title' ? 'Title' : 'URL'}, ${
                globalSortActionDirectionLabel
              }`}
              aria-describedby={
                globalSortMatchesCurrentOrder ? 'global-sort-state-description' : undefined
              }
              title={
                globalSortMatchesCurrentOrder
                  ? `Sorted ${currentGlobalSortDirectionLabel}. Click to sort ${globalSortActionDirectionLabel}.`
                  : `Sort all ${globalSortActionDirectionLabel}`
              }
              disabled={
                !snapshot ||
                duplicatePreviewMode ||
                snapshot.windows.length === 0 ||
                settingsLoading ||
                operationLabel !== null ||
                hasPendingWindowCloses
              }
              onClick={() => void applyGlobalSort()}
            >
              {!globalSortMatchesCurrentOrder ? (
                <ArrowUpDown aria-hidden="true" size={17} />
              ) : sortDirection === 'asc' ? (
                <ArrowUp aria-hidden="true" size={17} />
              ) : (
                <ArrowDown aria-hidden="true" size={17} />
              )}
              <span>Sort all</span>
              {globalSortMatchesCurrentOrder ? (
                <span id="global-sort-state-description" className="sr-only">
                  Currently sorted by {sortCriterion === 'title' ? 'Title' : 'URL'},{' '}
                  {currentGlobalSortDirectionLabel}.
                </span>
              ) : null}
            </button>
          </div>

          {actionPortalTarget === undefined ? windowActionControls : null}

          <button
            className="toolbar-button"
            type="button"
            title="Move selected tabs to a new window"
            disabled={!canMoveSelectedTabsToNewWindow || operationLabel !== null}
            onClick={() => void moveSelectedTabs()}
          >
            <AppWindow aria-hidden="true" size={16} />
            <span>Open in new window</span>
            <span className="toolbar-count">{actionSelectedCount}</span>
          </button>

          <button
            className="toolbar-button danger-toolbar-button"
            type="button"
            title="Close selected tabs"
            disabled={actionSelectedCount === 0 || operationLabel !== null}
            onClick={() => void closeSelectedTabs()}
          >
            <X aria-hidden="true" size={16} />
            <span>Close</span>
            <span className="toolbar-count">{actionSelectedCount}</span>
          </button>
        </div>

        {showToolbarStatus ? (
          <div className="active-toolbar-status">
            {operationLabel && !isRemovingDuplicates ? (
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
          <button type="button" title="Retry live refresh" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : null}

      {navigationError ? (
        <div className="inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>{navigationError}</span>
          <button type="button" title="Dismiss error" onClick={() => setNavigationError(null)}>
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
        <div className="inline-alert operation-error" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>{operationError}</span>
          <button type="button" title="Dismiss error" onClick={() => setOperationError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {visiblePendingWindowClose ? (
        <div
          className="inline-notice is-window-close-pending"
          role="status"
          aria-atomic="true"
          data-window-close-id={visiblePendingWindowClose.windowId}
        >
          <span>{getPendingWindowCloseNotice(visiblePendingWindowClose)}</span>
          <div className="inline-notice-actions">
            <button
              type="button"
              title="Focus the original window"
              onClick={() => void focusWindow(visiblePendingWindowClose.windowId)}
            >
              Focus window
            </button>
            <button
              type="button"
              title="Dismiss notification"
              onClick={() => dismissPendingWindowClose(visiblePendingWindowClose)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {windowCloseCompletionNotices.map((notice) => (
        <div
          className="inline-notice window-close-completion-notice"
          role="status"
          aria-atomic="true"
          data-saved-window-id={notice.savedWindowId}
          key={notice.savedWindowId}
        >
          <span>{notice.message}</span>
          <div className="inline-notice-actions">
            <button
              className="notice-undo-button"
              type="button"
              aria-label={`Undo Save & close for ${notice.savedWindowName}`}
              title="Undo Save & close"
              disabled={operationLabel !== null}
              onClick={() => void undoCompletedSaveAndClose(notice)}
            >
              Undo
            </button>
            <button
              type="button"
              aria-label={`Dismiss Save & close result for ${notice.savedWindowName}`}
              title="Dismiss notification"
              disabled={operationLabel !== null}
              onClick={() => dismissWindowCloseCompletionNotice(notice.savedWindowId)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}

      {operationNotice ? (
        <div className="inline-notice operation-notice" role="status" aria-atomic="true">
          <span>{operationNotice}</span>
          <div className="inline-notice-actions">
            {duplicateUndoTabs ? (
              <button
                className="notice-undo-button"
                type="button"
                title="Restore closed duplicate tabs"
                onClick={() => void undoDuplicateRemoval()}
              >
                Undo
              </button>
            ) : null}
            <button type="button" title="Dismiss notification" onClick={dismissOperationNotice}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {duplicatePreviewMode && status === 'ready' ? (
        <div className="duplicate-preview-banner" role="status" aria-label="Duplicate tabs view">
          <Eye aria-hidden="true" size={17} />
          <div className="duplicate-preview-banner-copy">
            <strong>Duplicate tabs view</strong>
            <span>
              {duplicatePlan.duplicateGroups.length > 0 &&
              duplicatePlan.duplicateTabIds.length === 0
                ? 'Every duplicate shown is protected and will stay open. Pinned tabs can be unpinned; agent-associated tabs stay open while activity is ongoing or unclear.'
                : 'Tabs labeled Keep stay open. Weaver protects pinned tabs and tabs linked to agents with ongoing or unclear activity. Cleanup closes only tabs labeled Close.'}
            </span>
          </div>
          <div className="duplicate-preview-banner-actions">
            <button
              className={`duplicate-preview-banner-action duplicate-preview-banner-close duplicate-removal-button${isRemovingDuplicates ? ' is-removing-duplicates' : ''}`}
              type="button"
              aria-label={
                isRemovingDuplicates
                  ? 'Closing duplicate tabs'
                  : `${duplicateActionLabel}: ${pluralize(displayedDuplicateActionCount, 'tab')}`
              }
              aria-busy={isRemovingDuplicates || undefined}
              title={duplicateActionLabel}
              disabled={duplicateActionDisabled}
              onClick={() => void removeDuplicateTabs()}
            >
              <span>{duplicateActionLabel}</span>
              <span className="toolbar-count" aria-hidden="true">
                {displayedDuplicateActionCount}
              </span>
            </button>
            <button
              className="duplicate-preview-banner-action duplicate-preview-banner-exit"
              type="button"
              aria-label="Exit duplicate tabs view"
              title="Exit duplicate tabs view"
              onClick={() => setDuplicatePreviewMode(false)}
            >
              Show all tabs
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
          <button type="button" title="Retry loading windows" onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" size={16} />
            Retry
          </button>
        </div>
      ) : null}

      {status === 'ready' &&
      snapshot &&
      snapshot.windows.length === 0 &&
      !hasPendingWindowCloses ? (
        <EmptyState
          icon={PanelsTopLeft}
          title="No browser windows available"
          description="Open a normal browser window to see it here."
        />
      ) : null}

      {status === 'ready' &&
      displayed &&
      snapshot &&
      (snapshot.windows.length > 0 || hasPendingWindowCloses) ? (
        windowColumns.some((column) => column.length > 0) ? (
          <div
            className="window-grid window-grid-columns"
            ref={setWindowGridElement}
            style={{ gridTemplateColumns: `repeat(${windowColumns.length}, minmax(0, 1fr))` }}
          >
            {windowColumns.map((column, columnIndex) => (
              <div className="window-grid-column" key={`window-column-${columnIndex}`}>
                {column.map((window) => {
                  const pendingWindowClose = pendingWindowCloses.get(window.id);
                  const windowClosing = pendingWindowClose !== undefined;
                  const allWindowTabs =
                    pendingWindowClose?.displayWindow.tabs ??
                    snapshot.windows.find((candidate) => candidate.id === window.id)?.tabs ??
                    window.tabs;
                  const windowSortSelection =
                    windowSortSelections.get(window.id) ?? DEFAULT_WINDOW_SORT_SELECTION;
                  const windowSortOptions: TabSortOptions = windowSortSelection;
                  const windowSortMatchesCurrentOrder =
                    sortSelectionsMatch(
                      appliedWindowSortSelections.get(window.id),
                      windowSortOptions,
                    ) && isTabOrderSorted(allWindowTabs, windowSortOptions);
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
                        collapsed={windowClosing ? false : collapsedWindowIds.has(window.id)}
                        closing={windowClosing}
                        disabled={operationLabel !== null}
                        {...(duplicatePreviewMode
                          ? {
                              duplicatePreviewCloseTabIds: duplicateCloseTabIds,
                              duplicatePreviewKeepTabIds: duplicateKeeperTabIds,
                              groupActionTabs: window.tabs,
                            }
                          : {})}
                        extensionOrigin={snapshot.extensionOrigin}
                        draggedGroupId={draggedGroupId}
                        draggedTabIds={draggedTabIds}
                        dropTarget={tabDropTarget}
                        mergeSelected={mergeDialogOpen && visibleMergeWindowIds.has(window.id)}
                        onCloseTab={(tabId) => void closeTab(tabId)}
                        onCloseWindow={(windowId) => void closeWindow(windowId)}
                        onSortCriterionChange={(criterion) =>
                          updateWindowSortSelection(window.id, { criterion })
                        }
                        onSortWindow={(windowId, options) =>
                          void applyWindowSort(windowId, options)
                        }
                        window={window}
                        selectedTabIds={selection.selectedIds}
                        showTabUrls={settings.showTabUrls}
                        sortCriterion={windowSortSelection.criterion}
                        sortDirection={windowSortSelection.direction}
                        sortMatchesCurrentOrder={windowSortMatchesCurrentOrder}
                        windowActionsAvailable={!duplicatePreviewMode}
                        onSetTabsSelected={setTabsSelected}
                        onToggleTabSelected={toggleTabSelected}
                        onToggleCollapsed={toggleWindowCollapsed}
                        onFocusWindow={(windowId) => void focusWindow(windowId)}
                        onFocusTab={(windowId, tabId) => void focusTab(windowId, tabId)}
                        onPinTab={(tabId) => void setTabPinned(tabId, true)}
                        onSaveWindow={openSaveWindowDialog}
                        onSuspendTab={(tabId) => void suspendTab(tabId)}
                        onSuspendWindow={(windowId) => void suspendWindowTabs(windowId)}
                        onUnpinTab={(tabId) => void setTabPinned(tabId, false)}
                        onUnsuspendTab={(tabId) => void unsuspendTab(tabId)}
                        onUnsuspendWindow={(windowId) => void unsuspendWindowTabs(windowId)}
                        onSetGroupSelected={setGroupSelected}
                        onTabDragEnd={endTabDrag}
                        onTabDragLeave={clearTabDropTargetForWindow}
                        onTabDragOver={setTabDropTargetForWindow}
                        onTabDragStart={startTabDrag}
                        onTabDrop={(target) => void dropDraggedTabs(target)}
                        selectedGroupIds={displayedSelectedGroupIds}
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
            {duplicatePreviewMode ? (
              <>
                <Eye aria-hidden="true" size={24} />
                {settingsLoading ? (
                  <h3>Loading duplicate tabs…</h3>
                ) : hasFilter &&
                  duplicatePlan.duplicateGroups.length > 0 &&
                  visibleDuplicateGroups.length === 0 ? (
                  <>
                    <h3>No matching duplicate tabs</h3>
                    <button type="button" title="Clear tab filter" onClick={() => updateQuery('')}>
                      Clear filter
                    </button>
                  </>
                ) : (
                  <>
                    <h3>No duplicate tabs</h3>
                    <button
                      type="button"
                      title="Exit duplicate tabs view"
                      onClick={() => setDuplicatePreviewMode(false)}
                    >
                      Show all tabs
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <Search aria-hidden="true" size={24} />
                <h3>No matching tabs</h3>
                <button type="button" title="Clear tab filter" onClick={() => updateQuery('')}>
                  Clear filter
                </button>
              </>
            )}
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
