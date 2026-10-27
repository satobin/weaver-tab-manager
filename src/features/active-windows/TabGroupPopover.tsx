import { ArrowRight, Check, ChevronDown, ListMinus, Plus, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { useDismissOnCommandPaletteOpen } from '../../ui/transientSurface';
import { hasClaudeAgentGroupSignal } from './agentTabAssociation';
import { type ManagedTabGroup, type ManagedWindow, type TabGroupColor } from './model';
import { TAB_GROUP_COLORS, type GroupDetails, type GroupSelectionTab } from './tabGroupManagement';

import './tabGroupManagement.css';

export type GroupPopoverSession =
  | { kind: 'selection'; tabs: readonly GroupSelectionTab[]; windowId: number }
  | { kind: 'edit'; group: ManagedTabGroup; windowId: number };

export type GroupPopoverAction =
  | { kind: 'create'; details: GroupDetails; windowId: number }
  | { kind: 'add'; group: ManagedTabGroup }
  | { kind: 'remove'; groupId?: number }
  | { kind: 'edit'; details: GroupDetails };

interface TabGroupPopoverProps {
  anchor: HTMLButtonElement;
  busy: boolean;
  error: string | null;
  onClose: (restoreFocus?: boolean) => void;
  onSubmit: (action: GroupPopoverAction) => void;
  session: GroupPopoverSession;
  stale: boolean;
  window: ManagedWindow | undefined;
  destinationWindows: readonly ManagedWindow[];
}

export function TabGroupPopover({
  anchor,
  busy,
  error,
  onClose,
  onSubmit,
  session,
  stale,
  window: sourceWindow,
  destinationWindows,
}: TabGroupPopoverProps) {
  const id = useId();
  const panelRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const pendingRemovalFocus = useRef<{ groupId: number; index: number } | null>(null);
  const [title, setTitle] = useState(session.kind === 'edit' ? session.group.title : '');
  const [color, setColor] = useState<TabGroupColor>(
    session.kind === 'edit' ? session.group.color : 'blue',
  );
  const hasGroups = destinationWindows.some((window) => window.groups.length > 0);
  const [creating, setCreating] = useState(!hasGroups);
  const editing = session.kind === 'edit';
  const showForm = editing || creating || !hasGroups;
  const label = editing ? 'Edit group' : 'Group selected tabs';
  const tabs = session.kind === 'selection' ? session.tabs : [];
  const sourceWindowCount = new Set(tabs.map((tab) => tab.windowId)).size;
  const multipleSourceWindows = sourceWindowCount > 1;
  const [currentWindowId] = useState(
    () => destinationWindows.find((window) => window.isCurrent)?.id,
  );
  const creationWindowId = multipleSourceWindows ? currentWindowId : session.windowId;
  const creationWindow = destinationWindows.find(
    (window) => window.id === creationWindowId && (!multipleSourceWindows || window.isCurrent),
  );
  const pinnedCount = tabs.filter((tab) => tab.pinned).length;
  const groupedCount = tabs.filter((tab) => tab.groupId !== null).length;
  const groups = destinationWindows.flatMap((window) =>
    window.groups.map((group) => ({
      group,
      windowLabel: window.label,
      memberCount: window.tabs.filter((tab) => tab.groupId === group.id).length,
      moveCount: tabs.filter((tab) => tab.groupId !== group.id).length,
      removeCount: tabs.filter((tab) => tab.groupId === group.id).length,
    })),
  );
  const destinations = groups.filter(({ moveCount }) => moveCount > 0);
  const removals = groups.filter(({ removeCount }) => removeCount > 0);
  const hasMembershipActions = !editing && (destinations.length > 0 || groupedCount > 0);
  const memberCount = editing
    ? (sourceWindow?.tabs.filter((tab) => tab.groupId === session.group.id).length ?? 0)
    : tabs.length;
  const unavailable = busy || stale;
  const groupingUnavailable = unavailable || pinnedCount > 0 || (!editing && tabs.length === 0);
  const creationUnavailable = groupingUnavailable || (!editing && !creationWindow);
  const unchanged =
    editing && title.trim() === session.group.title && color === session.group.color;
  const wasAgentGroup = editing && hasClaudeAgentGroupSignal(session.group);
  const willBeAgentGroup = hasClaudeAgentGroupSignal({ title: title.trim(), color });
  const agentNotice =
    wasAgentGroup && !willBeAgentGroup
      ? 'This change may remove the group’s agent badges and automatic duplicate protection.'
      : !wasAgentGroup && willBeAgentGroup
        ? 'This name and color will identify the group as agent-associated in Weaver.'
        : null;

  useDismissOnCommandPaletteOpen(panelRef, () => onClose(false), !busy);

  useLayoutEffect(() => {
    const positionPanel = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const bounds = anchor.getBoundingClientRect();
      const { width, height } = panel.getBoundingClientRect();
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8));
      const below = bounds.bottom + 6;
      const preferredTop =
        below + height <= window.innerHeight - 8 ? below : bounds.top - height - 6;
      const top = Math.max(8, Math.min(preferredTop, window.innerHeight - height - 8));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.visibility = 'visible';
    };
    positionPanel();
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(positionPanel);
    if (panelRef.current) observer?.observe(panelRef.current);
    return () => {
      window.removeEventListener('resize', positionPanel);
      window.removeEventListener('scroll', positionPanel, true);
      observer?.disconnect();
    };
  }, [anchor, error, stale, agentNotice, showForm]);

  useEffect(() => {
    if (!showForm) return;
    const target = nameRef.current?.disabled
      ? panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      : nameRef.current;
    target?.focus();
  }, [showForm]);

  useEffect(() => {
    const firstAction = panelRef.current?.querySelector<HTMLButtonElement>(
      '[data-group-action]:not(:disabled)',
    );
    const nameInput = nameRef.current;
    if (firstAction) {
      firstAction.focus();
    } else if (nameInput && !nameInput.disabled) {
      nameInput.focus();
    } else {
      panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
  }, []);

  useEffect(() => {
    const pending = pendingRemovalFocus.current;
    if (busy || !pending) return;
    pendingRemovalFocus.current = null;
    const panel = panelRef.current;
    const remaining = panel?.querySelectorAll<HTMLButtonElement>(
      '[data-remove-group]:not(:disabled)',
    );
    const target =
      panel?.querySelector<HTMLButtonElement>(
        `[data-remove-group="${pending.groupId}"]:not(:disabled)`,
      ) ??
      remaining?.[Math.min(pending.index, remaining.length - 1)] ??
      panel?.querySelector<HTMLButtonElement>('[data-group-action]:not(:disabled)') ??
      (nameRef.current && !nameRef.current.disabled ? nameRef.current : null) ??
      panel?.querySelector<HTMLButtonElement>('.tab-group-popover-close');
    target?.focus({ preventScroll: true });
  }, [busy, session, error, stale]);

  useEffect(() => {
    const pointerDown = (event: PointerEvent) => {
      if (
        !busy &&
        event.target instanceof Node &&
        !panelRef.current?.contains(event.target) &&
        !anchor.contains(event.target)
      ) {
        onClose(false);
      }
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!busy) onClose();
      }
    };
    document.addEventListener('pointerdown', pointerDown);
    document.addEventListener('keydown', keyDown, true);
    return () => {
      document.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('keydown', keyDown, true);
    };
  }, [anchor, busy, onClose]);

  return createPortal(
    <section
      ref={panelRef}
      className="tab-group-popover"
      role="dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-summary`}
      aria-busy={busy}
      onBlur={(event) => {
        if (
          !busy &&
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget) &&
          event.relatedTarget !== anchor
        ) {
          onClose(false);
        }
      }}
    >
      <header>
        <div>
          <h3 id={`${id}-title`}>{label}</h3>
          <p id={`${id}-summary`}>
            {memberCount} {editing ? '' : 'selected '}
            {memberCount === 1 ? 'tab' : 'tabs'} ·{' '}
            {multipleSourceWindows
              ? `${sourceWindowCount} windows`
              : (sourceWindow?.label ?? 'Window unavailable')}
          </p>
        </div>
        <button
          className="icon-button tab-group-popover-close"
          type="button"
          aria-label="Close group panel"
          disabled={busy}
          onClick={() => onClose()}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {stale ? (
        <p className="dialog-error" role="alert">
          The tabs or group changed. Close this panel and reopen it to continue.
        </p>
      ) : null}
      {error ? (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      ) : null}
      {!editing && tabs.length === 0 ? (
        <p className="tab-group-help" role="status">
          No selected tabs remaining.
        </p>
      ) : null}
      {pinnedCount > 0 ? (
        <p className="tab-group-help">
          Unpin{' '}
          {pinnedCount === 1
            ? 'the selected pinned tab'
            : `the ${pinnedCount} selected pinned tabs`}{' '}
          before creating or moving to a group.
        </p>
      ) : null}

      {hasMembershipActions ? (
        <div className="tab-group-choices">
          {destinations.length > 0 ? (
            <div className="tab-group-existing">
              {destinations.map(({ group, moveCount, memberCount: count, windowLabel }) => {
                const actionLabel = `Move ${moveCount} ${moveCount === 1 ? 'tab' : 'tabs'} to ${group.title || 'Tab group'}, ${windowLabel}`;
                return (
                  <button
                    key={group.id}
                    className="tab-group-move"
                    type="button"
                    data-group-action
                    title={actionLabel}
                    aria-label={`${actionLabel}, ${count} ${count === 1 ? 'tab' : 'tabs'} in group`}
                    disabled={groupingUnavailable}
                    onClick={() => onSubmit({ kind: 'add', group })}
                  >
                    <ArrowRight className="tab-group-action-icon" size={16} aria-hidden="true" />
                    <span className="tab-group-choice-name">
                      <strong>
                        Move {moveCount} {moveCount === 1 ? 'tab' : 'tabs'}
                      </strong>
                      {' to '}
                      <span
                        className="tab-group-choice-dot"
                        style={{ background: `var(--group-${group.color})` }}
                        aria-hidden="true"
                      />
                      <span className="tab-group-destination-name">
                        {group.title || 'Tab group'}
                      </span>
                    </span>{' '}
                    <small className="tab-group-destination-window">{windowLabel}</small>
                  </button>
                );
              })}
            </div>
          ) : null}
          {removals.length > 0 ? (
            <div className="tab-group-removals">
              {removals.length > 1 ? (
                <button
                  className="tab-group-remove tab-group-remove-all"
                  type="button"
                  data-group-action
                  title={`Remove all ${groupedCount} grouped tabs. Keep tabs open.`}
                  aria-label={`Remove all ${groupedCount} grouped tabs Keep tabs open`}
                  disabled={unavailable}
                  onClick={() => onSubmit({ kind: 'remove' })}
                >
                  <ListMinus className="tab-group-action-icon" size={16} aria-hidden="true" />
                  <span className="tab-group-remove-label">
                    <strong>Remove all {groupedCount} grouped tabs</strong>
                  </span>{' '}
                  <small>Keep tabs open</small>
                </button>
              ) : null}
              {removals.map(({ group, removeCount, windowLabel }, index) => {
                const actionLabel = `Remove ${removeCount} ${removeCount === 1 ? 'tab' : 'tabs'} from ${group.title || 'Tab group'}, ${windowLabel}`;
                return (
                  <button
                    key={group.id}
                    className="tab-group-remove"
                    type="button"
                    data-group-action
                    data-remove-group={group.id}
                    title={`${actionLabel}. Keep tabs open.`}
                    aria-label={actionLabel}
                    disabled={unavailable}
                    onClick={() => {
                      pendingRemovalFocus.current = { groupId: group.id, index };
                      onSubmit({ kind: 'remove', groupId: group.id });
                    }}
                  >
                    <ListMinus className="tab-group-action-icon" size={16} aria-hidden="true" />
                    <span className="tab-group-choice-name">
                      <strong>
                        Remove {removeCount} {removeCount === 1 ? 'tab' : 'tabs'}
                      </strong>
                      {' from '}
                      <span
                        className="tab-group-choice-dot"
                        style={{ background: `var(--group-${group.color})` }}
                        aria-hidden="true"
                      />
                      <span className="tab-group-destination-name">
                        {group.title || 'Tab group'}
                      </span>
                    </span>{' '}
                    <small className="tab-group-destination-window">{windowLabel}</small>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {!editing && hasGroups ? (
        <button
          className="tab-group-create-toggle"
          id={`${id}-create`}
          type="button"
          data-group-action
          aria-expanded={showForm}
          aria-controls={`${id}-form`}
          disabled={groupingUnavailable}
          onClick={() => setCreating(!creating)}
        >
          <Plus className="tab-group-action-icon" size={16} aria-hidden="true" />
          <strong>Create new group</strong>
          <ChevronDown className="tab-group-create-chevron" size={16} aria-hidden="true" />
        </button>
      ) : null}

      <form
        id={`${id}-form`}
        hidden={!showForm}
        aria-labelledby={editing ? undefined : `${id}-create`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!creationUnavailable && !unchanged) {
            const details = { title: title.trim(), color };
            if (editing) onSubmit({ kind: 'edit', details });
            else if (creationWindow)
              onSubmit({ kind: 'create', details, windowId: creationWindow.id });
          }
        }}
      >
        {!editing && !hasGroups ? (
          <h4 className="tab-group-create-heading" id={`${id}-create`}>
            Create new group
          </h4>
        ) : null}
        {multipleSourceWindows ? (
          <p className="tab-group-help">
            {creationWindow
              ? `Creates in ${creationWindow.label} (current window).`
              : 'Current window unavailable. Close this panel and reopen it to create a group.'}
          </p>
        ) : null}
        <label className="tab-group-name">
          <span>Group name</span>
          <input
            ref={nameRef}
            value={title}
            maxLength={120}
            placeholder="Optional name"
            autoComplete="off"
            disabled={creationUnavailable}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <fieldset className="tab-group-colors" disabled={creationUnavailable}>
          <legend>Color</legend>
          {TAB_GROUP_COLORS.map((option) => (
            <label
              key={option}
              style={{ '--swatch-color': `var(--group-${option})` } as CSSProperties}
            >
              <input
                type="radio"
                name={`${id}-color`}
                value={option}
                checked={color === option}
                aria-label={option === 'grey' ? 'Gray' : option[0]!.toUpperCase() + option.slice(1)}
                onChange={() => setColor(option)}
              />
              <span aria-hidden="true">{color === option ? <Check size={14} /> : null}</span>
            </label>
          ))}
        </fieldset>
        {agentNotice ? (
          <p className="tab-group-help" role="status">
            {agentNotice}
          </p>
        ) : null}
        <footer>
          <button
            className="toolbar-button"
            type="button"
            disabled={busy}
            onClick={() => onClose()}
          >
            Cancel
          </button>
          <button
            className="toolbar-button primary-button"
            type="submit"
            disabled={creationUnavailable || unchanged}
          >
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create group'}
          </button>
        </footer>
      </form>
    </section>,
    document.body,
  );
}
