import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { SortCriterionMenu } from './SortCriterionMenu';
import { type SortCriterion } from './tabSort';

function SortCriterionHarness() {
  const [value, setValue] = useState<SortCriterion>('title');
  return (
    <SortCriterionMenu
      ariaLabel="Sort test window by"
      disabled={false}
      onChange={setValue}
      value={value}
    />
  );
}

describe('SortCriterionMenu', () => {
  it('supports keyboard selection and Escape dismissal from an anchored menu', async () => {
    const user = userEvent.setup();
    render(<SortCriterionHarness />);
    const trigger = screen.getByRole('button', { name: 'Sort test window by: Title' });

    await user.click(trigger);
    expect(screen.getByRole('menu', { name: 'Sort test window by' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Title' })).toHaveFocus();

    await user.keyboard('{ArrowDown}{Enter}');
    const updatedTrigger = screen.getByRole('button', { name: 'Sort test window by: URL' });
    expect(screen.queryByRole('menu', { name: 'Sort test window by' })).not.toBeInTheDocument();
    expect(updatedTrigger).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu', { name: 'Sort test window by' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Sort test window by' })).not.toBeInTheDocument();
    expect(updatedTrigger).toHaveFocus();
  });
});
