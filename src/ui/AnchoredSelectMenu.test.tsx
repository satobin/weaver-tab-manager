import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnchoredSelectMenu, type AnchoredSelectOption } from './AnchoredSelectMenu';

const OPTIONS: readonly AnchoredSelectOption<'title' | 'url'>[] = [
  { label: 'Title', value: 'title' },
  { label: 'URL', value: 'url' },
];

function advanceTooltipDelay(): void {
  void act(() => vi.advanceTimersByTime(250));
}

describe('AnchoredSelectMenu tooltips', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('replaces a visible trigger native title with a supplemental custom tooltip', () => {
    render(
      <AnchoredSelectMenu
        ariaLabel="Sort field"
        disabled={false}
        onChange={vi.fn()}
        options={OPTIONS}
        triggerTitle="Choose sort field: Title or URL"
        value="title"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Sort field: Title' });
    expect(trigger).not.toHaveAttribute('title');
    expect(trigger).not.toHaveAttribute('aria-describedby');

    fireEvent.pointerEnter(trigger);
    advanceTooltipDelay();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Choose sort field: Title or URL');
  });

  it('derives an always-available tooltip for an icon-only trigger', () => {
    render(
      <AnchoredSelectMenu
        ariaLabel="Color scheme"
        disabled={false}
        iconOnly
        onChange={vi.fn()}
        options={[{ label: 'System default', value: 'system' }]}
        showChevron={false}
        value="system"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Color scheme: System default' });
    expect(trigger).not.toHaveAttribute('title');
    expect(trigger).not.toHaveAttribute('aria-describedby');

    fireEvent.pointerEnter(trigger);
    advanceTooltipDelay();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Color scheme: System default');
  });
});
