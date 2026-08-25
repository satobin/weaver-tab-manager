import {
  Children,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';

import './tooltip.css';
import { registerCommandPaletteDismissHandler } from './transientSurface';

const TOOLTIP_DELAY_MS = 250;
const TOOLTIP_GAP = 6;
const TOOLTIP_GUTTER = 8;

interface TooltipCoordinatorEntry {
  hideImmediately: () => void;
  isVisible: () => boolean;
}

let activeTooltip: TooltipCoordinatorEntry | null = null;

export type TooltipRelationship = 'description' | 'label' | 'none';

export interface TooltipProps {
  children: ReactElement;
  content: ReactNode;
  disabled?: boolean | undefined;
  onlyWhenLabelHidden?: boolean | undefined;
  relationship?: TooltipRelationship | undefined;
}

interface TooltipPosition {
  left: number;
  top: number;
}

interface TooltipTriggerProps {
  'aria-describedby'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
  onClick?: MouseEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  ref?: Ref<HTMLElement> | undefined;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

function joinIds(existing: string | undefined, tooltipId: string): string {
  return Array.from(new Set(`${existing ?? ''} ${tooltipId}`.trim().split(/\s+/))).join(' ');
}

function getTooltipPosition(trigger: HTMLElement, tooltip: HTMLElement): TooltipPosition {
  const triggerBounds = trigger.getBoundingClientRect();
  const tooltipBounds = tooltip.getBoundingClientRect();
  const maximumLeft = Math.max(
    TOOLTIP_GUTTER,
    window.innerWidth - tooltipBounds.width - TOOLTIP_GUTTER,
  );
  const left = Math.min(
    Math.max(TOOLTIP_GUTTER, triggerBounds.left + (triggerBounds.width - tooltipBounds.width) / 2),
    maximumLeft,
  );
  const above = triggerBounds.top - tooltipBounds.height - TOOLTIP_GAP;
  const below = triggerBounds.bottom + TOOLTIP_GAP;
  const top =
    above >= TOOLTIP_GUTTER || below + tooltipBounds.height > window.innerHeight - TOOLTIP_GUTTER
      ? Math.max(TOOLTIP_GUTTER, above)
      : below;

  return { left, top };
}

function hasVisibleTooltipLabel(trigger: HTMLElement): boolean {
  const label = trigger.querySelector<HTMLElement>('[data-tooltip-label]');
  if (!label || label.getClientRects().length === 0) {
    return false;
  }
  const style = window.getComputedStyle(label);
  return (
    style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse'
  );
}

/**
 * Adds a coordinated, accessible tooltip to one DOM trigger while preserving
 * that trigger's event handlers and ref.
 *
 * Use `relationship="none"` when the tooltip repeats an explicit accessible
 * name such as `aria-label`. Use `description` for supplemental information and
 * `label` only when the tooltip itself supplies the trigger's accessible name.
 * Compactable controls can set `onlyWhenLabelHidden` and mark their responsive
 * text with `data-tooltip-label`; CSS remains the source of truth for whether
 * that text currently occupies a rendered box.
 */
export function Tooltip({
  children,
  content,
  disabled = false,
  onlyWhenLabelHidden = false,
  relationship = 'description',
}: TooltipProps) {
  const child = Children.only(children) as ReactElement<TooltipTriggerProps>;
  const tooltipId = useId();
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const unregisterCommandPaletteDismissRef = useRef<(() => void) | null>(null);
  const triggerHoveredRef = useRef(false);
  const tooltipHoveredRef = useRef(false);
  const triggerFocusedRef = useRef(false);
  const visibleRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const setTriggerRef = useCallback(
    (element: HTMLElement | null) => {
      triggerRef.current = element;
      assignRef(child.props.ref, element);
    },
    [child.props.ref],
  );

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const [coordinatorEntry] = useState<TooltipCoordinatorEntry>(() => {
    const entry: TooltipCoordinatorEntry = {
      hideImmediately: () => {
        clearShowTimer();
        clearHideTimer();
        unregisterCommandPaletteDismissRef.current?.();
        unregisterCommandPaletteDismissRef.current = null;
        visibleRef.current = false;
        setVisible(false);
        setPosition(null);
        if (activeTooltip === entry) {
          activeTooltip = null;
        }
      },
      isVisible: () => visibleRef.current,
    };
    return entry;
  });
  const hideImmediately = coordinatorEntry.hideImmediately;

  const getTrigger = useCallback((): HTMLElement | null => {
    return triggerRef.current;
  }, []);

  const shouldSuppressTooltip = useCallback((): boolean => {
    const trigger = getTrigger();
    return Boolean(onlyWhenLabelHidden && trigger && hasVisibleTooltipLabel(trigger));
  }, [getTrigger, onlyWhenLabelHidden]);

  const showImmediately = useCallback(() => {
    clearShowTimer();
    if (disabled || activeTooltip !== coordinatorEntry || shouldSuppressTooltip()) {
      if (activeTooltip === coordinatorEntry) {
        hideImmediately();
      }
      return;
    }
    visibleRef.current = true;
    setVisible(true);
  }, [clearShowTimer, coordinatorEntry, disabled, hideImmediately, shouldSuppressTooltip]);

  const requestShow = useCallback(() => {
    if (disabled) {
      return;
    }
    if (shouldSuppressTooltip()) {
      hideImmediately();
      return;
    }
    clearHideTimer();
    if (visibleRef.current || showTimerRef.current !== null) {
      return;
    }

    const previousTooltip = activeTooltip;
    const switchImmediately =
      previousTooltip !== null &&
      previousTooltip !== coordinatorEntry &&
      previousTooltip.isVisible();
    if (previousTooltip && previousTooltip !== coordinatorEntry) {
      previousTooltip.hideImmediately();
    }
    activeTooltip = coordinatorEntry;
    unregisterCommandPaletteDismissRef.current ??=
      registerCommandPaletteDismissHandler(hideImmediately);

    if (switchImmediately) {
      showImmediately();
      return;
    }
    showTimerRef.current = window.setTimeout(showImmediately, TOOLTIP_DELAY_MS);
  }, [
    clearHideTimer,
    coordinatorEntry,
    disabled,
    hideImmediately,
    showImmediately,
    shouldSuppressTooltip,
  ]);

  const scheduleHide = useCallback(() => {
    if (triggerHoveredRef.current || tooltipHoveredRef.current || triggerFocusedRef.current) {
      return;
    }
    clearShowTimer();
    if (!visibleRef.current) {
      hideImmediately();
      return;
    }
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(hideImmediately, TOOLTIP_DELAY_MS);
  }, [clearHideTimer, clearShowTimer, hideImmediately]);

  const updatePosition = useCallback(() => {
    const trigger = getTrigger();
    if (trigger && tooltipRef.current) {
      setPosition(getTooltipPosition(trigger, tooltipRef.current));
    }
  }, [getTrigger]);

  useLayoutEffect(() => {
    if (visible) {
      updatePosition();
    }
  }, [updatePosition, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hideImmediately();
      }
    };
    const handlePositionChange = () => {
      if (shouldSuppressTooltip()) {
        hideImmediately();
        return;
      }
      updatePosition();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handlePositionChange);
    window.addEventListener('scroll', handlePositionChange, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handlePositionChange);
      window.removeEventListener('scroll', handlePositionChange, true);
    };
  }, [hideImmediately, shouldSuppressTooltip, updatePosition, visible]);

  useEffect(() => {
    if (!disabled) {
      return;
    }
    const timer = window.setTimeout(hideImmediately, 0);
    return () => window.clearTimeout(timer);
  }, [disabled, hideImmediately]);

  useEffect(
    () => () => {
      clearShowTimer();
      clearHideTimer();
      unregisterCommandPaletteDismissRef.current?.();
      unregisterCommandPaletteDismissRef.current = null;
      if (activeTooltip === coordinatorEntry) {
        activeTooltip = null;
      }
    },
    [clearHideTimer, clearShowTimer, coordinatorEntry],
  );

  const ariaProps: Pick<TooltipTriggerProps, 'aria-describedby' | 'aria-labelledby'> = {};
  if (!disabled && relationship === 'description') {
    ariaProps['aria-describedby'] = joinIds(child.props['aria-describedby'], tooltipId);
  } else if (!disabled && relationship === 'label') {
    ariaProps['aria-labelledby'] = joinIds(child.props['aria-labelledby'], tooltipId);
  }
  // cloneElement attaches this callback ref during commit; it does not read ref state during render.
  // eslint-disable-next-line react-hooks/refs
  const trigger = cloneElement(child, {
    ...ariaProps,
    ref: setTriggerRef,
    onBlur: (event) => {
      child.props.onBlur?.(event);
      if (event.currentTarget.contains(event.relatedTarget)) {
        return;
      }
      triggerFocusedRef.current = false;
      if (!triggerHoveredRef.current && !tooltipHoveredRef.current) {
        hideImmediately();
      }
    },
    onClick: (event) => {
      child.props.onClick?.(event);
      hideImmediately();
    },
    onFocus: (event) => {
      child.props.onFocus?.(event);
      triggerFocusedRef.current = true;
      requestShow();
    },
    onPointerEnter: (event) => {
      child.props.onPointerEnter?.(event);
      triggerHoveredRef.current = true;
      requestShow();
    },
    onPointerLeave: (event) => {
      child.props.onPointerLeave?.(event);
      triggerHoveredRef.current = false;
      scheduleHide();
    },
  });

  const relationshipContent = !disabled && relationship !== 'none';
  const tooltipStyle: CSSProperties = {
    left: position?.left ?? 0,
    top: position?.top ?? 0,
    visibility: position ? 'visible' : 'hidden',
  };

  return (
    <>
      {trigger}
      {!visible && relationshipContent ? (
        <span className="manager-tooltip-sr-only" id={tooltipId}>
          {content}
        </span>
      ) : null}
      {visible
        ? createPortal(
            <span
              ref={tooltipRef}
              className="manager-tooltip"
              id={tooltipId}
              role="tooltip"
              style={tooltipStyle}
              onPointerEnter={() => {
                tooltipHoveredRef.current = true;
                clearHideTimer();
              }}
              onPointerLeave={() => {
                tooltipHoveredRef.current = false;
                scheduleHide();
              }}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
