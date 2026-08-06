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

import { AgentManagedTabIndicator } from './AgentManagedTabIndicator';
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
  disabled: boolean;
  extensionOrigin: string;
  draggedGroupId: number | null;
  draggedTabIds: ReadonlySet<number>;
  dropTarget: TabDropTarget | null;
  duplicatePreviewCloseTabIds?: ReadonlySet<number>;
  duplicatePreviewKeepTabIds?: ReadonlySet<number>;
  groupActionTabs?: readonly ManagedTab[];
  mergeSelected: boolean;
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

interface SelectionCheckboxProps {
  ariaLabel: string;
  checked: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
}

function SelectionCheckbox({
  ariaLabel,
  checked,
  disabled = false,
  indeterminate = false,
  onChange,
}: SelectionCheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      className="selection-checkbox"
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

export function WindowCard({
  allWindowTabs,
  collapsed,
  disabled,
  extensionOrigin,
  draggedGroupId,
  draggedTabIds,
  dropTarget,
  duplicatePreviewCloseTabIds,
  duplicatePreviewKeepTabIds,
  groupActionTabs = allWindowTabs,
  mergeSelected,
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
  const appendDropTarget: TabDropTarget = {
    browserIndex: -1,
    groupId: null,
    visualIndex: window.tabs.length,
    windowId: window.id,
  };

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
      ]
        .filter(Boolean)
        .join(' ')}
      data-window-id={window.id}
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
          <SelectionCheckbox
            ariaLabel={`Select all visible tabs in ${window.label}`}
            checked={allSelected}
            disabled={disabled}
            indeterminate={selectedCount > 0 && !allSelected}
            onChange={(checked) => onSetTabsSelected(visibleTabIds, checked)}
          />
          <div className="window-heading-copy">
            <h3 id={`window-${window.id}-title`}>
              <button
                className="window-heading-button"
                type="button"
                aria-current={window.focused ? 'true' : undefined}
                title="Focus window"
                onClick={() => onFocusWindow(window.id)}
              >
                {window.label}
              </button>
            </h3>
            <span className="window-heading-summary">
              {pluralizeTabs(window.tabs.length)}
              {selectedCount > 0 ? ` (${selectedCount} selected)` : ''}
            </span>
          </div>
          <span className="window-collapse-state" aria-hidden="true">
            {collapsed ? (
              <ChevronRight className="window-heading-chevron" size={15} />
            ) : (
              <ChevronDown className="window-heading-chevron" size={15} />
            )}
          </span>
        </div>

        <button
          className="window-collapse-button"
          type="button"
          aria-controls={`window-${window.id}-tabs`}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${window.label}`}
          title={`${collapsed ? 'Expand' : 'Collapse'} window`}
          onClick={() => onToggleCollapsed(window.id)}
        />

        {windowActionsAvailable ? (
          <div className="window-card-actions">
            <div className="window-sort-controls" role="group" aria-label={`Sort ${window.label}`}>
              <SortCriterionMenu
                ariaLabel={`Sort ${window.label} by`}
                value={sortCriterion}
                disabled={disabled}
                onChange={onSortCriterionChange}
              />
              <button
                className="toolbar-button sort-action-button"
                type="button"
                aria-label={`Sort ${window.label} by ${sortCriterion === 'title' ? 'Title' : 'URL'}, ${
                  sortActionDirectionLabel
                }`}
                aria-describedby={sortMatchesCurrentOrder ? sortStateDescriptionId : undefined}
                title={
                  sortMatchesCurrentOrder
                    ? `Sorted ${currentSortDirectionLabel}. Click to sort ${sortActionDirectionLabel}.`
                    : `Sort ${sortActionDirectionLabel}`
                }
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
                <span className="sort-action-label">Sort</span>
                {sortMatchesCurrentOrder ? (
                  <span id={sortStateDescriptionId} className="sr-only">
                    Currently sorted by {sortCriterion === 'title' ? 'Title' : 'URL'},{' '}
                    {currentSortDirectionLabel}.
                  </span>
                ) : null}
              </button>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label={`Save ${window.label}`}
              title="Save window"
              disabled={disabled}
              onClick={(event) => onSaveWindow(window.id, event.currentTarget)}
            >
              <Save aria-hidden="true" size={17} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={`Suspend tabs in ${window.label}`}
              title={suspendButtonTitle}
              disabled={disabled || suspendableTabCount === 0}
              onClick={() => onSuspendWindow(window.id)}
            >
              <Pause aria-hidden="true" size={17} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={`Unsuspend all tabs in ${window.label}`}
              title="Unsuspend all tabs"
              disabled={disabled || suspendedTabCount === 0}
              onClick={() => onUnsuspendWindow(window.id)}
            >
              <Play aria-hidden="true" size={17} />
            </button>
            <button
              className="icon-button danger-icon-button"
              type="button"
              aria-label={`Close ${window.label}`}
              title="Close window"
              disabled={disabled}
              onClick={() => onCloseWindow(window.id)}
            >
              <X aria-hidden="true" size={17} />
            </button>
          </div>
        ) : null}
      </header>

      {window.tabs.length > 0 ? (
        <ul
          id={`window-${window.id}-tabs`}
          className="tab-list"
          hidden={collapsed}
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
          {window.tabs.map((tab, index) => {
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
                ? 'Will close'
                : duplicatePreviewState === 'keep'
                  ? 'Keep'
                  : null;
            const duplicatePreviewDescriptionId = `tab-${tab.id}-duplicate-preview-description`;
            const agentManagedDescriptionId = `tab-${tab.id}-agent-managed-description`;
            const pinGroupDescriptionId = `tab-${tab.id}-pin-group-description`;
            const suspendedDescriptionId = `tab-${tab.id}-suspended-description`;
            const suspendUnavailable = tab.active && !suspended;
            const suspendUnavailableDescriptionId = `tab-${tab.id}-suspend-unavailable-description`;
            const tabDescriptionIds = [
              suspended ? suspendedDescriptionId : null,
              suspendUnavailable ? suspendUnavailableDescriptionId : null,
              tab.agentAssociated ? agentManagedDescriptionId : null,
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

                  <div className="tab-row">
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
                            <AgentManagedTabIndicator
                              detection={tab.agentDetection}
                              id={agentManagedDescriptionId}
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
                      <button
                        className={`tab-pin-button ${tab.pinned ? 'is-state-action' : 'is-reveal-action'}`}
                        type="button"
                        data-tab-action-id={tab.id}
                        draggable={false}
                        aria-describedby={
                          !tab.pinned && tab.groupId !== null ? pinGroupDescriptionId : undefined
                        }
                        aria-label={`Pin ${tab.title}`}
                        aria-pressed={tab.pinned}
                        title={
                          tab.pinned
                            ? 'Unpin tab'
                            : tab.groupId !== null
                              ? 'Pin tab (removes it from its group)'
                              : 'Pin tab'
                        }
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
                      {!suspendUnavailable ? (
                        <button
                          className={`tab-suspended-button ${suspended ? 'is-state-action' : 'is-reveal-action'}`}
                          type="button"
                          data-tab-action-id={tab.id}
                          draggable={false}
                          aria-describedby={suspended ? suspendedDescriptionId : undefined}
                          aria-label={`Suspend ${tab.title}`}
                          aria-pressed={suspended}
                          title={suspended ? 'Unsuspend tab' : 'Suspend tab'}
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
                      ) : (
                        <>
                          <span
                            className="tab-suspended-button is-reveal-action is-unavailable-action"
                            draggable={false}
                            aria-hidden="true"
                            title="Active tabs can't be suspended. Select another tab in this window first."
                          >
                            <Pause
                              className="tab-suspended-icon tab-suspended-icon-pause"
                              aria-hidden="true"
                              size={13}
                            />
                            <span className="tab-suspended-unavailable-slash" aria-hidden="true" />
                          </span>
                          <span id={suspendUnavailableDescriptionId} className="sr-only">
                            Active tabs cannot be suspended. Select another tab in this window
                            first.
                          </span>
                        </>
                      )}
                    </div>
                    <button
                      className="tab-close-button"
                      type="button"
                      draggable={false}
                      aria-label={`Close ${tab.title}, tab ${index + 1} of ${window.tabs.length}`}
                      title="Close tab"
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
                  </div>
                </li>
              </Fragment>
            );
          })}
          {dropTarget?.windowId === window.id && dropTarget.visualIndex === window.tabs.length ? (
            <li className="tab-drop-indicator" aria-hidden="true" />
          ) : null}
        </ul>
      ) : (
        <p className="window-empty">This window has no available tabs.</p>
      )}
    </article>
  );
}
