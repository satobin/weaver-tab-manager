import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import './anchoredSelectMenu.css';

export interface AnchoredSelectOption<T extends number | string> {
  description?: string | undefined;
  icon?: LucideIcon | undefined;
  label: string;
  secondary?: string | undefined;
  triggerLabel?: string | undefined;
  value: T;
}

interface AnchoredSelectMenuProps<T extends number | string> {
  ariaLabel: string;
  disabled: boolean;
  focusOnMount?: boolean | undefined;
  iconOnly?: boolean | undefined;
  minimumWidth?: number | undefined;
  onChange: (value: T) => void;
  options: readonly AnchoredSelectOption<T>[];
  popoverClassName?: string | undefined;
  showChevron?: boolean | undefined;
  triggerClassName?: string | undefined;
  value: T;
}

const MENU_POPOVER_GAP = 4;
const MENU_GUTTER = 8;
const MENU_MAX_HEIGHT = 240;
const MENU_OPTION_HEIGHT = 32;
const MENU_VERTICAL_PADDING = 8;

interface MenuPosition {
  left: number;
  top: number;
  width: number;
}

function getMenuPosition(
  trigger: HTMLButtonElement,
  minimumWidth: number,
  optionCount: number,
  optionHeight: number,
): MenuPosition {
  const bounds = trigger.getBoundingClientRect();
  const width = Math.max(bounds.width, minimumWidth);
  const height = Math.min(MENU_MAX_HEIGHT, optionCount * optionHeight + MENU_VERTICAL_PADDING);
  const maximumLeft = Math.max(MENU_GUTTER, window.innerWidth - width - MENU_GUTTER);
  const left = Math.min(Math.max(bounds.left, MENU_GUTTER), maximumLeft);
  const below = bounds.bottom + MENU_POPOVER_GAP;
  const top =
    below + height <= window.innerHeight - MENU_GUTTER
      ? below
      : Math.max(MENU_GUTTER, bounds.top - MENU_POPOVER_GAP - height);
  return { left, top, width };
}

function joinClassNames(...classNames: Array<string | undefined>): string {
  return classNames.filter(Boolean).join(' ');
}

export function AnchoredSelectMenu<T extends number | string>({
  ariaLabel,
  disabled,
  focusOnMount = false,
  iconOnly = false,
  minimumWidth = 96,
  onChange,
  options,
  popoverClassName,
  showChevron = true,
  triggerClassName,
  value,
}: AnchoredSelectMenuProps<T>) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedOption = options[selectedIndex];
  const estimatedOptionHeight = options.some((option) => option.description)
    ? 48
    : MENU_OPTION_HEIGHT;

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      setPosition(
        getMenuPosition(triggerRef.current, minimumWidth, options.length, estimatedOptionHeight),
      );
    }
  }, [estimatedOptionHeight, minimumWidth, options.length]);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus());
    }
  }, []);

  const openMenu = () => {
    if (disabled || options.length === 0) {
      return;
    }
    updatePosition();
    setOpen(true);
  };

  useEffect(() => {
    if (focusOnMount) {
      triggerRef.current?.focus();
    }
  }, [focusOnMount]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        closeMenu(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    };
    const handlePositionChange = () => updatePosition();

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handlePositionChange);
    window.addEventListener('scroll', handlePositionChange, true);
    queueMicrotask(() => optionRefs.current[selectedIndex]?.focus());
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handlePositionChange);
      window.removeEventListener('scroll', handlePositionChange, true);
    };
  }, [closeMenu, open, selectedIndex, updatePosition]);

  const focusOption = (index: number) => {
    if (options.length === 0) {
      return;
    }
    const wrappedIndex = (index + options.length) % options.length;
    optionRefs.current[wrappedIndex]?.focus();
  };
  const SelectedIcon = selectedOption?.icon;
  const selectedLabel = selectedOption?.triggerLabel ?? selectedOption?.label ?? '';

  return (
    <>
      <button
        ref={triggerRef}
        className={joinClassNames('anchored-select-trigger', triggerClassName)}
        type="button"
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${ariaLabel}: ${selectedLabel}`}
        title={iconOnly ? `${ariaLabel}: ${selectedLabel}` : undefined}
        disabled={disabled || options.length === 0}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        {SelectedIcon ? (
          <SelectedIcon className="anchored-select-trigger-icon" aria-hidden="true" size={16} />
        ) : null}
        {iconOnly ? null : <span>{selectedLabel}</span>}
        {showChevron ? (
          <ChevronDown className="anchored-select-chevron" aria-hidden="true" size={14} />
        ) : null}
      </button>

      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className={joinClassNames('anchored-select-popover', popoverClassName)}
              role="menu"
              aria-label={ariaLabel}
              style={{ left: position.left, top: position.top, width: position.width }}
            >
              {options.map((option, index) => {
                const OptionIcon = option.icon;
                return (
                  <button
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    className="anchored-select-option"
                    type="button"
                    role="menuitemradio"
                    aria-checked={option.value === value}
                    key={option.value}
                    onClick={(event) => {
                      onChange(option.value);
                      closeMenu(event.detail === 0);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        focusOption(index + 1);
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        focusOption(index - 1);
                      } else if (event.key === 'Home') {
                        event.preventDefault();
                        focusOption(0);
                      } else if (event.key === 'End') {
                        event.preventDefault();
                        focusOption(options.length - 1);
                      } else if (event.key === 'Tab') {
                        setOpen(false);
                      }
                    }}
                  >
                    <span className="anchored-select-check" aria-hidden="true">
                      {option.value === value ? <Check size={14} /> : null}
                    </span>
                    <span className="anchored-select-option-copy">
                      <span className="anchored-select-option-primary">
                        {OptionIcon ? <OptionIcon aria-hidden="true" size={15} /> : null}
                        <span>{option.label}</span>
                        {option.secondary ? <small>{option.secondary}</small> : null}
                      </span>
                      {option.description ? (
                        <small
                          className="anchored-select-option-description"
                          title={option.description}
                        >
                          {option.description}
                        </small>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
