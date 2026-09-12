import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Pause,
  Pin,
  PinOff,
  Play,
  Save,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useRef } from 'react';

import { SelectionCheckbox } from '../../ui/SelectionCheckbox';
import { Tooltip } from '../../ui/Tooltip';
import { AgentAssociatedTabIndicator } from './AgentAssociatedTabIndicator';
import {
  formatTabLocation,
  isNewTabUrl,
  isTabSuspended,
  type ManagedTab,
  type ManagedWindow,
} from './model';
import { type ToggleTabSelection } from './selection';
import { SortCriterionMenu } from './SortCriterionMenu';
import { TabIcon } from './TabIcon';
import { type SortCriterion, type SortDirection, type TabSortOptions } from './tabSort';

interface WindowCardProps {
  allWindowTabs: readonly ManagedTab[];
  collapsed: boolean;
  closing?: boolean;
  closingTabIds?: ReadonlySet<number>;
  disabled: boolean;
  extensionOrigin: string;
  draggedGroupId: number | null;
  draggedTabIds: ReadonlySet<number>;
  dropTarget: TabDropTarget | null;
  duplicatePreviewCloseTabIds?: ReadonlySet<number>;
  duplicatePreviewKeepTabIds?: ReadonlySet<number>;
  groupActionTabs?: readonly ManagedTab[];
  mergeSelected: boolean;
  onCloseSelectedTabs: (windowId: number) => void;
  onCloseTab: (tabId: number) => void;
  onCloseWindow: (windowId: number) => void;
  onFocusTab: (windowId: number, tabId: number) => void;
  onFocusWindow: (windowId: number) => void;
  onPinTab: (tabId: number) => void;
  onSaveWindow: (windowId: number, trigger: HTMLButtonElement) => void;
  onSuspendTab: (tabId: number) => void;
  onSuspendWindow: (windowId: number) => void;
  onUnpinTab: (tabId: number) => void;
  onUnsuspendTab: (tabId: number) => void;
  onUnsuspendWindow: (windowId: number) => void;
  onSetGroupSelected: (groupId: number, tabIds: readonly number[], checked: boolean) => void;
  onSortCriterionChange: (criterion: SortCriterion) => void;
  onTabDragEnd: () => void;
  onTabDragLeave: (windowId: number) => void;
  onTabDragOver: (target: TabDropTarget, pointer: { x: number; y: number }) => void;
  onTabDragStart: (payload: TabDragPayload) => void;
  onTabDrop: (target: TabDropTarget) => void;
  onSetTabsSelected: (tabIds: readonly number[], checked: boolean) => void;
  onSortWindow: (
    windowId: number,
    options: Pick<TabSortOptions, 'criterion' | 'direction'>,
  ) => void;
  onToggleTabSelected: (selection: ToggleTabSelection) => void;
  onToggleCollapsed: (windowId: number) => void;
  selectedGroupIds: ReadonlySet<number>;
  selectedTabIds: ReadonlySet<number>;
  showTabUrls: boolean;
  sortCriterion: SortCriterion;
  sortDirection: SortDirection;
  sortMatchesCurrentOrder: boolean;
  window: ManagedWindow;
  windowActionsAvailable?: boolean;
}

export interface TabDropTarget {
  browserIndex: number;
  groupId: number | null;
  visualIndex: number;
  windowId: number;
}

export interface TabDragPayload {
  groupId: number | null;
  tabIds: readonly number[];
}

function pluralizeTabs(count: number) {
  return `${count} ${count === 1 ? 'tab' : 'tabs'}`;
}

