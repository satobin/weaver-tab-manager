import { Info } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDismissOnCommandPaletteOpen } from '../../ui/transientSurface';
import type { BuiltInDedupePreset } from './dedupeRulePresentation';

const TOOLTIP_GAP = 6;
const TOOLTIP_GUTTER = 8;
const TOOLTIP_MAX_WIDTH = 360;

interface TooltipPosition {
  above: boolean;
  left: number;
  maxHeight: number;
  top: number;
  width: number;
}

function getTooltipPosition(trigger: HTMLButtonElement): TooltipPosition {
  const bounds = trigger.getBoundingClientRect();
  const width = Math.min(TOOLTIP_MAX_WIDTH, window.innerWidth - TOOLTIP_GUTTER * 2);
  const left = Math.min(
    Math.max(TOOLTIP_GUTTER, bounds.left),
    Math.max(TOOLTIP_GUTTER, window.innerWidth - width - TOOLTIP_GUTTER),
  );
  const belowSpace = window.innerHeight - bounds.bottom - TOOLTIP_GAP - TOOLTIP_GUTTER;
  const aboveSpace = bounds.top - TOOLTIP_GAP - TOOLTIP_GUTTER;
  const above = belowSpace < 160 && aboveSpace > belowSpace;
  const availableSpace = above ? aboveSpace : belowSpace;

  return {
    above,
    left,
    maxHeight: Math.max(80, availableSpace),
    top: above ? bounds.top - TOOLTIP_GAP : bounds.bottom + TOOLTIP_GAP,
    width,
  };
}

interface DedupePresetFormatsTooltipProps {
  onClose: () => void;
  onOpen: () => void;
  open: boolean;
  preset: BuiltInDedupePreset;
}

function DedupePresetFormatsContent({ preset }: Pick<DedupePresetFormatsTooltipProps, 'preset'>) {
  return (
    <>
      <strong>Supported URL formats</strong>
      <span className="dedupe-preset-formats-list">
        {preset.supportedUrlFormats.map((format) => (
          <span key={format.pattern}>
            {format.label ? <span>{format.label}:</span> : null}
            <code>{format.pattern}</code>
          </span>
        ))}
      </span>
      <small>{preset.supportedUrlFormatNote}</small>
    </>
  );
}

export function DedupePresetFormatsTooltip({
  onClose,
  onOpen,
  open,
  preset,
}: DedupePresetFormatsTooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const presetLabel = preset.id === 'google-workspace' ? 'Google' : 'Notion';
  const visible = open && position !== null;

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      setPosition(getTooltipPosition(triggerRef.current));
    }
  }, []);

  const showTooltip = useCallback(() => {
    updatePosition();
    onOpen();
  }, [onOpen, updatePosition]);

  const hideTooltip = useCallback(() => onClose(), [onClose]);

  useDismissOnCommandPaletteOpen(tooltipRef, hideTooltip, visible);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !triggerRef.current?.contains(target)) {
        hideTooltip();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        hideTooltip();
      }
    };
    const handlePositionChange = () => updatePosition();

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handlePositionChange);
    window.addEventListener('scroll', handlePositionChange, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handlePositionChange);
      window.removeEventListener('scroll', handlePositionChange, true);
    };
  }, [hideTooltip, open, updatePosition]);

  return (
    <span className="dedupe-preset-formats">
      <button
        ref={triggerRef}
        className="dedupe-preset-formats-trigger"
        type="button"
        aria-describedby={tooltipId}
        aria-label={`Show supported ${presetLabel} URL formats`}
        onBlur={hideTooltip}
        onClick={showTooltip}
        onFocus={showTooltip}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
      >
        <Info aria-hidden="true" size={13} />
      </button>

      {!visible ? (
        <span className="sr-only" id={tooltipId}>
          <DedupePresetFormatsContent preset={preset} />
        </span>
      ) : null}

      {visible
        ? createPortal(
            <span
              ref={tooltipRef}
              className={`dedupe-preset-formats-tooltip${position?.above ? ' is-above' : ''}`}
              id={tooltipId}
              role="tooltip"
              style={{
                left: position.left,
                maxHeight: position.maxHeight,
                top: position.top,
                width: position.width,
              }}
            >
              <DedupePresetFormatsContent preset={preset} />
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
