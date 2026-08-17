interface SettingSwitchProps {
  checked: boolean;
  disabled?: boolean | undefined;
  label: string;
  mixed?: boolean | undefined;
  onChange: (checked: boolean) => void;
}

export function SettingSwitch({
  checked,
  disabled = false,
  label,
  mixed = false,
  onChange,
}: SettingSwitchProps) {
  const state = mixed ? 'mixed' : checked ? 'on' : 'off';
  return (
    <button
      className="switch"
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={mixed ? `${label}, partially enabled` : label}
      data-state={state}
      disabled={disabled}
      onClick={() => onChange(mixed || !checked)}
    >
      <span />
    </button>
  );
}