export function WindowCard({
  allWindowTabs,
  collapsed,
  closing = false,
  closingTabIds,
  disabled: disabledProp,
  extensionOrigin,
  draggedGroupId,
  draggedTabIds,
  dropTarget,
  duplicatePreviewCloseTabIds,
  duplicatePreviewKeepTabIds,
  groupActionTabs = allWindowTabs,
  mergeSelected,
  onCloseSelectedTabs,
  onCloseTab,
  onCloseWindow,
  onFocusTab,
  onFocusWindow,
  onPinTab,
  onSaveWindow,
  onSuspendTab,
  onSuspendWindow,
  onUnpinTab,
  onUnsuspendTab,
  onUnsuspendWindow,
  onSetGroupSelected,
  onSortCriterionChange,
  onTabDragEnd,
  onTabDragLeave,
  onTabDragOver,
  onTabDragStart,
  onTabDrop,
  onSetTabsSelected,
  onSortWindow,
  onToggleTabSelected,
  onToggleCollapsed,
  selectedGroupIds,
  selectedTabIds,
  showTabUrls,
  sortCriterion,
  sortDirection,
  sortMatchesCurrentOrder,
  window,
  windowActionsAvailable = true,
}: WindowCardProps) {
  const disabled = disabledProp || closing;
  const suppressGroupFocusRef = useRef(false);
  const groupFocusReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupsById = new Map(window.groups.map((group) => [group.id, group]));
  const groupTabsById = new Map<number, ManagedTab[]>();
  const completeGroupTabsById = new Map<number, ManagedTab[]>();
  const visibleGroupRangesById = new Map<number, { first: number; last: number }>();
  allWindowTabs.forEach((tab) => {
    if (tab.groupId === null) {
      return;
    }
    const groupTabs = completeGroupTabsById.get(tab.groupId) ?? [];
    groupTabs.push(tab);
    completeGroupTabsById.set(tab.groupId, groupTabs);
  });
  groupActionTabs.forEach((tab) => {
    if (tab.groupId === null) {
      return;
    }
    const groupTabs = groupTabsById.get(tab.groupId) ?? [];
    groupTabs.push(tab);
    groupTabsById.set(tab.groupId, groupTabs);
  });
  window.tabs.forEach((tab, index) => {
    if (tab.groupId === null) {
      return;
    }
    const range = visibleGroupRangesById.get(tab.groupId);
    visibleGroupRangesById.set(tab.groupId, {
      first: range?.first ?? index,
      last: index,
    });
  });
  const visibleTabIds = window.tabs.map((tab) => tab.id);
  const selectedCount = visibleTabIds.filter((tabId) => selectedTabIds.has(tabId)).length;
  const selectedWindowTabCount = allWindowTabs.filter((tab) => selectedTabIds.has(tab.id)).length;
  const closeSelectedTabsLabel = `Close ${selectedWindowTabCount} selected ${selectedWindowTabCount === 1 ? 'tab' : 'tabs'} in ${window.label}`;
  const allSelected = visibleTabIds.length > 0 && selectedCount === visibleTabIds.length;
  const suspendableTabCount = allWindowTabs.filter(
    (tab) => !tab.active && !isTabSuspended(tab),
  ).length;
  const suspendedTabCount = allWindowTabs.filter(isTabSuspended).length;
  const sortActionDirection = sortMatchesCurrentOrder
    ? sortDirection === 'asc'
      ? 'desc'
      : 'asc'
    : sortDirection;
  const sortActionDirectionLabel = sortActionDirection === 'asc' ? 'A to Z' : 'Z to A';
  const currentSortDirectionLabel = sortDirection === 'asc' ? 'A to Z' : 'Z to A';
  const sortStateDescriptionId = `window-${window.id}-sort-state-description`;
  const suspendButtonTitle =
    suspendableTabCount > 0
      ? 'Suspend loaded background tabs'
      : suspendedTabCount === allWindowTabs.length
        ? 'All tabs are suspended'
        : 'All background tabs are suspended. Your browser keeps the active tab loaded.';
  const suspendActionExplainsUnavailable = !disabled && suspendableTabCount === 0;
  const appendDropTarget: TabDropTarget = {
    browserIndex: -1,
    groupId: null,
    visualIndex: window.tabs.length,
    windowId: window.id,
  };
  const tabsToRender: readonly ManagedTab[] = collapsed ? [] : window.tabs;

  useEffect(
    () => () => {
      if (groupFocusReleaseTimerRef.current !== null) {
        globalThis.clearTimeout(groupFocusReleaseTimerRef.current);
      }
    },
    [],
  );

  const handleCardDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (disabled || draggedTabIds.size === 0 || (event.target as Element).closest('.tab-list')) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    onTabDragOver(appendDropTarget, { x: event.clientX, y: event.clientY });
  };

  const handleCardDrop = (event: React.DragEvent<HTMLElement>) => {
    if (disabled || draggedTabIds.size === 0 || (event.target as Element).closest('.tab-list')) {
      return;
    }
    event.preventDefault();
    onTabDrop(appendDropTarget);
  };

  const beginTabDrag = (
    event: React.DragEvent<HTMLElement>,
    payload: TabDragPayload,
    windowId: number,
  ) => {
    event.dataTransfer.setData('text/plain', JSON.stringify({ ...payload, windowId }));
    event.dataTransfer.effectAllowed = 'move';
    onTabDragStart(payload);
  };

  return (
    <article
      className={[
        'window-card',
        window.focused ? 'is-focused-window' : '',
        mergeSelected ? 'is-merge-selected' : '',
        dropTarget?.windowId === window.id ? 'is-drop-target' : '',
        !showTabUrls ? 'is-compact-tabs' : '',
        collapsed ? 'is-collapsed' : '',
        closing ? 'is-closing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-window-id={window.id}
      aria-busy={closing || undefined}
      data-operation-locked={closingTabIds?.size && !closing ? true : undefined}
      aria-labelledby={`window-${window.id}-title`}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget;
        const bounds = event.currentTarget.getBoundingClientRect();
        const pointerStillInside =
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom;
        if (
          (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) &&
          !pointerStillInside
        ) {
          onTabDragLeave(window.id);
        }
      }}
      onDragOver={handleCardDragOver}
      onDrop={handleCardDrop}
    >
      <header className="window-card-header">
        <div className="window-identity">
          {!closing ? (
            <SelectionCheckbox
              ariaLabel={`Select all visible tabs in ${window.label}`}
              checked={allSelected}
              disabled={disabled}
              indeterminate={selectedCount > 0 && !allSelected}
              onChange={(checked) => onSetTabsSelected(visibleTabIds, checked)}
            />
          ) : null}
          <div className="window-heading-copy">
            <h3 id={`window-${window.id}-title`}>
              {closing ? (
                <span className="window-heading-static">{window.label}</span>
              ) : (
                <button
                  className="window-heading-button"
                  type="button"
                  aria-current={window.focused ? 'true' : undefined}
                  title="Focus window"
                  onClick={() => onFocusWindow(window.id)}
                >
                  {window.label}
                </button>
              )}
              {!closing ? (
                <span className="window-collapse-state" aria-hidden="true">
                  {collapsed ? (
                    <ChevronRight className="window-heading-chevron" size={15} />
                  ) : (
                    <ChevronDown className="window-heading-chevron" size={15} />
                  )}
                </span>
              ) : null}
            </h3>
            <span className="window-heading-summary">
              {pluralizeTabs(window.tabs.length)}
              {!closing && selectedCount > 0 ? ` (${selectedCount} selected)` : ''}
            </span>
          </div>
        </div>

        {!closing ? (
          <Tooltip content={`${collapsed ? 'Expand' : 'Collapse'} window`} relationship="none">
            <button
              className="window-collapse-button"
              type="button"
              aria-controls={`window-${window.id}-tabs`}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${window.label}`}
              onClick={() => onToggleCollapsed(window.id)}
            />
          </Tooltip>
        ) : null}

        {closing ? (
          <div
            className="window-card-closing-status"
            role="status"
            aria-label={`${window.label}, ${pluralizeTabs(window.tabs.length)}, closing`}
            aria-atomic="true"
            aria-live="polite"
            tabIndex={-1}
          >
            <span className="window-card-closing-spinner" aria-hidden="true" />
            <span>Closing…</span>
          </div>
        ) : windowActionsAvailable ? (
          <div className="window-card-actions">
            <div className="window-sort-controls" role="group" aria-label={`Sort ${window.label}`}>
              <SortCriterionMenu
                ariaLabel={`Sort ${window.label} by`}
                value={sortCriterion}
                disabled={disabled}
                onChange={onSortCriterionChange}
              />
              <Tooltip
                content={
                  sortMatchesCurrentOrder
                    ? `Sorted ${currentSortDirectionLabel}. Click to sort ${sortActionDirectionLabel}.`
                    : `Sort ${sortActionDirectionLabel}`
                }
                relationship="none"
              >
                <button
                  className="toolbar-button sort-action-button"
                  type="button"
                  aria-label={`Sort ${window.label} by ${
                    sortCriterion === 'title' ? 'Title' : 'URL'
                  }, ${sortActionDirectionLabel}`}
                  aria-describedby={sortMatchesCurrentOrder ? sortStateDescriptionId : undefined}
                  disabled={disabled}
                  onClick={() => {
                    onSortWindow(window.id, {
                      criterion: sortCriterion,
                      direction: sortActionDirection,
                    });
                  }}
                >
                  {!sortMatchesCurrentOrder ? (
                    <ArrowUpDown aria-hidden="true" size={17} />
                  ) : sortDirection === 'asc' ? (
                    <ArrowUp aria-hidden="true" size={17} />
                  ) : (
                    <ArrowDown aria-hidden="true" size={17} />
                  )}
                  <span className="sort-action-label" data-tooltip-label>
                    Sort
                  </span>
                  {sortMatchesCurrentOrder ? (
                    <span id={sortStateDescriptionId} className="sr-only">
                      Currently sorted by {sortCriterion === 'title' ? 'Title' : 'URL'},{' '}
                      {currentSortDirectionLabel}.
                    </span>
                  ) : null}
                </button>
              </Tooltip>
            </div>
            <Tooltip content="Save window" relationship="none">
              <button
                className="icon-button"
                type="button"
                aria-label={`Save ${window.label}`}
                disabled={disabled}
                onClick={(event) => onSaveWindow(window.id, event.currentTarget)}
              >
                <Save aria-hidden="true" size={17} />
              </button>
            </Tooltip>
            <Tooltip
              content={suspendButtonTitle}
              relationship={suspendActionExplainsUnavailable ? 'description' : 'none'}
            >
              <button
                className="icon-button"
                type="button"
                aria-label={`Suspend tabs in ${window.label}`}
                data-action-unavailable={suspendableTabCount === 0 || undefined}
                aria-disabled={suspendActionExplainsUnavailable || undefined}
                disabled={disabled}
                onClick={() => {
                  if (!suspendActionExplainsUnavailable) {
                    onSuspendWindow(window.id);
                  }
                }}
              >
                <Pause aria-hidden="true" size={17} />
              </button>
            </Tooltip>
            <Tooltip content="Unsuspend all tabs" relationship="none">
              <button
                className="icon-button"
                type="button"
                aria-label={`Unsuspend all tabs in ${window.label}`}
                data-action-unavailable={suspendedTabCount === 0 || undefined}
                disabled={disabled || suspendedTabCount === 0}
                onClick={() => onUnsuspendWindow(window.id)}
              >
                <Play aria-hidden="true" size={17} />
              </button>
            </Tooltip>
            <Tooltip
              content={selectedWindowTabCount > 0 ? closeSelectedTabsLabel : 'Close window'}
              relationship="none"
            >
              <button
                className={`icon-button danger-icon-button${selectedWindowTabCount > 0 ? ' window-close-selected-button' : ''}`}
                type="button"
                aria-label={
                  selectedWindowTabCount > 0 ? closeSelectedTabsLabel : `Close ${window.label}`
                }
                disabled={disabled}
                onClick={() => {
                  if (selectedWindowTabCount > 0) {
                    onCloseSelectedTabs(window.id);
                  } else {
                    onCloseWindow(window.id);
                  }
                }}
              >
                <X aria-hidden="true" size={17} />
                {selectedWindowTabCount > 0 ? (
                  <span className="toolbar-count" aria-hidden="true">
                    {selectedWindowTabCount}
                  </span>
                ) : null}
              </button>
            </Tooltip>
          </div>
        ) : null}
      </header>

      {window.tabs.length > 0 ? (
        <ul
          id={`window-${window.id}-tabs`}
          className={`tab-list${closing ? ' is-closing-snapshot' : ''}`}
          hidden={collapsed}
          inert={closing || undefined}
          onDragOver={(event) => {
            if (event.target === event.currentTarget && draggedTabIds.size > 0 && !disabled) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              onTabDragOver(appendDropTarget, { x: event.clientX, y: event.clientY });
            }
          }}
          onDrop={(event) => {
            if (draggedTabIds.size === 0 || disabled) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onTabDrop(dropTarget?.windowId === window.id ? dropTarget : appendDropTarget);
          }}
        >
          {tabsToRender.map((tab, index) => {
            const group = tab.groupId === null ? undefined : groupsById.get(tab.groupId);
            const beginsGroup =
              group !== undefined && window.tabs[index - 1]?.groupId !== tab.groupId;
            const groupTabs = group ? (groupTabsById.get(group.id) ?? [tab]) : [];
            const completeGroupTabs = group ? (completeGroupTabsById.get(group.id) ?? [tab]) : [];
            const groupTabIds = groupTabs.map((groupTab) => groupTab.id);
            const completeGroupTabIds = new Set(completeGroupTabs.map((groupTab) => groupTab.id));
            const completeGroupAction =
              groupTabIds.length === completeGroupTabIds.size &&
              groupTabIds.every((tabId) => completeGroupTabIds.has(tabId));
            const groupSelectedCount = groupTabIds.filter((tabId) =>
              selectedTabIds.has(tabId),
            ).length;
            const groupSelectedAsUnit =
              group !== undefined &&
              selectedGroupIds.has(group.id) &&
              groupSelectedCount === groupTabIds.length;
            const groupLabel = group?.title || 'Tab group';
            const firstGroupTab = groupTabs[0] ?? tab;
            const selected = selectedTabIds.has(tab.id);
            const suspended = isTabSuspended(tab);
            const duplicatePreviewState = duplicatePreviewCloseTabIds?.has(tab.id)
              ? 'close'
              : duplicatePreviewKeepTabIds?.has(tab.id)
                ? 'keep'
                : null;
            const duplicatePreviewOutcome =
              duplicatePreviewState === 'close'
                ? 'Close'
                : duplicatePreviewState === 'keep'
                  ? 'Keep'
                  : null;
            const duplicatePreviewDescriptionId = `tab-${tab.id}-duplicate-preview-description`;
            const agentAssociatedDescriptionId = `tab-${tab.id}-agent-associated-description`;
            const pinGroupDescriptionId = `tab-${tab.id}-pin-group-description`;
            const suspendedDescriptionId = `tab-${tab.id}-suspended-description`;
            const suspendUnavailable = tab.active && !suspended;
            const suspendUnavailableDescriptionId = `tab-${tab.id}-suspend-unavailable-description`;
            const tabDescriptionIds = [
              suspended ? suspendedDescriptionId : null,
              suspendUnavailable ? suspendUnavailableDescriptionId : null,
              tab.agentAssociated ? agentAssociatedDescriptionId : null,
              duplicatePreviewOutcome ? duplicatePreviewDescriptionId : null,
            ]
              .filter(Boolean)
              .join(' ');
            const suspendedBehavior =
              tab.discarded || tab.unloaded ? 'Reloads when opened.' : 'Resumes when opened.';

            const dropBefore =
              dropTarget?.windowId === window.id && dropTarget.visualIndex === index;

            return (
              <Fragment key={tab.id}>
                {dropBefore ? <li className="tab-drop-indicator" aria-hidden="true" /> : null}
                <li
                  className={[
                    'tab-list-item',
                    tab.active ? 'is-active' : '',
                    tab.active && window.focused ? 'is-active-in-focused-window' : '',
                    selected ? 'is-selected' : '',
                    duplicatePreviewState === 'close' ? 'is-duplicate-preview-close' : '',
                    duplicatePreviewState === 'keep' ? 'is-duplicate-preview-keep' : '',
                    suspended ? 'is-suspended' : '',
                    draggedTabIds.has(tab.id) ? 'is-dragging' : '',
                    draggedGroupId === null && dropTarget?.groupId === group?.id
                      ? 'is-tab-group-drop-target'
                      : '',
                    group ? `group-color-${group.color}` : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  draggable={!disabled}
                  onDragStart={(event) => {
                    if (
                      (event.target as Element).closest(
                        '.tab-close-button, .tab-pin-button, .tab-suspended-button, .selection-checkbox',
                      )
                    ) {
                      event.preventDefault();
                      return;
                    }
                    beginTabDrag(event, { groupId: null, tabIds: [tab.id] }, tab.windowId);
                  }}
                  onDragEnd={onTabDragEnd}
                  onDragOver={(event) => {
                    if (disabled || draggedTabIds.size === 0) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = 'move';
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const insertAfter = event.clientY >= bounds.top + bounds.height / 2;
                    if (draggedGroupId !== null && group) {
                      const fullGroupTabs = groupTabsById.get(group.id) ?? [tab];
                      const visibleRange = visibleGroupRangesById.get(group.id) ?? {
                        first: index,
                        last: index,
                      };
                      onTabDragOver(
                        {
                          browserIndex: insertAfter
                            ? (fullGroupTabs.at(-1)?.index ?? tab.index) + 1
                            : (fullGroupTabs[0]?.index ?? tab.index),
                          groupId: null,
                          visualIndex: insertAfter ? visibleRange.last + 1 : visibleRange.first,
                          windowId: window.id,
                        },
                        { x: event.clientX, y: event.clientY },
                      );
                      return;
                    }
                    onTabDragOver(
                      {
                        browserIndex: tab.index + (insertAfter ? 1 : 0),
                        groupId: group?.id ?? null,
                        visualIndex: index + (insertAfter ? 1 : 0),
                        windowId: window.id,
                      },
                      { x: event.clientX, y: event.clientY },
                    );
                  }}
                >
                  {beginsGroup ? (
                    <div className="tab-group-heading">
                      <SelectionCheckbox
                        ariaLabel={`Select all tabs in ${groupLabel}`}
                        checked={groupSelectedAsUnit}
                        disabled={disabled}
                        indeterminate={!groupSelectedAsUnit && groupSelectedCount > 0}
                        onChange={(checked) => onSetGroupSelected(group.id, groupTabIds, checked)}
                      />
                      <button
                        className="tab-group-focus-button"
                        type="button"
                        draggable={!disabled && completeGroupAction}
                        aria-label={`Focus first tab in ${groupLabel}`}
                        title={`Focus ${firstGroupTab.title}`}
                        disabled={closing}
                        onDragStart={(event) => {
                          if (disabled || !completeGroupAction) {
                            event.preventDefault();
                            event.stopPropagation();
                            return;
                          }
                          event.stopPropagation();
                          suppressGroupFocusRef.current = true;
                          beginTabDrag(
                            event,
                            { groupId: group.id, tabIds: groupTabIds },
                            firstGroupTab.windowId,
                          );
                        }}
                        onDragEnd={(event) => {
                          event.stopPropagation();
                          onTabDragEnd();
                          groupFocusReleaseTimerRef.current = globalThis.setTimeout(() => {
                            suppressGroupFocusRef.current = false;
                            groupFocusReleaseTimerRef.current = null;
                          }, 0);
                        }}
                        onClick={(event) => {
                          if (suppressGroupFocusRef.current) {
                            event.preventDefault();
                            suppressGroupFocusRef.current = false;
                            return;
                          }
                          onFocusTab(firstGroupTab.windowId, firstGroupTab.id);
                        }}
                      >
                        <span className="tab-group-color-dot" aria-hidden="true" />
                        <span>{groupLabel}</span>
                        {group.collapsed ? <small>Collapsed</small> : null}
                      </button>
                    </div>
                  ) : null}

                  <div
                    className="tab-row"
                    onMouseDownCapture={(event) => {
                      if (event.button === 1) {
                        event.preventDefault();
                      }
                    }}
                    onAuxClick={(event) => {
                      if (event.button !== 1) {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      if (!disabled) {
                        onCloseTab(tab.id);
                      }
                    }}
                  >
                    <span className="tab-drag-handle" title="Drag tab" aria-hidden="true">
                      <GripVertical size={14} />
                    </span>
                    <input
                      className="selection-checkbox tab-selection-checkbox"
                      type="checkbox"
                      aria-label={`Select ${tab.title}`}
                      checked={selected}
                      disabled={disabled}
                      onChange={() => undefined}
                      onClick={(event) =>
                        onToggleTabSelected({
                          checked: event.currentTarget.checked,
                          extendRange: event.shiftKey,
                          orderedTabIds: visibleTabIds,
                          tabId: tab.id,
                          windowId: tab.windowId,
                        })
                      }
                    />
                    <button
                      className="tab-focus-button"
                      type="button"
                      data-tab-focus-id={tab.id}
                      draggable={!disabled}
                      aria-label={`Focus ${tab.title}`}
                      aria-describedby={tabDescriptionIds || undefined}
                      aria-current={tab.active ? 'page' : undefined}
                      title={tab.url || tab.title}
                      disabled={closing}
                      onDragStart={(event) => {
                        event.stopPropagation();
                        beginTabDrag(event, { groupId: null, tabIds: [tab.id] }, tab.windowId);
                      }}
                      onDragEnd={(event) => {
                        event.stopPropagation();
                        onTabDragEnd();
                      }}
                      onClick={() => onFocusTab(tab.windowId, tab.id)}
                    >
                      <TabIcon
                        fallback={isNewTabUrl(tab.url) ? 'new-tab' : 'page'}
                        iconUrl={tab.iconUrl}
                      />
                      <span className="tab-copy">
                        <span className="tab-title">{tab.title}</span>
                        {showTabUrls ? (
                          <span className="tab-location">
                            {formatTabLocation(tab.url, extensionOrigin)}
                          </span>
                        ) : null}
                      </span>
                      {tab.agentAssociated || duplicatePreviewOutcome ? (
                        <span className="tab-state-icons">
                          {tab.agentAssociated ? (
                            <AgentAssociatedTabIndicator
                              dedupeProtected={tab.agentDedupeProtected}
                              id={agentAssociatedDescriptionId}
                            />
                          ) : null}
                          {duplicatePreviewOutcome ? (
                            <span
                              id={duplicatePreviewDescriptionId}
                              className={`duplicate-preview-outcome is-${duplicatePreviewState}`}
                            >
                              {duplicatePreviewOutcome}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                      {tab.active ? <span className="sr-only">Active tab</span> : null}
                    </button>
                    <div className="tab-inline-actions">
                      <Tooltip
                        content={
                          tab.pinned
                            ? 'Unpin tab'
                            : tab.groupId !== null
                              ? 'Pin tab (removes it from its group)'
                              : 'Pin tab'
                        }
                        relationship="none"
                      >
                        <button
                          className={`tab-pin-button ${tab.pinned ? 'is-state-action' : 'is-reveal-action'}`}
                          type="button"
                          data-tab-action-id={tab.id}
                          draggable={false}
                          aria-describedby={
                            !tab.pinned && tab.groupId !== null ? pinGroupDescriptionId : undefined
                          }
                          aria-label={`${tab.pinned ? 'Unpin' : 'Pin'} ${tab.title}`}
                          aria-pressed={tab.pinned}
                          disabled={disabled}
                          onDragStart={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (tab.pinned) {
                              onUnpinTab(tab.id);
                            } else {
                              onPinTab(tab.id);
                            }
                          }}
                        >
                          <Pin
                            className="tab-pin-icon tab-pin-icon-pinned"
                            aria-hidden="true"
                            size={13}
                          />
                          {tab.pinned ? (
                            <PinOff
                              className="tab-pin-icon tab-pin-icon-unpin"
                              aria-hidden="true"
                              size={13}
                            />
                          ) : null}
                          {!tab.pinned && tab.groupId !== null ? (
                            <span id={pinGroupDescriptionId} className="sr-only">
                              Pinning removes this tab from its group.
                            </span>
                          ) : null}
                        </button>
                      </Tooltip>
                      {!suspendUnavailable ? (
                        <Tooltip
                          content={suspended ? 'Unsuspend tab' : 'Suspend tab'}
                          relationship="none"
                        >
                          <button
                            className={`tab-suspended-button ${suspended ? 'is-state-action' : 'is-reveal-action'}`}
                            type="button"
                            data-tab-action-id={tab.id}
                            draggable={false}
                            aria-describedby={suspended ? suspendedDescriptionId : undefined}
                            aria-label={`${suspended ? 'Unsuspend' : 'Suspend'} ${tab.title}`}
                            aria-pressed={suspended}
                            disabled={disabled}
                            onDragStart={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (suspended) {
                                onUnsuspendTab(tab.id);
                              } else {
                                onSuspendTab(tab.id);
                              }
                            }}
                          >
                            <Pause
                              className="tab-suspended-icon tab-suspended-icon-pause"
                              aria-hidden="true"
                              size={13}
                            />
                            {suspended ? (
                              <Play
                                className="tab-suspended-icon tab-suspended-icon-play"
                                aria-hidden="true"
                                size={13}
                              />
                            ) : null}
                            {suspended ? (
                              <span id={suspendedDescriptionId} className="sr-only">
                                Suspended. {suspendedBehavior}
                              </span>
                            ) : null}
                          </button>
                        </Tooltip>
                      ) : (
                        <>
                          <Tooltip
                            content="Active tabs can't be suspended. Select another tab in this window first."
                            relationship="none"
                          >
                            <span
                              className="tab-suspended-button is-reveal-action is-unavailable-action"
                              draggable={false}
                              aria-hidden="true"
                            >
                              <Pause
                                className="tab-suspended-icon tab-suspended-icon-pause"
                                aria-hidden="true"
                                size={13}
                              />
                              <span
                                className="tab-suspended-unavailable-slash"
                                aria-hidden="true"
                              />
                            </span>
                          </Tooltip>
                          <span id={suspendUnavailableDescriptionId} className="sr-only">
                            Active tabs cannot be suspended. Select another tab in this window
                            first.
                          </span>
                        </>
                      )}
                    </div>
                    <Tooltip content="Close tab" relationship="none">
                      <button
                        className="tab-close-button"
                        type="button"
                        draggable={false}
                        aria-label={`Close ${tab.title}, tab ${index + 1} of ${window.tabs.length}`}
                        aria-busy={closingTabIds?.has(tab.id) || undefined}
                        disabled={disabled}
                        onDragStart={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          onCloseTab(tab.id);
                        }}
                      >
                        <X aria-hidden="true" size={15} />
                      </button>
                    </Tooltip>
                  </div>
                </li>
              </Fragment>
            );
          })}
          {!collapsed &&
          dropTarget?.windowId === window.id &&
          dropTarget.visualIndex === window.tabs.length ? (
            <li className="tab-drop-indicator" aria-hidden="true" />
          ) : null}
        </ul>
      ) : !closing ? (
        <p className="window-empty">This window has no available tabs.</p>
      ) : null}
    </article>
  );
}
