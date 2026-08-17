import {
  AlertTriangle,
  AppWindow,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Copy,
  CopyX,
  Eye,
  ExternalLink,
  ListChecks,
  Merge,
  Pencil,
  Pin,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { APP_ROUTES, getAppRouteSearchParams, parseAppRoute } from '../app/routes';
import { getMergeDialogHorizontalOffset } from '../features/active-windows/mergeDialogPosition';
import { formatTabLocation } from '../features/active-windows/model';
import { SortCriterionMenu } from '../features/active-windows/SortCriterionMenu';
import {
  type SortCriterion,
  type SortDirection,
  type TabSortOptions,
} from '../features/active-windows/tabSort';
import { MergeSavedWindowsDialog } from '../features/saved-windows/MergeSavedWindowsDialog';
import { MoveSavedTabsDialog } from '../features/saved-windows/MoveSavedTabsDialog';
import { type SavedWindow } from '../features/saved-windows/savedWindowModel';
import {
  isSavedWindowTabOrderSorted,
  planSavedWindowDeduplication,
  type SavedTabSelectionReference,
} from '../features/saved-windows/savedWindowOperations';
import {
  createSavedWindowsService,
  type OpenSavedTabInput,
  type RestoreSavedWindowResult,
  SavedWindowsMutationConflictError,
  type SavedWindowsMutationUndo,
  type SavedWindowsService,
} from '../features/saved-windows/savedWindowsService';
import { useSavedWindows } from '../features/saved-windows/useSavedWindows';
import { createSettingsService, type SettingsService } from '../features/settings/settingsService';
import { useSettings } from '../features/settings/useSettings';
import { EmptyState } from '../ui/EmptyState';
import { SelectionCheckbox } from '../ui/SelectionCheckbox';

interface SavedWindowsPageProps {
  actionPortalTarget?: Element | null;
  headerPortalTarget?: Element | null;
  onWindowCountChange?: ((count: number | null) => void) | undefined;
  service?: SavedWindowsService | undefined;
  settingsService?: SettingsService | undefined;
}

type SavedWindowOperation =
  | 'deduplicate'
  | 'delete'
  | 'keep'
  | 'merge'
  | 'remove-tab'
  | 'move-tabs'
  | 'rename'
  | 'remove-tabs'
  | 'restore'
  | 'sort'
  | 'undo';

interface SavedWindowNotice {
  keepSavedWindow?: SavedWindow;
  message: string;
  undo?: SavedWindowsMutationUndo;
  undoMessage?: string;
}

type SavedDuplicatePreviewOutcome = 'close' | 'keep';
type SavedWindowSortSelection = Pick<TabSortOptions, 'criterion' | 'direction'>;
type PaletteViewRequest = 'duplicates' | 'merge';

interface PaletteRevealTarget {
  groupKey: string | null;
  savedWindowId: string;
  savedWindowUpdatedAt: string | null;
  tabOrder: number | null;
}

const DEFAULT_SAVED_WINDOW_SORT_SELECTION: SavedWindowSortSelection = {
  criterion: 'title',
  direction: 'asc',
};

function sortSelectionsMatch(
  first: TabSortOptions | null | undefined,
  second: TabSortOptions,
): boolean {
  return first?.criterion === second.criterion && first.direction === second.direction;
}

function getSavedTabSelectionKey(
  savedWindowId: string,
  savedWindowUpdatedAt: string,
  tab: SavedWindow['tabs'][number],
): string {
  return JSON.stringify([
    savedWindowId,
    savedWindowUpdatedAt,
    tab.order,
    tab.active,
    tab.groupKey ?? null,
    tab.pinned,
    tab.savedAt ?? null,
    tab.title,
    tab.url,
  ]);
}

function getPaletteSavedWindowTargetId(savedWindowId: string): string {
  return `palette-saved-window-${savedWindowId}`;
}

function getPaletteSavedGroupTargetId(savedWindowId: string, groupKey: string): string {
  return `palette-saved-group-${savedWindowId}-${groupKey}`;
}

function getPaletteSavedTabTargetId(savedWindowId: string, tabOrder: number): string {
  return `palette-saved-tab-${savedWindowId}-${tabOrder}`;
}

function pluralize(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function describeActionError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'The browser could not complete that saved-window action.';
}

function formatSavedTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function isLocalFileUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'file:';
  } catch {
    return false;
  }
}

function summarizeRestore(savedWindow: SavedWindow, result: RestoreSavedWindowResult) {
  const parts = [
    `Restored ${pluralize(result.restoredTabCount, 'tab')} from "${savedWindow.name}".`,
  ];
  if (result.savedWindowRemoved) {
    parts.push('Removed it from Saved Windows.');
  }
  if (result.failures.length > 0) {
    parts.push(
      `${pluralize(result.failures.length, 'tab')} failed. ${result.failures[0]?.message ?? ''}`.trim(),
    );
  }
  if (result.warnings.length > 0) {
    parts.push(result.warnings.join(' '));
  }
  return parts.join(' ');
}

