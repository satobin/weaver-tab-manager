interface SettingSwitchProps {
  checked: boolean;
  disabled?: boolean | undefined;
  label: string;
  onChange: (checked: boolean) => void;
}

export function SettingSwitch({ checked, disabled = false, label, onChange }: SettingSwitchProps) {
  return (
    <button
      className="switch"
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
