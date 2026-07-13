import { AnchoredSelectMenu, type AnchoredSelectOption } from '../../ui/AnchoredSelectMenu';
import { type SortCriterion } from './tabSort';

interface SortCriterionMenuProps {
  ariaLabel: string;
  disabled: boolean;
  onChange: (criterion: SortCriterion) => void;
  value: SortCriterion;
}

const OPTIONS: readonly AnchoredSelectOption<SortCriterion>[] = [
  { label: 'Title', value: 'title' },
  { label: 'URL', value: 'url' },
];

export function SortCriterionMenu({
  ariaLabel,
  disabled,
  onChange,
  value,
}: SortCriterionMenuProps) {
  return (
    <AnchoredSelectMenu
      ariaLabel={ariaLabel}
      disabled={disabled}
      minimumWidth={96}
      onChange={onChange}
      options={OPTIONS}
      popoverClassName="sort-criterion-popover"
      triggerClassName="sort-criterion-trigger"
      value={value}
    />
  );
}