function SavedWindowPreview({
  actionsDisabled,
  duplicatePreviewOutcomes,
  onCopyTabUrl,
  onOpenTab,
  onRemoveTab,
  onToggleTab,
  paletteRevealGroupKey,
  paletteRevealTabOrder,
  removingTabKey,
  savedWindow,
  selectedTabKeys,
}: {
  actionsDisabled: boolean;
  duplicatePreviewOutcomes?: ReadonlyMap<number, SavedDuplicatePreviewOutcome>;
  onCopyTabUrl: (url: string, title: string) => void;
  onOpenTab: (tab: OpenSavedTabInput) => void;
  onRemoveTab?:
    | ((tab: SavedWindow['tabs'][number], trigger: HTMLButtonElement) => void)
    | undefined;
  onToggleTab?:
    | ((
        tab: SavedWindow['tabs'][number],
        checked: boolean,
        extendRange: boolean,
        orderedTabKeys: readonly string[],
      ) => void)
    | undefined;
  paletteRevealGroupKey?: string | null | undefined;
  paletteRevealTabOrder?: number | null | undefined;
  savedWindow: SavedWindow;
  removingTabKey?: string | null | undefined;
  selectedTabKeys?: ReadonlySet<string> | undefined;
}) {
  const groupsByKey = new Map(savedWindow.groups.map((group) => [group.key, group]));
  const orderedTabKeys = savedWindow.tabs.map((tab) =>
    getSavedTabSelectionKey(savedWindow.id, savedWindow.updatedAt, tab),
  );

  return (
    <ul className={`tab-list saved-tab-list${onToggleTab ? ' has-selection-controls' : ''}`}>
      {savedWindow.tabs.map((tab, index) => {
        const group = tab.groupKey ? groupsByKey.get(tab.groupKey) : undefined;
        const beginsGroup = group && savedWindow.tabs[index - 1]?.groupKey !== group.key;
        const duplicatePreviewState = duplicatePreviewOutcomes?.get(tab.order);
        const duplicatePreviewOutcome =
          duplicatePreviewState === 'close'
            ? 'Remove'
            : duplicatePreviewState === 'keep'
              ? 'Keep'
              : null;
        const duplicatePreviewDescriptionId = `saved-tab-${savedWindow.id}-${tab.order}-duplicate-preview-description`;
        const selectionKey = getSavedTabSelectionKey(savedWindow.id, savedWindow.updatedAt, tab);
        const paletteRevealed = paletteRevealTabOrder === tab.order;
        const selected = selectedTabKeys?.has(selectionKey) ?? false;
        const rowActionsDisabled = actionsDisabled || Boolean(selectedTabKeys?.size);
        const removing = removingTabKey === selectionKey;
        const rowClassName = [
          'tab-row',
          'saved-tab-row',
          onToggleTab ? 'has-selection-control' : '',
          selected ? 'is-selected' : '',
          duplicatePreviewState === 'close' ? 'is-duplicate-preview-close' : '',
          duplicatePreviewState === 'keep' ? 'is-duplicate-preview-keep' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <li
            className={[
              'tab-list-item',
              selected ? 'is-selected' : '',
              duplicatePreviewState === 'close' ? 'is-duplicate-preview-close' : '',
              duplicatePreviewState === 'keep' ? 'is-duplicate-preview-keep' : '',
              paletteRevealed ? 'is-palette-reveal' : '',
              group ? `group-color-${group.color}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
            key={`${tab.order}-${tab.url}`}
          >
            {beginsGroup ? (
              <div
                className={`tab-group-heading saved-group-heading${onToggleTab ? ' has-selection-control' : ''}${paletteRevealGroupKey === group.key ? ' is-palette-reveal' : ''}`}
                id={getPaletteSavedGroupTargetId(savedWindow.id, group.key)}
              >
                {onToggleTab ? <span aria-hidden="true" /> : null}
                <div className="saved-group-copy">
                  <span className="tab-group-color-dot saved-group-color" aria-hidden="true" />
                  <span>{group.title || 'Untitled group'}</span>
                  {group.collapsed ? <small>Collapsed</small> : null}
                </div>
              </div>
            ) : null}
            <div className={rowClassName}>
              {onToggleTab ? (
                <SelectionCheckbox
                  ariaLabel={`Select ${tab.title} in ${savedWindow.name}`}
                  checked={selected}
                  disabled={actionsDisabled}
                  onChange={(checked, extendRange) =>
                    onToggleTab(tab, checked, extendRange, orderedTabKeys)
                  }
                />
              ) : null}
              <div className="saved-tab-content">
                <div className="saved-tab-open-area">
                  <button
                    className={`tab-focus-button saved-tab-open-button${onRemoveTab ? ' has-remove-action' : ''}`}
                    id={getPaletteSavedTabTargetId(savedWindow.id, tab.order)}
                    type="button"
                    aria-label={`Open ${tab.title} in a new${tab.pinned ? ' pinned' : ''} tab`}
                    aria-describedby={
                      duplicatePreviewOutcome ? duplicatePreviewDescriptionId : undefined
                    }
                    title={`Open in a new${tab.pinned ? ' pinned' : ''} tab`}
                    disabled={rowActionsDisabled}
                    onClick={() => onOpenTab({ pinned: tab.pinned, url: tab.url })}
                  >
                    <span className="tab-copy saved-tab-copy">
                      <strong className="tab-title">{tab.title}</strong>
                      <span className="tab-location" title={tab.url}>
                        {formatTabLocation(tab.url)}
                      </span>
                    </span>
                    <span className="saved-tab-meta">
                      {duplicatePreviewOutcome ? (
                        <span
                          id={duplicatePreviewDescriptionId}
                          className={`duplicate-preview-outcome is-${duplicatePreviewState}`}
                        >
                          {duplicatePreviewOutcome}
                        </span>
                      ) : null}
                      {tab.pinned ? <Pin aria-label="Pinned" size={13} /> : null}
                    </span>
                    <ExternalLink className="saved-tab-open-icon" aria-hidden="true" size={14} />
                  </button>
                  {onRemoveTab ? (
                    <button
                      className="tab-close-button saved-tab-remove-button"
                      type="button"
                      aria-label={`Remove ${tab.title} from ${savedWindow.name}, saved tab ${tab.order + 1}`}
                      aria-busy={removing || undefined}
                      title="Remove tab from Saved Windows"
                      disabled={rowActionsDisabled}
                      onClick={(event) => onRemoveTab(tab, event.currentTarget)}
                    >
                      <X aria-hidden="true" size={15} />
                    </button>
                  ) : null}
                </div>
                {isLocalFileUrl(tab.url) ? (
                  <button
                    className="saved-tab-copy-url-button"
                    type="button"
                    aria-label={`Copy URL for ${tab.title}`}
                    title="Copy URL"
                    disabled={rowActionsDisabled}
                    onClick={() => onCopyTabUrl(tab.url, tab.title)}
                  >
                    <Copy aria-hidden="true" size={14} />
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function SavedWindowsPage({
  actionPortalTarget,
  headerPortalTarget,
  onWindowCountChange,
  service: providedService,
  settingsService: providedSettingsService,
}: SavedWindowsPageProps) {
  const service = useMemo(() => providedService ?? createSavedWindowsService(), [providedService]);
  const settingsService = useMemo(
    () => providedSettingsService ?? createSettingsService(),
    [providedSettingsService],
  );
  const { cleanupNotice, dismissCleanupNotice, errorMessage, refresh, status, windows } =
    useSavedWindows(service);
  const {
    errorMessage: settingsError,
    isLoading: settingsLoading,
    settings,
  } = useSettings(settingsService);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedFilterIds, setCollapsedFilterIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [paletteRevealTarget, setPaletteRevealTarget] = useState<PaletteRevealTarget | null>(null);
  const [paletteViewRequest, setPaletteViewRequest] = useState<PaletteViewRequest | null>(null);
  const [sortCriterion, setSortCriterion] = useState<SortCriterion>('title');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [appliedGlobalSortSelection, setAppliedGlobalSortSelection] =
    useState<TabSortOptions | null>(null);
  const [windowSortSelections, setWindowSortSelections] = useState<
    ReadonlyMap<string, SavedWindowSortSelection>
  >(() => new Map());
  const [appliedWindowSortSelections, setAppliedWindowSortSelections] = useState<
    ReadonlyMap<string, TabSortOptions>
  >(() => new Map());
  const [selectedTabKeys, setSelectedTabKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [duplicatePreviewMode, setDuplicatePreviewMode] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeDialogHorizontalOffset, setMergeDialogHorizontalOffset] = useState(0);
  const [mergeWindowName, setMergeWindowName] = useState('');
  const [mergeWindowIds, setMergeWindowIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingMergeCount, setPendingMergeCount] = useState<number | null>(null);
  const [pendingSelectedTabCount, setPendingSelectedTabCount] = useState<number | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveDialogReferences, setMoveDialogReferences] = useState<
    readonly SavedTabSelectionReference[]
  >([]);
  const [moveWindowName, setMoveWindowName] = useState('');
  const [moveDialogError, setMoveDialogError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<SavedWindowNotice | null>(null);
  const [operation, setOperation] = useState<{
    id: string | null;
    type: SavedWindowOperation;
  } | null>(null);
  const operationRef = useRef(false);
  const actionErrorDismissRef = useRef<HTMLButtonElement>(null);
  const actionNoticeUndoRef = useRef<HTMLButtonElement>(null);
  const focusActionErrorRef = useRef(false);
  const focusActionNoticeUndoRef = useRef(false);
  const pendingTabRemovalFocusRef = useRef<{
    buttonIndex: number;
    selectionKey: string;
    trigger: HTMLButtonElement;
  } | null>(null);
  const mergeButtonRef = useRef<HTMLButtonElement>(null);
  const mergeControlRef = useRef<HTMLDivElement>(null);
  const duplicatePreviewButtonRef = useRef<HTMLButtonElement>(null);
  const moveTabsButtonRef = useRef<HTMLButtonElement>(null);
  const pendingPaletteRevealScrollRef = useRef(false);
  const pendingPaletteSearchFocusRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectionAnchorByWindowRef = useRef(new Map<string, string>());
  const renameInputRef = useRef<HTMLInputElement>(null);

  const duplicateRules = useMemo(
    () => (settings.advancedDuplicateMatchingEnabled ? settings.deduplicationRules : []),
    [settings.advancedDuplicateMatchingEnabled, settings.deduplicationRules],
  );
  const duplicatePlan = useMemo(
    () => planSavedWindowDeduplication(windows, duplicateRules),
    [duplicateRules, windows],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const hasFilter = normalizedQuery.length > 0;
  const filteredWindows = useMemo(() => {
    if (paletteRevealTarget) {
      const savedWindow = windows.find(
        (candidate) => candidate.id === paletteRevealTarget.savedWindowId,
      );
      if (!savedWindow) {
        return [];
      }
      const versionMatches =
        paletteRevealTarget.savedWindowUpdatedAt === null ||
        paletteRevealTarget.savedWindowUpdatedAt === savedWindow.updatedAt;
      if (
        paletteRevealTarget.tabOrder !== null ||
        paletteRevealTarget.groupKey === null ||
        !versionMatches
      ) {
        return [savedWindow];
      }
      const group = savedWindow.groups.find(
        (candidate) => candidate.key === paletteRevealTarget.groupKey,
      );
      if (!group) {
        return [savedWindow];
      }
      return [
        {
          ...savedWindow,
          groups: [group],
          tabs: savedWindow.tabs.filter((tab) => tab.groupKey === group.key),
        },
      ];
    }
    if (!normalizedQuery) {
      return windows;
    }
    return windows.flatMap((savedWindow) => {
      const windowMatches = savedWindow.name.toLocaleLowerCase().includes(normalizedQuery);
      const matchingGroupKeys = new Set(
        savedWindow.groups
          .filter((group) => group.title.toLocaleLowerCase().includes(normalizedQuery))
          .map((group) => group.key),
      );
      const tabs = savedWindow.tabs.filter(
        (tab) =>
          windowMatches ||
          (tab.groupKey !== undefined && matchingGroupKeys.has(tab.groupKey)) ||
          `${tab.title}\n${tab.url}`.toLocaleLowerCase().includes(normalizedQuery),
      );
      if (tabs.length === 0) {
        return [];
      }
      const visibleGroupKeys = new Set(
        tabs.flatMap((tab) => (tab.groupKey === undefined ? [] : [tab.groupKey])),
      );
      return [
        {
          ...savedWindow,
          groups: savedWindow.groups.filter((group) => visibleGroupKeys.has(group.key)),
          tabs,
        },
      ];
    });
  }, [normalizedQuery, paletteRevealTarget, windows]);
  const tabReferencesByKey = useMemo(() => {
    const references = new Map<string, SavedTabSelectionReference>();
    windows.forEach((savedWindow) => {
      savedWindow.tabs.forEach((tab) => {
        references.set(getSavedTabSelectionKey(savedWindow.id, savedWindow.updatedAt, tab), {
          expectedTab: { ...tab },
          expectedWindowUpdatedAt: savedWindow.updatedAt,
          tabOrder: tab.order,
          windowId: savedWindow.id,
        });
      });
    });
    return references;
  }, [windows]);
  const validSelectedTabKeys = useMemo(
    () => new Set([...selectedTabKeys].filter((key) => tabReferencesByKey.has(key))),
    [selectedTabKeys, tabReferencesByKey],
  );
  const selectedTabReferences = useMemo(
    () =>
      windows.flatMap((savedWindow) =>
        savedWindow.tabs.flatMap((tab) => {
          const reference = tabReferencesByKey.get(
            getSavedTabSelectionKey(savedWindow.id, savedWindow.updatedAt, tab),
          );
          return reference &&
            validSelectedTabKeys.has(
              getSavedTabSelectionKey(savedWindow.id, savedWindow.updatedAt, tab),
            )
            ? [reference]
            : [];
        }),
      ),
    [tabReferencesByKey, validSelectedTabKeys, windows],
  );
  const selectedTabCount = selectedTabReferences.length;
  const displayedSelectedTabCount = pendingSelectedTabCount ?? selectedTabCount;
  const globalSortSelection = useMemo<TabSortOptions>(
    () => ({ criterion: sortCriterion, direction: sortDirection }),
    [sortCriterion, sortDirection],
  );
  const globalSortMatchesCurrentOrder =
    status === 'ready' &&
    windows.length > 0 &&
    sortSelectionsMatch(appliedGlobalSortSelection, globalSortSelection) &&
    windows.every((savedWindow) => isSavedWindowTabOrderSorted(savedWindow, globalSortSelection));
  const globalSortActionDirection: SortDirection = globalSortMatchesCurrentOrder
    ? sortDirection === 'asc'
      ? 'desc'
      : 'asc'
    : sortDirection;
  const globalSortActionDirectionLabel = globalSortActionDirection === 'asc' ? 'A to Z' : 'Z to A';
  const currentGlobalSortDirectionLabel = sortDirection === 'asc' ? 'A to Z' : 'Z to A';
  const moveDialogSelectionChanged =
    moveDialogOpen &&
    (moveDialogReferences.length === 0 ||
      moveDialogReferences.some(
        (reference) =>
          !tabReferencesByKey.has(
            getSavedTabSelectionKey(
              reference.windowId,
              reference.expectedWindowUpdatedAt,
              reference.expectedTab,
            ),
          ),
      ));
  const moveSelectionError =
    moveDialogSelectionChanged && operation?.type !== 'move-tabs'
      ? 'The selected saved tabs changed. Review the selection and try again.'
      : null;
  const duplicatePreviewOutcomesByWindowId = useMemo(() => {
    const outcomes = new Map<string, Map<number, SavedDuplicatePreviewOutcome>>();
    const setOutcome = (
      windowId: string,
      tabOrder: number,
      outcome: SavedDuplicatePreviewOutcome,
    ) => {
      const windowOutcomes =
        outcomes.get(windowId) ?? new Map<number, SavedDuplicatePreviewOutcome>();
      windowOutcomes.set(tabOrder, outcome);
      outcomes.set(windowId, windowOutcomes);
    };
    duplicatePlan.duplicateGroups.forEach((group) => {
      setOutcome(group.keepTab.windowId, group.keepTab.tabOrder, 'keep');
      group.removeTabs.forEach((tab) => setOutcome(tab.windowId, tab.tabOrder, 'close'));
    });
    return outcomes;
  }, [duplicatePlan.duplicateGroups]);
  const displayedWindows = useMemo(() => {
    if (!duplicatePreviewMode) {
      return filteredWindows;
    }
    return windows.flatMap((savedWindow) => {
      const outcomes = duplicatePreviewOutcomesByWindowId.get(savedWindow.id);
      if (!outcomes) {
        return [];
      }
      const tabs = savedWindow.tabs.filter((tab) => outcomes.has(tab.order));
      const visibleGroupKeys = new Set(
        tabs.flatMap((tab) => (tab.groupKey === undefined ? [] : [tab.groupKey])),
      );
      return [
        {
          ...savedWindow,
          groups: savedWindow.groups.filter((group) => visibleGroupKeys.has(group.key)),
          tabs,
        },
      ];
    });
  }, [duplicatePreviewMode, duplicatePreviewOutcomesByWindowId, filteredWindows, windows]);
  const visibleTabKeys = useMemo(
    () =>
      displayedWindows.flatMap((savedWindow) =>
        savedWindow.tabs.map((tab) =>
          getSavedTabSelectionKey(savedWindow.id, savedWindow.updatedAt, tab),
        ),
      ),
    [displayedWindows],
  );
  const orderedMergeWindowIds = useMemo(
    () =>
      windows.flatMap((savedWindow) =>
        mergeWindowIds.has(savedWindow.id) ? [savedWindow.id] : [],
      ),
    [mergeWindowIds, windows],
  );
  const visibleMergeWindowIds = useMemo(
    () => new Set(orderedMergeWindowIds),
    [orderedMergeWindowIds],
  );
  const updateMergeDialogPosition = useCallback(() => {
    const buttonLeft = mergeButtonRef.current?.getBoundingClientRect().left;
    if (buttonLeft === undefined) {
      return;
    }
    setMergeDialogHorizontalOffset(getMergeDialogHorizontalOffset(buttonLeft, window.innerWidth));
  }, []);

  useEffect(() => {
    onWindowCountChange?.(status === 'ready' ? windows.length : null);
  }, [onWindowCountChange, status, windows.length]);

  useEffect(
    () => () => {
      onWindowCountChange?.(null);
    },
    [onWindowCountChange],
  );

  useEffect(() => {
    if ([...selectedTabKeys].every((key) => tabReferencesByKey.has(key))) {
      return;
    }
    window.queueMicrotask(() => {
      setSelectedTabKeys((current) => {
        const next = new Set([...current].filter((key) => tabReferencesByKey.has(key)));
        return next.size === current.size && [...next].every((key) => current.has(key))
          ? current
          : next;
      });
    });
  }, [selectedTabKeys, tabReferencesByKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        mergeDialogOpen ||
        moveDialogOpen ||
        selectedTabCount === 0
      ) {
        return;
      }
      setSelectedTabKeys(new Set());
      selectionAnchorByWindowRef.current.clear();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mergeDialogOpen, moveDialogOpen, selectedTabCount]);

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
    }
  }, [renamingId]);

  useEffect(() => {
    if (operation !== null || !actionNotice?.undo || !focusActionNoticeUndoRef.current) {
      return;
    }
    focusActionNoticeUndoRef.current = false;
    queueMicrotask(() => actionNoticeUndoRef.current?.focus());
  }, [actionNotice, operation]);

  useEffect(() => {
    if (
      operation !== null ||
      (!actionNotice?.undo && !actionError) ||
      !pendingTabRemovalFocusRef.current
    ) {
      return;
    }
    const pendingFocus = pendingTabRemovalFocusRef.current;
    if (!actionError && tabReferencesByKey.has(pendingFocus.selectionKey)) {
      return;
    }
    pendingTabRemovalFocusRef.current = null;
    queueMicrotask(() => {
      const activeElement = document.activeElement;
      const focusWasLost =
        activeElement === null ||
        activeElement === document.body ||
        activeElement === document.documentElement ||
        activeElement === pendingFocus.trigger ||
        !activeElement.isConnected;
      if (!focusWasLost) {
        return;
      }
      const removeButtons = actionError
        ? []
        : Array.from(
            document.querySelectorAll<HTMLButtonElement>('.saved-tab-remove-button:not(:disabled)'),
          );
      const nextRemoveButton = actionError
        ? pendingFocus.trigger.isConnected
          ? pendingFocus.trigger
          : undefined
        : removeButtons[Math.min(pendingFocus.buttonIndex, removeButtons.length - 1)];
      (nextRemoveButton ?? searchInputRef.current ?? actionNoticeUndoRef.current)?.focus({
        preventScroll: true,
      });
    });
  }, [actionError, actionNotice, operation, tabReferencesByKey]);

  useEffect(() => {
    if (operation !== null || !actionError || !focusActionErrorRef.current) {
      return;
    }
    focusActionErrorRef.current = false;
    queueMicrotask(() => actionErrorDismissRef.current?.focus());
  }, [actionError, operation]);

  const closeMergeDialog = useCallback((restoreFocus = true) => {
    setMergeDialogOpen(false);
    if (restoreFocus) {
      queueMicrotask(() => mergeButtonRef.current?.focus());
    }
  }, []);

  const closeMoveDialog = useCallback((restoreFocus = true) => {
    setMoveDialogOpen(false);
    setMoveDialogReferences([]);
    setMoveWindowName('');
    setMoveDialogError(null);
    if (restoreFocus) {
      queueMicrotask(() => {
        const moveTrigger = moveTabsButtonRef.current;
        if (moveTrigger && !moveTrigger.disabled) {
          moveTrigger.focus();
        } else {
          searchInputRef.current?.focus();
        }
      });
    }
  }, []);

  const clearTabSelection = useCallback(() => {
    setSelectedTabKeys(new Set());
    selectionAnchorByWindowRef.current.clear();
  }, []);

  const prepareForTabSelection = () => {
    closeMergeDialog(false);
    closeMoveDialog(false);
    setDeletingId(null);
    setRenamingId(null);
  };

  const updateQuery = (nextQuery: string) => {
    setPaletteRevealTarget(null);
    setQuery(nextQuery);
    if (!nextQuery.trim()) {
      setCollapsedFilterIds(new Set());
    }
  };

  const toggleFilteredSelection = () => {
    if (selectedTabCount > 0) {
      clearTabSelection();
      return;
    }
    prepareForTabSelection();
    setSelectedTabKeys(new Set(visibleTabKeys));
  };

  const setVisibleWindowSelection = (savedWindow: SavedWindow, checked: boolean) => {
    if (checked) {
      prepareForTabSelection();
    }
    const keys = savedWindow.tabs.map((tab) =>
      getSavedTabSelectionKey(savedWindow.id, savedWindow.updatedAt, tab),
    );
    setSelectedTabKeys((current) => {
      const next = new Set(current);
      keys.forEach((key) => (checked ? next.add(key) : next.delete(key)));
      return next;
    });
  };

  const toggleTabSelection = (
    savedWindowId: string,
    savedWindowUpdatedAt: string,
    tab: SavedWindow['tabs'][number],
    checked: boolean,
    extendRange: boolean,
    orderedTabKeys: readonly string[],
  ) => {
    if (checked) {
      prepareForTabSelection();
    }
    const key = getSavedTabSelectionKey(savedWindowId, savedWindowUpdatedAt, tab);
    const anchorKey = selectionAnchorByWindowRef.current.get(savedWindowId);
    const anchorIndex = anchorKey ? orderedTabKeys.indexOf(anchorKey) : -1;
    const tabIndex = orderedTabKeys.indexOf(key);
    const affectedKeys =
      extendRange && anchorIndex >= 0 && tabIndex >= 0
        ? orderedTabKeys.slice(Math.min(anchorIndex, tabIndex), Math.max(anchorIndex, tabIndex) + 1)
        : [key];
    selectionAnchorByWindowRef.current.set(savedWindowId, key);
    setSelectedTabKeys((current) => {
      const next = new Set(current);
      affectedKeys.forEach((affectedKey) =>
        checked ? next.add(affectedKey) : next.delete(affectedKey),
      );
      return next;
    });
  };

  const exitDuplicatePreview = useCallback((restoreFocus = false) => {
    setDuplicatePreviewMode(false);
    if (restoreFocus) {
      queueMicrotask(() => duplicatePreviewButtonRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    const consumePaletteSearch = () => {
      if (parseAppRoute(window.location.hash) !== APP_ROUTES.savedWindows) {
        return;
      }
      const searchParams = getAppRouteSearchParams(window.location.hash);
      const search = searchParams.get('search');
      const savedWindowId = searchParams.get('savedWindowId');
      const groupKey = searchParams.get('groupKey');
      const savedWindowUpdatedAt = searchParams.get('savedWindowUpdatedAt');
      const rawTabOrder = searchParams.get('tabOrder');
      const parsedTabOrder = rawTabOrder === null ? null : Number(rawTabOrder);
      const tabOrder =
        parsedTabOrder !== null && Number.isSafeInteger(parsedTabOrder) && parsedTabOrder >= 0
          ? parsedTabOrder
          : null;
      if (search === null && savedWindowId === null) {
        return;
      }
      closeMergeDialog(false);
      closeMoveDialog(false);
      clearTabSelection();
      exitDuplicatePreview(false);
      setDeletingId(null);
      setRenamingId(null);
      setCollapsedFilterIds(new Set());
      setPaletteRevealTarget(
        savedWindowId === null ? null : { groupKey, savedWindowId, savedWindowUpdatedAt, tabOrder },
      );
      setPaletteViewRequest(null);
      setQuery(savedWindowId !== null && tabOrder !== null ? '' : (search ?? ''));
      pendingPaletteRevealScrollRef.current = savedWindowId !== null;
      pendingPaletteSearchFocusRef.current = true;
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${APP_ROUTES.savedWindows}`,
      );
    };

    consumePaletteSearch();
    window.addEventListener('hashchange', consumePaletteSearch);
    return () => window.removeEventListener('hashchange', consumePaletteSearch);
  }, [clearTabSelection, closeMergeDialog, closeMoveDialog, exitDuplicatePreview]);

  useEffect(() => {
    const consumePaletteView = () => {
      if (parseAppRoute(window.location.hash) !== APP_ROUTES.savedWindows) {
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
        `${window.location.pathname}${window.location.search}${APP_ROUTES.savedWindows}`,
      );
    };

    consumePaletteView();
    window.addEventListener('hashchange', consumePaletteView);
    return () => window.removeEventListener('hashchange', consumePaletteView);
  }, []);

  useEffect(() => {
    if (status !== 'ready' || !pendingPaletteSearchFocusRef.current) {
      return;
    }
    pendingPaletteSearchFocusRef.current = false;
    queueMicrotask(() => searchInputRef.current?.focus({ preventScroll: true }));
  }, [paletteRevealTarget, query, status]);

  useEffect(() => {
    if (status !== 'ready' || !paletteRevealTarget || !pendingPaletteRevealScrollRef.current) {
      return;
    }
    pendingPaletteRevealScrollRef.current = false;
    const savedWindow = windows.find(
      (candidate) => candidate.id === paletteRevealTarget.savedWindowId,
    );
    if (!savedWindow) {
      return;
    }
    const versionMatches =
      paletteRevealTarget.savedWindowUpdatedAt === null ||
      paletteRevealTarget.savedWindowUpdatedAt === savedWindow.updatedAt;
    const tabMatches =
      versionMatches &&
      paletteRevealTarget.tabOrder !== null &&
      savedWindow.tabs.some((tab) => tab.order === paletteRevealTarget.tabOrder);
    const groupMatches =
      versionMatches &&
      paletteRevealTarget.groupKey !== null &&
      savedWindow.groups.some((group) => group.key === paletteRevealTarget.groupKey);
    const targetId = tabMatches
      ? getPaletteSavedTabTargetId(savedWindow.id, paletteRevealTarget.tabOrder as number)
      : groupMatches
        ? getPaletteSavedGroupTargetId(savedWindow.id, paletteRevealTarget.groupKey as string)
        : getPaletteSavedWindowTargetId(savedWindow.id);
    queueMicrotask(() => document.getElementById(targetId)?.scrollIntoView?.({ block: 'center' }));
  }, [paletteRevealTarget, status, windows]);

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
    window.addEventListener('resize', updateMergeDialogPosition);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('resize', updateMergeDialogPosition);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [closeMergeDialog, mergeDialogOpen, updateMergeDialogPosition]);

  const beginOperation = (id: string | null, type: SavedWindowOperation) => {
    if (operationRef.current) {
      return false;
    }
    operationRef.current = true;
    setOperation({ id, type });
    setActionError(null);
    setActionNotice(null);
    return true;
  };

  const finishOperation = () => {
    operationRef.current = false;
    setOperation(null);
  };

  const updateWindowSortSelection = (
    savedWindowId: string,
    update: Partial<SavedWindowSortSelection>,
  ) => {
    setWindowSortSelections((current) => {
      const next = new Map(current);
      next.set(savedWindowId, {
        ...(current.get(savedWindowId) ?? DEFAULT_SAVED_WINDOW_SORT_SELECTION),
        ...update,
      });
      return next;
    });
  };

  const sortSavedTabs = async (savedWindowId: string | undefined, options: TabSortOptions) => {
    if (
      status !== 'ready' ||
      selectedTabCount > 0 ||
      !beginOperation(savedWindowId ?? null, 'sort')
    ) {
      return null;
    }
    closeMergeDialog(false);
    closeMoveDialog(false);
    setDeletingId(null);
    setRenamingId(null);
    try {
      const result =
        savedWindowId === undefined
          ? await service.sortAllWindows(options)
          : await service.sortWindow(savedWindowId, options);
      await refresh();
      if (result.sortedWindowIds.length === 0) {
        setActionNotice({
          message:
            savedWindowId === undefined
              ? 'Saved tabs were already in that order.'
              : 'This saved window was already in that order.',
        });
      } else {
        setActionNotice({
          message:
            savedWindowId === undefined
              ? `Sorted ${pluralize(result.sortedWindowIds.length, 'saved window')}.`
              : 'Sorted the saved window.',
          ...(result.undo
            ? {
                undo: result.undo,
                undoMessage: 'Restored the previous saved-tab order.',
              }
            : {}),
        });
      }
      return result;
    } catch (error) {
      setActionError(describeActionError(error));
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
    const result = await sortSavedTabs(undefined, selection);
    if (!result) {
      return;
    }
    setSortDirection(globalSortActionDirection);
    setAppliedGlobalSortSelection(selection);
    setAppliedWindowSortSelections((current) => {
      const next = new Map(current);
      windows.forEach((savedWindow) => next.set(savedWindow.id, selection));
      return next;
    });
  };

  const applyWindowSort = async (savedWindowId: string, selection: TabSortOptions) => {
    const result = await sortSavedTabs(savedWindowId, selection);
    if (!result) {
      return;
    }
    updateWindowSortSelection(savedWindowId, { direction: selection.direction });
    setAppliedWindowSortSelections((current) => {
      const next = new Map(current);
      next.set(savedWindowId, selection);
      return next;
    });
  };

  const toggleExpanded = (id: string) => {
    if (hasFilter) {
      setCollapsedFilterIds((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      return;
    }
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openMergeDialog = () => {
    if (windows.length < 2 || operation !== null || duplicatePreviewMode || selectedTabCount > 0) {
      return;
    }
    closeMoveDialog(false);
    clearTabSelection();
    setDeletingId(null);
    setRenamingId(null);
    setMergeWindowName('');
    setMergeWindowIds(new Set());
    updateMergeDialogPosition();
    setMergeDialogOpen(true);
  };

  const openMoveDialog = () => {
    if (selectedTabCount === 0 || operation !== null || duplicatePreviewMode) {
      return;
    }
    closeMergeDialog(false);
    setDeletingId(null);
    setRenamingId(null);
    setMoveDialogReferences(
      selectedTabReferences.map((reference) => ({
        ...reference,
        expectedTab: { ...reference.expectedTab },
      })),
    );
    setMoveWindowName('');
    setMoveDialogError(null);
    setMoveDialogOpen(true);
  };

  const toggleMergeWindow = (savedWindowId: string, selected: boolean) => {
    setMergeWindowIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(savedWindowId);
      } else {
        next.delete(savedWindowId);
      }
      return next;
    });
  };

  const setAllMergeWindows = (selected: boolean) => {
    setMergeWindowIds(new Set(selected ? windows.map((savedWindow) => savedWindow.id) : []));
  };

  const startRename = (savedWindow: SavedWindow) => {
    setDeletingId(null);
    setRenamingId(savedWindow.id);
    setRenameValue(savedWindow.name);
    setActionError(null);
  };

  const renameWindow = async (savedWindow: SavedWindow) => {
    if (!beginOperation(savedWindow.id, 'rename')) {
      return;
    }
    try {
      const renamed = await service.renameWindow(savedWindow.id, renameValue);
      setRenamingId(null);
      setActionNotice({ message: `Renamed saved window to "${renamed.name}".` });
      await refresh();
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      finishOperation();
    }
  };

  const deleteWindow = async (savedWindow: SavedWindow) => {
    if (!beginOperation(savedWindow.id, 'delete')) {
      return;
    }
    try {
      await service.deleteWindow(savedWindow.id);
      setDeletingId(null);
      setRenamingId(null);
      setActionNotice({ message: `Deleted "${savedWindow.name}".` });
      await refresh();
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      finishOperation();
    }
  };

  const openSavedTab = async (tab: OpenSavedTabInput) => {
    setActionError(null);
    setActionNotice(null);
    try {
      await service.openTab(tab);
    } catch (error) {
      setActionError(describeActionError(error));
    }
  };

  const copySavedTabUrl = async (url: string, title: string) => {
    setActionError(null);
    setActionNotice(null);
    try {
      await navigator.clipboard.writeText(url);
      setActionNotice({ message: `Copied URL for "${title}".` });
    } catch {
      setActionError('The browser could not copy that URL.');
    }
  };

  const removeSavedTab = async (
    savedWindow: SavedWindow,
    tab: SavedWindow['tabs'][number],
    trigger: HTMLButtonElement,
  ) => {
    const selectionKey = getSavedTabSelectionKey(savedWindow.id, savedWindow.updatedAt, tab);
    const reference = tabReferencesByKey.get(selectionKey);
    if (!reference || selectedTabCount > 0 || !beginOperation(selectionKey, 'remove-tab')) {
      return;
    }
    const buttonIndex = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.saved-tab-remove-button'),
    ).indexOf(trigger);
    pendingTabRemovalFocusRef.current = {
      buttonIndex: Math.max(0, buttonIndex),
      selectionKey,
      trigger,
    };
    closeMergeDialog(false);
    closeMoveDialog(false);
    setDeletingId(null);
    setRenamingId(null);
    try {
      const result = await service.removeSelectedTabs([
        {
          ...reference,
          expectedTab: { ...reference.expectedTab },
        },
      ]);
      setExpandedIds((current) => {
        const next = new Set(current);
        result.removedWindowIds.forEach((savedWindowId) => next.delete(savedWindowId));
        return next;
      });
      await refresh();
      const removedEmptyWindow = result.removedWindowIds.includes(savedWindow.id)
        ? ' Removed the empty saved window.'
        : '';
      setActionNotice({
        message: `Removed "${tab.title}" from "${savedWindow.name}".${removedEmptyWindow}`,
        undo: result.undo,
        undoMessage: `Restored "${tab.title}" to "${savedWindow.name}".`,
      });
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      finishOperation();
    }
  };

  const removeSelectedTabs = async () => {
    const references = selectedTabReferences;
    const tabCount = references.length;
    if (tabCount === 0 || !beginOperation(null, 'remove-tabs')) {
      return;
    }
    setPendingSelectedTabCount(tabCount);
    closeMergeDialog(false);
    closeMoveDialog(false);
    setDeletingId(null);
    setRenamingId(null);
    try {
      const result = await service.removeSelectedTabs(references);
      setExpandedIds((current) => {
        const next = new Set(current);
        result.removedWindowIds.forEach((savedWindowId) => next.delete(savedWindowId));
        return next;
      });
      clearTabSelection();
      await refresh();
      const removedEmptyWindows =
        result.removedWindowIds.length > 0
          ? ` ${pluralize(result.removedWindowIds.length, 'empty saved window')} removed.`
          : '';
      setActionNotice({
        message: `Removed ${pluralize(result.removedTabCount, 'selected tab')} from Saved Windows.${removedEmptyWindows}`,
        undo: result.undo,
        undoMessage:
          result.removedTabCount === 1
            ? 'Restored 1 tab to its original saved window.'
            : `Restored ${result.removedTabCount} tabs to their original saved windows.`,
      });
      focusActionNoticeUndoRef.current = true;
    } catch (error) {
      setActionError(describeActionError(error));
      focusActionErrorRef.current = true;
    } finally {
      setPendingSelectedTabCount(null);
      finishOperation();
    }
  };

  const moveSelectedTabs = async (name: string) => {
    const references = moveDialogReferences;
    const tabCount = references.length;
    if (tabCount === 0 || moveDialogSelectionChanged || !beginOperation(null, 'move-tabs')) {
      return;
    }
    setPendingSelectedTabCount(tabCount);
    setMoveDialogError(null);
    try {
      const result = await service.moveSelectedTabsToNewWindow(references, name);
      setExpandedIds((current) => {
        const next = new Set(current);
        result.removedSourceWindowIds.forEach((savedWindowId) => next.delete(savedWindowId));
        return next;
      });
      clearTabSelection();
      setMoveDialogOpen(false);
      setMoveDialogReferences([]);
      setMoveWindowName('');
      await refresh();
      const removedEmptyWindows =
        result.removedSourceWindowIds.length > 0
          ? ` ${pluralize(result.removedSourceWindowIds.length, 'empty saved window')} removed.`
          : '';
      setActionNotice({
        message: `Moved ${pluralize(result.movedTabCount, 'tab')} into "${result.createdWindow.name}".${removedEmptyWindows}`,
        undo: result.undo,
        undoMessage:
          result.movedTabCount === 1
            ? 'Undid the move. Restored 1 tab to its original saved window.'
            : `Undid the move. Restored ${result.movedTabCount} tabs to their original saved windows.`,
      });
      focusActionNoticeUndoRef.current = true;
    } catch (error) {
      setMoveDialogError(describeActionError(error));
    } finally {
      setPendingSelectedTabCount(null);
      finishOperation();
    }
  };

  const removeDuplicateTabs = async () => {
    if (
      duplicatePlan.duplicateTabCount === 0 ||
      settingsLoading ||
      !beginOperation(null, 'deduplicate')
    ) {
      return;
    }
    setDeletingId(null);
    setRenamingId(null);
    closeMergeDialog(false);
    try {
      const result = await service.deduplicateTabs(duplicateRules);
      setExpandedIds((current) => {
        const next = new Set(current);
        result.removedWindowIds.forEach((savedWindowId) => next.delete(savedWindowId));
        return next;
      });
      await refresh();
      if (result.removedTabCount === 0) {
        setActionNotice({ message: 'No duplicate tabs remained in Saved Windows.' });
        return;
      }
      const affectedWindowCount = result.updatedWindowIds.length + result.removedWindowIds.length;
      const removedEmptyWindows =
        result.removedWindowIds.length > 0
          ? ` ${pluralize(result.removedWindowIds.length, 'empty saved window')} removed.`
          : '';
      setActionNotice({
        message: `Removed ${pluralize(result.removedTabCount, 'duplicate tab')} from ${pluralize(affectedWindowCount, 'saved window')}.${removedEmptyWindows}`,
        ...(result.undo
          ? {
              undo: result.undo,
              undoMessage: `Restored ${pluralize(result.removedTabCount, 'duplicate tab')} to Saved Windows.`,
            }
          : {}),
      });
      if (result.undo) {
        focusActionNoticeUndoRef.current = true;
      }
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      finishOperation();
    }
  };

  const mergeWindows = async (name: string) => {
    const selectedWindowCount = orderedMergeWindowIds.length;
    if (selectedWindowCount < 2 || !beginOperation(null, 'merge')) {
      return;
    }
    setPendingMergeCount(selectedWindowCount);
    closeMergeDialog(false);
    let completed = false;
    try {
      const result = await service.mergeWindows(orderedMergeWindowIds, name);
      setMergeWindowName('');
      setMergeWindowIds(new Set());
      setExpandedIds((current) => {
        const next = new Set(current);
        result.mergedSourceWindowIds.forEach((savedWindowId) => next.delete(savedWindowId));
        return next;
      });
      setRenamingId(null);
      setDeletingId(null);
      await refresh();
      setActionNotice({
        message: `Merged ${pluralize(selectedWindowCount, 'saved window')} into "${result.destinationWindow.name}".`,
        undo: result.undo,
        undoMessage: `Restored ${pluralize(selectedWindowCount, 'saved window')}.`,
      });
      focusActionNoticeUndoRef.current = true;
      completed = true;
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      setPendingMergeCount(null);
      finishOperation();
      if (!completed) {
        setMergeDialogOpen(true);
      }
    }
  };

  const undoSavedWindowsMutation = async () => {
    const notice = actionNotice;
    if (!notice?.undo || !beginOperation(null, 'undo')) {
      return;
    }
    try {
      await service.undoMutation(notice.undo);
      await refresh();
      setMergeWindowIds(new Set());
      setActionNotice({ message: notice.undoMessage ?? 'Undid the Saved Windows change.' });
    } catch (error) {
      setActionError(describeActionError(error));
      if (error instanceof SavedWindowsMutationConflictError) {
        focusActionErrorRef.current = true;
      } else {
        setActionNotice(notice);
        focusActionNoticeUndoRef.current = true;
      }
    } finally {
      finishOperation();
    }
  };

  const restoreWindow = async (savedWindow: SavedWindow) => {
    if (!beginOperation(savedWindow.id, 'restore')) {
      return;
    }
    try {
      const result = await service.restoreWindow(savedWindow.id);
      if (result.savedWindowRemoved) {
        setExpandedIds((current) => {
          const next = new Set(current);
          next.delete(savedWindow.id);
          return next;
        });
        setRenamingId((current) => (current === savedWindow.id ? null : current));
        setDeletingId((current) => (current === savedWindow.id ? null : current));
      }
      await refresh();
      const summary = summarizeRestore(savedWindow, result);
      if (result.failures.length > 0) {
        setActionError(summary);
      } else {
        setActionNotice(
          result.savedWindowRemoved
            ? { keepSavedWindow: savedWindow, message: summary }
            : result.warnings.length > 0
              ? null
              : { message: summary },
        );
        if (!result.savedWindowRemoved && result.warnings.length > 0) {
          setActionError(summary);
        }
      }
    } catch (error) {
      setActionError(describeActionError(error));
    } finally {
      finishOperation();
    }
  };

  const keepRestoredWindow = async () => {
    const notice = actionNotice;
    const savedWindow = notice?.keepSavedWindow;
    if (!notice || !savedWindow || !beginOperation(savedWindow.id, 'keep')) {
      return;
    }
    try {
      await service.keepWindow(savedWindow);
      await refresh();
      setActionNotice({ message: `Kept "${savedWindow.name}" in Saved Windows.` });
    } catch (error) {
      setActionError(describeActionError(error));
      setActionNotice(notice);
    } finally {
      finishOperation();
    }
  };
  const savedTabCount = windows.reduce((total, savedWindow) => total + savedWindow.tabs.length, 0);
  const totalSummary =
    status === 'loading'
      ? 'Loading saved windows'
      : `${pluralize(windows.length, 'saved window')} · ${pluralize(savedTabCount, 'tab')}`;
  const compactTotalSummary =
    status === 'loading' ? 'Loading' : `${windows.length}s · ${savedTabCount}t`;
  const paletteRevealAnnouncement = (() => {
    if (!paletteRevealTarget) {
      return null;
    }
    const savedWindow = windows.find(
      (candidate) => candidate.id === paletteRevealTarget.savedWindowId,
    );
    if (!savedWindow) {
      return null;
    }
    const versionMatches =
      paletteRevealTarget.savedWindowUpdatedAt === null ||
      paletteRevealTarget.savedWindowUpdatedAt === savedWindow.updatedAt;
    const tab = versionMatches
      ? savedWindow.tabs.find((candidate) => candidate.order === paletteRevealTarget.tabOrder)
      : undefined;
    if (tab) {
      return `Showing ${savedWindow.name} with ${tab.title} highlighted.`;
    }
    const group = versionMatches
      ? savedWindow.groups.find((candidate) => candidate.key === paletteRevealTarget.groupKey)
      : undefined;
    if (group) {
      return `Showing ${savedWindow.name} with ${group.title || 'Untitled group'} highlighted.`;
    }
    return `Showing saved window ${savedWindow.name}.`;
  })();
  const headerStatus = (
    <div className="saved-window-header-status">
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
  const removingDuplicates = operation?.type === 'deduplicate';
  const mergingSavedWindows = operation?.type === 'merge';
  const movingSelectedTabs = operation?.type === 'move-tabs';
  const removingSelectedTabs = operation?.type === 'remove-tabs';
  const duplicatePreviewDisabled =
    status !== 'ready' ||
    settingsLoading ||
    operation !== null ||
    selectedTabCount > 0 ||
    (!duplicatePreviewMode && duplicatePlan.duplicateGroupCount === 0);

  useEffect(() => {
    if (
      !paletteViewRequest ||
      status !== 'ready' ||
      (paletteViewRequest === 'duplicates' && (settingsLoading || operation !== null))
    ) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      if (paletteViewRequest === 'duplicates') {
        closeMergeDialog(false);
        closeMoveDialog(false);
        clearTabSelection();
        setDeletingId(null);
        setRenamingId(null);
        setPaletteRevealTarget(null);
        setQuery('');
        setDuplicatePreviewMode(true);
        setPaletteViewRequest(null);
        queueMicrotask(() => {
          const previewButton = duplicatePreviewButtonRef.current;
          if (previewButton && !previewButton.disabled) {
            previewButton.focus();
          }
        });
        return;
      }
      if (windows.length < 2) {
        setActionError('Save at least two windows before merging them.');
        setPaletteViewRequest(null);
        queueMicrotask(() => searchInputRef.current?.focus());
        return;
      }
      if (operation !== null) {
        return;
      }
      closeMoveDialog(false);
      clearTabSelection();
      setDeletingId(null);
      setRenamingId(null);
      setPaletteRevealTarget(null);
      setQuery('');
      setDuplicatePreviewMode(false);
      setMergeWindowName('');
      setMergeWindowIds(new Set());
      updateMergeDialogPosition();
      setMergeDialogOpen(true);
      setPaletteViewRequest(null);
    });
    return () => {
      cancelled = true;
    };
  }, [
    clearTabSelection,
    closeMergeDialog,
    closeMoveDialog,
    operation,
    paletteViewRequest,
    settingsLoading,
    status,
    updateMergeDialogPosition,
    windows.length,
  ]);

  const bulkActionControls = (
    <div className="topbar-window-actions">
      <div className="duplicate-preview-control">
        <div
          className="duplicate-split-button"
          id="saved-duplicate-actions"
          role="group"
          aria-label="Duplicate tab actions"
          tabIndex={-1}
        >
          <button
            id="remove-saved-duplicate-tabs-button"
            className={`toolbar-button topbar-remove-duplicates-button duplicate-removal-button${removingDuplicates ? ' is-removing-duplicates' : ''}`}
            type="button"
            aria-label={
              removingDuplicates
                ? 'Removing duplicate tabs from Saved Windows'
                : `Remove duplicate tabs from Saved Windows: ${pluralize(duplicatePlan.duplicateTabCount, 'tab')}`
            }
            aria-busy={removingDuplicates || undefined}
            title="Remove duplicate tabs from Saved Windows; keeps the newest saved copy"
            disabled={
              status !== 'ready' ||
              settingsLoading ||
              duplicatePlan.duplicateTabCount === 0 ||
              selectedTabCount > 0 ||
              operation !== null
            }
            onClick={() => void removeDuplicateTabs()}
          >
            <CopyX aria-hidden="true" size={16} />
            <span className="topbar-action-label">Remove duplicate tabs</span>
            <span className="toolbar-count" aria-hidden={removingDuplicates || undefined}>
              {duplicatePlan.duplicateTabCount}
            </span>
          </button>
          <button
            ref={duplicatePreviewButtonRef}
            id="saved-duplicate-preview-button"
            className="toolbar-button topbar-duplicate-preview-button"
            type="button"
            aria-label="Show saved duplicate tabs only"
            aria-pressed={duplicatePreviewMode}
            title={duplicatePreviewMode ? 'Show all saved tabs' : 'Show saved duplicate tabs only'}
            disabled={duplicatePreviewDisabled}
            onClick={() => {
              if (duplicatePreviewMode) {
                exitDuplicatePreview();
                return;
              }
              closeMergeDialog(false);
              closeMoveDialog(false);
              clearTabSelection();
              updateQuery('');
              setDeletingId(null);
              setRenamingId(null);
              setDuplicatePreviewMode(true);
            }}
          >
            <Eye aria-hidden="true" size={16} />
          </button>
        </div>
      </div>

      <div
        className="merge-control"
        id="saved-merge-actions"
        ref={mergeControlRef}
        role="group"
        aria-label="Merge saved windows"
        tabIndex={-1}
      >
        <button
          ref={mergeButtonRef}
          id="merge-saved-windows-button"
          className={`toolbar-button topbar-merge-button${mergingSavedWindows ? ' is-merging-saved-windows' : ''}`}
          type="button"
          aria-label={
            mergingSavedWindows && pendingMergeCount !== null
              ? `Merging ${pluralize(pendingMergeCount, 'saved window')}`
              : 'Merge saved windows'
          }
          aria-busy={mergingSavedWindows || undefined}
          aria-controls="merge-saved-windows-dialog"
          aria-expanded={mergeDialogOpen}
          aria-haspopup="dialog"
          title={
            selectedTabCount > 0
              ? 'Clear selected tabs before merging saved windows'
              : 'Merge saved windows'
          }
          disabled={
            status !== 'ready' ||
            windows.length < 2 ||
            operation !== null ||
            duplicatePreviewMode ||
            selectedTabCount > 0
          }
          onClick={() => (mergeDialogOpen ? closeMergeDialog() : openMergeDialog())}
        >
          <Merge aria-hidden="true" size={16} />
          <span>
            {mergingSavedWindows && pendingMergeCount !== null
              ? `Merging ${pendingMergeCount}...`
              : 'Merge saved windows'}
          </span>
        </button>

        {mergeDialogOpen ? (
          <MergeSavedWindowsDialog
            disabled={operation !== null}
            horizontalOffset={mergeDialogHorizontalOffset}
            name={mergeWindowName}
            onApply={(name) => void mergeWindows(name)}
            onClose={closeMergeDialog}
            onNameChange={setMergeWindowName}
            onSetAllWindows={setAllMergeWindows}
            onToggleWindow={toggleMergeWindow}
            selectedWindowIds={visibleMergeWindowIds}
            windows={windows}
          />
        ) : null}
      </div>
    </div>
  );

  return (
    <section className="page-section saved-windows-page" aria-labelledby="saved-windows-heading">
      {paletteRevealAnnouncement ? (
        <span className="sr-only" role="status" aria-live="polite">
          {paletteRevealAnnouncement}
        </span>
      ) : null}
      {headerPortalTarget ? createPortal(headerStatus, headerPortalTarget) : null}
      {actionPortalTarget ? createPortal(bulkActionControls, actionPortalTarget) : null}
      {headerPortalTarget === undefined ? headerStatus : null}
      {actionPortalTarget === undefined ? (
        <div className="saved-windows-toolbar">{bulkActionControls}</div>
      ) : null}
      {removingDuplicates ? (
        <span className="sr-only" role="status">
          Removing {pluralize(duplicatePlan.duplicateTabCount, 'duplicate tab')} from Saved Windows
        </span>
      ) : null}
      {mergingSavedWindows && pendingMergeCount !== null ? (
        <span className="sr-only" role="status">
          Merging {pluralize(pendingMergeCount, 'saved window')}
        </span>
      ) : null}

      <h2 id="saved-windows-heading" className="sr-only">
        Saved browser windows
      </h2>

      <div className="active-windows-toolbar saved-tabs-toolbar">
        <div className="active-toolbar-main">
          <label className="window-search">
            <Search aria-hidden="true" size={17} />
            <span className="sr-only">Filter saved windows, groups, and tabs</span>
            <input
              ref={searchInputRef}
              type="text"
              role="searchbox"
              value={query}
              placeholder="Filter tabs"
              title="Filter saved windows, groups, and tabs"
              disabled={status !== 'ready' || operation !== null || duplicatePreviewMode}
              onChange={(event) => updateQuery(event.target.value)}
            />
            <button
              className={`window-search-clear${query ? '' : ' is-hidden'}`}
              type="button"
              aria-label="Clear saved-tab filter"
              aria-hidden={!query}
              tabIndex={query ? 0 : -1}
              title="Clear filter"
              disabled={!query || status !== 'ready' || operation !== null}
              onClick={() => {
                updateQuery('');
                queueMicrotask(() => searchInputRef.current?.focus());
              }}
            >
              <X aria-hidden="true" size={15} />
            </button>
          </label>

          <button
            className="toolbar-button"
            type="button"
            aria-pressed={selectedTabCount > 0}
            title={selectedTabCount > 0 ? 'Clear selected tabs' : 'Select filtered tabs'}
            disabled={
              status !== 'ready' ||
              operation !== null ||
              duplicatePreviewMode ||
              (selectedTabCount === 0 && (!hasFilter || visibleTabKeys.length === 0))
            }
            onClick={toggleFilteredSelection}
          >
            <ListChecks aria-hidden="true" size={16} />
            <span>{selectedTabCount > 0 ? 'Clear selected' : 'Select filtered'}</span>
            <span className="toolbar-count">
              {selectedTabCount > 0 ? selectedTabCount : visibleTabKeys.length}
            </span>
          </button>

          <div className="sort-controls" role="group" aria-label="Sort all saved windows">
            <SortCriterionMenu
              ariaLabel="Sort all saved windows by"
              value={sortCriterion}
              disabled={
                status !== 'ready' ||
                operation !== null ||
                duplicatePreviewMode ||
                selectedTabCount > 0
              }
              onChange={setSortCriterion}
            />
            <button
              className="toolbar-button sort-action-button"
              type="button"
              aria-label={`Sort all saved windows by ${sortCriterion === 'title' ? 'Title' : 'URL'}, ${globalSortActionDirectionLabel}`}
              aria-describedby={
                globalSortMatchesCurrentOrder ? 'saved-global-sort-state-description' : undefined
              }
              title={
                globalSortMatchesCurrentOrder
                  ? `Sorted ${currentGlobalSortDirectionLabel}. Click to sort ${globalSortActionDirectionLabel}.`
                  : `Sort all ${globalSortActionDirectionLabel}`
              }
              disabled={
                status !== 'ready' ||
                windows.length === 0 ||
                operation !== null ||
                duplicatePreviewMode ||
                selectedTabCount > 0
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
                <span id="saved-global-sort-state-description" className="sr-only">
                  Currently sorted by {sortCriterion === 'title' ? 'Title' : 'URL'},{' '}
                  {currentGlobalSortDirectionLabel}.
                </span>
              ) : null}
            </button>
          </div>

          <button
            ref={moveTabsButtonRef}
            className={`toolbar-button saved-tabs-move-button${movingSelectedTabs ? ' is-merging-saved-windows' : ''}`}
            type="button"
            aria-busy={movingSelectedTabs || undefined}
            aria-controls="move-saved-tabs-dialog"
            aria-expanded={moveDialogOpen}
            aria-haspopup="dialog"
            title="Move selected tabs to a new saved window"
            disabled={selectedTabCount === 0 || operation !== null || duplicatePreviewMode}
            onClick={openMoveDialog}
          >
            <AppWindow aria-hidden="true" size={16} />
            <span>Move to new saved window</span>
            <span className="toolbar-count">{displayedSelectedTabCount}</span>
          </button>

          <button
            className={`toolbar-button danger-toolbar-button duplicate-removal-button${removingSelectedTabs ? ' is-removing-duplicates' : ''}`}
            type="button"
            aria-busy={removingSelectedTabs || undefined}
            title="Remove selected tabs from Saved Windows"
            disabled={selectedTabCount === 0 || operation !== null || duplicatePreviewMode}
            onClick={() => void removeSelectedTabs()}
          >
            <X aria-hidden="true" size={16} />
            <span>Remove tabs</span>
            <span className="toolbar-count">{displayedSelectedTabCount}</span>
          </button>
        </div>
      </div>

      {removingSelectedTabs ? (
        <span className="sr-only" role="status">
          Removing {pluralize(displayedSelectedTabCount, 'selected tab')} from Saved Windows
        </span>
      ) : null}
      {movingSelectedTabs ? (
        <span className="sr-only" role="status">
          Moving {pluralize(displayedSelectedTabCount, 'selected tab')} to a new saved window
        </span>
      ) : null}

      {errorMessage && status === 'ready' ? (
        <div className="inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>Saved windows refresh failed: {errorMessage}</span>
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : null}

      {settingsError ? (
        <div className="inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>Duplicate settings could not be loaded: {settingsError}</span>
        </div>
      ) : null}

      {cleanupNotice ? (
        <div className="inline-alert" role="status">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>{cleanupNotice}</span>
          <button type="button" onClick={() => void dismissCleanupNotice()}>
            Dismiss
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div className="inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>{actionError}</span>
          <button ref={actionErrorDismissRef} type="button" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {actionNotice ? (
        <div className="inline-notice" role="status">
          <span>{actionNotice.message}</span>
          <div className="inline-notice-actions">
            {actionNotice.undo ? (
              <button
                ref={actionNoticeUndoRef}
                className="notice-undo-button"
                type="button"
                disabled={operation !== null}
                onClick={() => void undoSavedWindowsMutation()}
              >
                Undo
              </button>
            ) : null}
            {actionNotice.keepSavedWindow ? (
              <button
                className="notice-undo-button"
                type="button"
                onClick={() => void keepRestoredWindow()}
              >
                Keep saved
              </button>
            ) : null}
            <button type="button" onClick={() => setActionNotice(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {duplicatePreviewMode && status === 'ready' ? (
        <div
          className="duplicate-preview-banner"
          role="status"
          aria-label="Saved duplicate tabs view"
        >
          <Eye aria-hidden="true" size={17} />
          <div className="duplicate-preview-banner-copy">
            <strong>Duplicate tabs view</strong>
            <span>
              Weaver keeps the newest saved copy in each match. Tabs labeled Keep remain; tabs
              labeled Remove are removed from Saved Windows.
            </span>
          </div>
          <div className="duplicate-preview-banner-actions">
            <button
              className={`duplicate-preview-banner-action duplicate-preview-banner-close duplicate-removal-button${removingDuplicates ? ' is-removing-duplicates' : ''}`}
              type="button"
              aria-label={
                removingDuplicates
                  ? 'Removing duplicate tabs from Saved Windows'
                  : `Remove duplicate tabs: ${pluralize(duplicatePlan.duplicateTabCount, 'tab')}`
              }
              aria-busy={removingDuplicates || undefined}
              title="Remove duplicate tabs from Saved Windows"
              disabled={
                settingsLoading || duplicatePlan.duplicateTabCount === 0 || operation !== null
              }
              onClick={() => void removeDuplicateTabs()}
            >
              <span>Remove duplicate tabs</span>
              <span className="toolbar-count" aria-hidden="true">
                {duplicatePlan.duplicateTabCount}
              </span>
            </button>
            <button
              className="duplicate-preview-banner-action duplicate-preview-banner-exit"
              type="button"
              aria-label="Exit saved duplicate tabs view"
              title="Exit saved duplicate tabs view"
              onClick={() => exitDuplicatePreview(true)}
            >
              Show all saved tabs
            </button>
          </div>
        </div>
      ) : null}

      {status === 'loading' ? (
        <div className="saved-window-list saved-window-list-loading" aria-hidden="true">
          {[0, 1, 2].map((item) => (
            <div className="saved-window-skeleton" key={item} />
          ))}
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="load-error" role="alert">
          <AlertTriangle aria-hidden="true" size={24} />
          <h3>Could not load saved windows</h3>
          <p>{errorMessage}</p>
          <button type="button" onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" size={16} />
            Retry
          </button>
        </div>
      ) : null}

      {status === 'ready' && windows.length === 0 && !duplicatePreviewMode ? (
        <EmptyState
          icon={Archive}
          title="No saved windows"
          description="Save a window from Active Windows to keep its tabs for later."
        />
      ) : null}

      {status === 'ready' && duplicatePreviewMode && displayedWindows.length === 0 ? (
        <div className="filter-empty">
          <Eye aria-hidden="true" size={24} />
          <h3>No duplicate tabs</h3>
          <button type="button" onClick={() => exitDuplicatePreview(true)}>
            Show all saved tabs
          </button>
        </div>
      ) : null}

      {status === 'ready' &&
      windows.length > 0 &&
      !duplicatePreviewMode &&
      hasFilter &&
      displayedWindows.length === 0 ? (
        <div className="filter-empty">
          <Search aria-hidden="true" size={24} />
          <h3>No saved items match</h3>
          <p>Try another window, group, tab title, or URL.</p>
          <button
            type="button"
            onClick={() => {
              updateQuery('');
              queueMicrotask(() => searchInputRef.current?.focus());
            }}
          >
            Clear filter
          </button>
        </div>
      ) : null}

      {status === 'ready' && displayedWindows.length > 0 ? (
        <div className="saved-window-list">
          {displayedWindows.map((savedWindow) => {
            const sourceSavedWindow =
              windows.find((candidate) => candidate.id === savedWindow.id) ?? savedWindow;
            const paletteRevealForWindow =
              paletteRevealTarget?.savedWindowId === sourceSavedWindow.id
                ? paletteRevealTarget
                : null;
            const paletteRevealVersionMatches =
              paletteRevealForWindow !== null &&
              (paletteRevealForWindow.savedWindowUpdatedAt === null ||
                paletteRevealForWindow.savedWindowUpdatedAt === sourceSavedWindow.updatedAt);
            const paletteRevealTabOrder =
              paletteRevealVersionMatches &&
              paletteRevealForWindow.tabOrder !== null &&
              sourceSavedWindow.tabs.some((tab) => tab.order === paletteRevealForWindow.tabOrder)
                ? paletteRevealForWindow.tabOrder
                : null;
            const paletteRevealGroupKey =
              paletteRevealVersionMatches &&
              paletteRevealForWindow.groupKey !== null &&
              sourceSavedWindow.groups.some(
                (group) => group.key === paletteRevealForWindow.groupKey,
              )
                ? paletteRevealForWindow.groupKey
                : null;
            const paletteRevealedWindow =
              paletteRevealForWindow !== null &&
              ((paletteRevealForWindow.groupKey === null &&
                paletteRevealForWindow.tabOrder === null) ||
                (paletteRevealTabOrder === null && paletteRevealGroupKey === null));
            const expanded = duplicatePreviewMode
              ? true
              : paletteRevealForWindow
                ? true
                : hasFilter
                  ? !collapsedFilterIds.has(savedWindow.id)
                  : expandedIds.has(savedWindow.id);
            const isRenaming = renamingId === savedWindow.id;
            const isDeleting = deletingId === savedWindow.id;
            const currentOperation = operation?.id === savedWindow.id ? operation.type : null;
            const disabled = operation !== null || selectedTabCount > 0;
            const visibleWindowTabKeys = savedWindow.tabs.map((tab) =>
              getSavedTabSelectionKey(savedWindow.id, savedWindow.updatedAt, tab),
            );
            const selectedVisibleCount = visibleWindowTabKeys.filter((key) =>
              validSelectedTabKeys.has(key),
            ).length;
            const selectedInWindowCount = sourceSavedWindow.tabs.filter((tab) =>
              validSelectedTabKeys.has(
                getSavedTabSelectionKey(sourceSavedWindow.id, sourceSavedWindow.updatedAt, tab),
              ),
            ).length;
            const windowSortSelection =
              windowSortSelections.get(savedWindow.id) ?? DEFAULT_SAVED_WINDOW_SORT_SELECTION;
            const windowSortOptions: TabSortOptions = windowSortSelection;
            const windowSortMatchesCurrentOrder =
              sortSelectionsMatch(
                appliedWindowSortSelections.get(savedWindow.id),
                windowSortOptions,
              ) && isSavedWindowTabOrderSorted(sourceSavedWindow, windowSortOptions);
            const windowSortActionDirection: SortDirection = windowSortMatchesCurrentOrder
              ? windowSortSelection.direction === 'asc'
                ? 'desc'
                : 'asc'
              : windowSortSelection.direction;
            const windowSortActionDirectionLabel =
              windowSortActionDirection === 'asc' ? 'A to Z' : 'Z to A';
            const currentWindowSortDirectionLabel =
              windowSortSelection.direction === 'asc' ? 'A to Z' : 'Z to A';
            const windowSortStateDescriptionId = `saved-window-${savedWindow.id}-sort-state-description`;

            return (
              <article
                className={[
                  'window-card',
                  'saved-window-card',
                  expanded ? '' : 'is-collapsed',
                  mergeDialogOpen && visibleMergeWindowIds.has(savedWindow.id)
                    ? 'is-merge-selected'
                    : '',
                  paletteRevealedWindow ? 'is-palette-reveal' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                id={getPaletteSavedWindowTargetId(savedWindow.id)}
                aria-labelledby={`saved-window-${savedWindow.id}-title`}
                key={savedWindow.id}
              >
                <header className="window-card-header">
                  <div className="window-identity saved-window-identity">
                    {!duplicatePreviewMode ? (
                      <SelectionCheckbox
                        ariaLabel={`Select all visible tabs in ${savedWindow.name}`}
                        checked={
                          visibleWindowTabKeys.length > 0 &&
                          selectedVisibleCount === visibleWindowTabKeys.length
                        }
                        disabled={operation !== null}
                        indeterminate={
                          selectedVisibleCount > 0 &&
                          selectedVisibleCount < visibleWindowTabKeys.length
                        }
                        onChange={(checked) => setVisibleWindowSelection(savedWindow, checked)}
                      />
                    ) : null}
                    <div className="window-heading-copy saved-window-copy">
                      <h3 id={`saved-window-${savedWindow.id}-title`}>
                        <span className="window-heading-static">{savedWindow.name}</span>
                        {!duplicatePreviewMode ? (
                          <span className="window-collapse-state" aria-hidden="true">
                            {expanded ? (
                              <ChevronDown className="window-heading-chevron" size={15} />
                            ) : (
                              <ChevronRight className="window-heading-chevron" size={15} />
                            )}
                          </span>
                        ) : null}
                      </h3>
                      <span className="window-heading-summary">
                        Saved {formatSavedTime(savedWindow.createdAt)} ·{' '}
                        {duplicatePreviewMode
                          ? pluralize(savedWindow.tabs.length, 'matching tab')
                          : hasFilter
                            ? `${pluralize(savedWindow.tabs.length, 'matching tab')} of ${pluralize(sourceSavedWindow.tabs.length, 'tab')}`
                            : `${pluralize(sourceSavedWindow.tabs.length, 'tab')} · ${pluralize(sourceSavedWindow.groups.length, 'group')}`}
                        {selectedInWindowCount > 0 ? ` (${selectedInWindowCount} selected)` : ''}
                      </span>
                    </div>
                  </div>

                  {!duplicatePreviewMode ? (
                    <button
                      className="window-collapse-button"
                      type="button"
                      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${savedWindow.name}`}
                      aria-expanded={expanded}
                      aria-controls={`saved-window-${savedWindow.id}-preview`}
                      title={`${expanded ? 'Collapse' : 'Expand'} saved window`}
                      onClick={() => toggleExpanded(savedWindow.id)}
                    />
                  ) : null}

                  {!duplicatePreviewMode ? (
                    <div className="window-card-actions saved-window-actions">
                      <div
                        className="window-sort-controls"
                        role="group"
                        aria-label={`Sort ${savedWindow.name}`}
                      >
                        <SortCriterionMenu
                          ariaLabel={`Sort ${savedWindow.name} by`}
                          value={windowSortSelection.criterion}
                          disabled={disabled}
                          onChange={(criterion) =>
                            updateWindowSortSelection(savedWindow.id, { criterion })
                          }
                        />
                        <button
                          className="toolbar-button sort-action-button"
                          type="button"
                          aria-label={`Sort ${savedWindow.name} by ${windowSortSelection.criterion === 'title' ? 'Title' : 'URL'}, ${windowSortActionDirectionLabel}`}
                          aria-describedby={
                            windowSortMatchesCurrentOrder ? windowSortStateDescriptionId : undefined
                          }
                          title={
                            windowSortMatchesCurrentOrder
                              ? `Sorted ${currentWindowSortDirectionLabel}. Click to sort ${windowSortActionDirectionLabel}.`
                              : `Sort ${windowSortActionDirectionLabel}`
                          }
                          disabled={disabled}
                          onClick={() =>
                            void applyWindowSort(savedWindow.id, {
                              criterion: windowSortSelection.criterion,
                              direction: windowSortActionDirection,
                            })
                          }
                        >
                          {!windowSortMatchesCurrentOrder ? (
                            <ArrowUpDown aria-hidden="true" size={17} />
                          ) : windowSortSelection.direction === 'asc' ? (
                            <ArrowUp aria-hidden="true" size={17} />
                          ) : (
                            <ArrowDown aria-hidden="true" size={17} />
                          )}
                          <span className="sort-action-label">Sort</span>
                          {windowSortMatchesCurrentOrder ? (
                            <span id={windowSortStateDescriptionId} className="sr-only">
                              Currently sorted by{' '}
                              {windowSortSelection.criterion === 'title' ? 'Title' : 'URL'},{' '}
                              {currentWindowSortDirectionLabel}.
                            </span>
                          ) : null}
                        </button>
                      </div>
                      <button
                        className="toolbar-button primary-button saved-window-restore-button"
                        type="button"
                        aria-busy={currentOperation === 'restore' || undefined}
                        aria-label={`${currentOperation === 'restore' ? 'Restoring' : 'Restore'} ${savedWindow.name}`}
                        title="Restore saved window"
                        disabled={disabled}
                        onClick={() => void restoreWindow(sourceSavedWindow)}
                      >
                        <ArchiveRestore aria-hidden="true" size={16} />
                        <span>Restore</span>
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Rename ${savedWindow.name}`}
                        title="Rename saved window"
                        disabled={disabled}
                        onClick={() => startRename(sourceSavedWindow)}
                      >
                        <Pencil aria-hidden="true" size={16} />
                      </button>
                      <button
                        className="icon-button danger-icon-button"
                        type="button"
                        aria-label={`Delete ${savedWindow.name}`}
                        title="Delete saved window"
                        disabled={disabled}
                        onClick={() => {
                          setRenamingId(null);
                          setDeletingId(savedWindow.id);
                          setActionError(null);
                        }}
                      >
                        <Trash2 aria-hidden="true" size={16} />
                      </button>
                    </div>
                  ) : null}
                </header>

                {isRenaming ? (
                  <form
                    className="saved-window-inline-action"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void renameWindow(sourceSavedWindow);
                    }}
                  >
                    <label>
                      <span className="sr-only">New name for {savedWindow.name}</span>
                      <input
                        ref={renameInputRef}
                        type="text"
                        maxLength={120}
                        value={renameValue}
                        disabled={disabled}
                        onChange={(event) => setRenameValue(event.target.value)}
                      />
                    </label>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Cancel rename"
                      title="Cancel"
                      disabled={disabled}
                      onClick={() => setRenamingId(null)}
                    >
                      <X aria-hidden="true" size={16} />
                    </button>
                    <button
                      className="icon-button primary-icon-button"
                      type="submit"
                      aria-label="Save name"
                      title="Save name"
                      disabled={disabled}
                    >
                      <Save aria-hidden="true" size={16} />
                    </button>
                  </form>
                ) : null}

                {isDeleting ? (
                  <div className="saved-window-delete-confirmation" role="alert">
                    <span>Delete this saved window?</span>
                    <button type="button" disabled={disabled} onClick={() => setDeletingId(null)}>
                      Cancel
                    </button>
                    <button
                      className="danger-confirm-button"
                      type="button"
                      disabled={disabled}
                      onClick={() => void deleteWindow(sourceSavedWindow)}
                    >
                      {currentOperation === 'delete' ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                ) : null}

                <div id={`saved-window-${savedWindow.id}-preview`} hidden={!expanded}>
                  {expanded ? (
                    <SavedWindowPreview
                      actionsDisabled={operation !== null}
                      {...(duplicatePreviewMode
                        ? {
                            duplicatePreviewOutcomes:
                              duplicatePreviewOutcomesByWindowId.get(savedWindow.id) ??
                              new Map<number, SavedDuplicatePreviewOutcome>(),
                          }
                        : {})}
                      onCopyTabUrl={(url, title) => void copySavedTabUrl(url, title)}
                      onOpenTab={(tab) => void openSavedTab(tab)}
                      paletteRevealGroupKey={paletteRevealGroupKey}
                      paletteRevealTabOrder={paletteRevealTabOrder}
                      {...(!duplicatePreviewMode
                        ? {
                            onRemoveTab: (tab, trigger) =>
                              void removeSavedTab(sourceSavedWindow, tab, trigger),
                            onToggleTab: (tab, checked, extendRange, orderedTabKeys) =>
                              toggleTabSelection(
                                savedWindow.id,
                                savedWindow.updatedAt,
                                tab,
                                checked,
                                extendRange,
                                orderedTabKeys,
                              ),
                            removingTabKey: operation?.type === 'remove-tab' ? operation.id : null,
                            selectedTabKeys: validSelectedTabKeys,
                          }
                        : {})}
                      savedWindow={savedWindow}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {moveDialogOpen ? (
        <MoveSavedTabsDialog
          errorMessage={moveSelectionError ?? moveDialogError}
          moving={movingSelectedTabs}
          name={moveWindowName}
          onClose={closeMoveDialog}
          onMove={(name) => void moveSelectedTabs(name)}
          onNameChange={setMoveWindowName}
          selectionChanged={moveDialogSelectionChanged}
          tabCount={moveDialogReferences.length}
        />
      ) : null}
    </section>
  );
}
