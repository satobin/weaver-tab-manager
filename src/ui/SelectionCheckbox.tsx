import { useEffect, useRef } from 'react';

interface SelectionCheckboxProps {
  ariaLabel: string;
  checked: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean, extendRange: boolean) => void;
}

export function SelectionCheckbox({
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
      onChange={(event) =>
        onChange(event.target.checked, Boolean((event.nativeEvent as MouseEvent).shiftKey))
      }
    />
  );
}
