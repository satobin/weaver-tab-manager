import { Monitor, Moon, Sun } from 'lucide-react';

import { AnchoredSelectMenu, type AnchoredSelectOption } from '../../ui/AnchoredSelectMenu';
import { type ColorMode } from './settingsService';

const APPEARANCE_OPTIONS: readonly AnchoredSelectOption<ColorMode>[] = [
  { icon: Monitor, label: 'System default', value: 'system' },
  { icon: Sun, label: 'Light', value: 'light' },
  { icon: Moon, label: 'Dark', value: 'dark' },
];

interface AppearanceControlProps {
  disabled: boolean;
  onChange: (value: ColorMode) => void;
  presentation?: 'icon-menu' | 'segmented';
  value: ColorMode;
}

export function AppearanceControl({
  disabled,
  onChange,
  presentation = 'icon-menu',
  value,
}: AppearanceControlProps) {
  const changeValue = (nextValue: ColorMode) => {
    if (nextValue !== value) {
      onChange(nextValue);
    }
  };

  if (presentation === 'segmented') {
    return (
      <div
        className="appearance-control appearance-control-segmented"
        role="radiogroup"
        aria-label="Color scheme"
      >
        {APPEARANCE_OPTIONS.map(({ icon: Icon, label, value: optionValue }) => (
          <button
            key={optionValue}
            type="button"
            role="radio"
            aria-checked={value === optionValue}
            disabled={disabled}
            onClick={() => changeValue(optionValue)}
          >
            {Icon ? <Icon aria-hidden="true" size={15} /> : null}
            <span>{optionValue === 'system' ? 'System' : label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="appearance-control appearance-control-icon-menu">
      <AnchoredSelectMenu
        ariaLabel="Color scheme"
        disabled={disabled}
        iconOnly
        minimumWidth={168}
        onChange={changeValue}
        options={APPEARANCE_OPTIONS}
        popoverClassName="appearance-popover"
        showChevron={false}
        triggerClassName="appearance-trigger"
        value={value}
      />
    </div>
  );
}
