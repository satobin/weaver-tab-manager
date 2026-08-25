import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dismissTransientSurfacesForCommandPalette } from './transientSurface';
import { Tooltip } from './Tooltip';

function advance(milliseconds: number): void {
  void act(() => vi.advanceTimersByTime(milliseconds));
}

describe('Tooltip', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('waits 250ms for the first tooltip and renders it in a body portal', () => {
    render(
      <Tooltip content="Search Weaver">
        <button type="button">Search</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Search' });
    expect(trigger).toHaveAttribute('aria-describedby');
    fireEvent.pointerEnter(trigger);
    advance(249);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    advance(1);
    const tooltip = screen.getByRole('tooltip', { name: 'Search Weaver' });
    expect(tooltip.parentElement).toBe(document.body);
  });

  it('leaves the trigger as a direct DOM child of its parent', () => {
    render(
      <div data-testid="toolbar">
        <Tooltip content="Search Weaver" relationship="none">
          <button type="button">Search</button>
        </Tooltip>
      </div>,
    );

    const toolbar = screen.getByTestId('toolbar');
    const trigger = screen.getByRole('button', { name: 'Search' });
    expect(trigger.parentElement).toBe(toolbar);
    expect(toolbar.firstElementChild).toBe(trigger);
  });

  it('keeps the tooltip open through the pointer-leave grace and over its content', () => {
    render(
      <Tooltip content="Close selected tabs">
        <button type="button">Close</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Close' });
    fireEvent.pointerEnter(trigger);
    advance(250);
    const tooltip = screen.getByRole('tooltip');

    fireEvent.pointerLeave(trigger);
    advance(249);
    expect(tooltip).toBeInTheDocument();
    fireEvent.pointerEnter(tooltip);
    advance(1);
    expect(tooltip).toBeInTheDocument();

    fireEvent.pointerLeave(tooltip);
    advance(250);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('switches immediately between sibling tooltips after one is visible', () => {
    render(
      <>
        <Tooltip content="First action">
          <button type="button">First</button>
        </Tooltip>
        <Tooltip content="Second action">
          <button type="button">Second</button>
        </Tooltip>
      </>,
    );

    const first = screen.getByRole('button', { name: 'First' });
    const second = screen.getByRole('button', { name: 'Second' });
    fireEvent.pointerEnter(first);
    advance(250);
    expect(screen.getByRole('tooltip')).toHaveTextContent('First action');

    fireEvent.pointerLeave(first);
    fireEvent.pointerEnter(second);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Second action');
  });

  it('supports keyboard focus and closes on blur, Escape, or trigger activation', () => {
    render(
      <Tooltip content="Open selected tabs">
        <button type="button">Open</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Open' });
    fireEvent.focus(trigger);
    advance(250);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.focus(trigger);
    advance(250);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.blur(trigger);
    fireEvent.focus(trigger);
    advance(250);
    fireEvent.click(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    advance(250);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('consumes the first Escape before a parent transient surface can handle it', () => {
    const onParentEscape = vi.fn();
    render(
      <div data-testid="parent-surface">
        <Tooltip content="Nested action">
          <button type="button">Action</button>
        </Tooltip>
      </div>,
    );

    screen.getByTestId('parent-surface').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        onParentEscape();
      }
    });
    const trigger = screen.getByRole('button', { name: 'Action' });
    fireEvent.focus(trigger);
    advance(250);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(onParentEscape).not.toHaveBeenCalled();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(onParentEscape).toHaveBeenCalledOnce();
  });

  it('dismisses before the command palette opens', () => {
    render(
      <Tooltip content="Nested action">
        <button type="button">Action</button>
      </Tooltip>,
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Action' }));
    advance(250);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    act(() => expect(dismissTransientSurfacesForCommandPalette()).toBe(true));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('cancels a pending tooltip before the command palette opens', () => {
    render(
      <Tooltip content="Nested action">
        <button type="button">Action</button>
      </Tooltip>,
    );

    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Action' }));
    advance(249);
    act(() => expect(dismissTransientSurfacesForCommandPalette()).toBe(true));
    advance(250);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('preserves child handlers, refs, and existing descriptions', () => {
    const onClick = vi.fn();
    const onFocus = vi.fn();
    const triggerRef = createRef<HTMLButtonElement>();
    render(
      <Tooltip content="Supplemental details">
        <button
          ref={triggerRef}
          type="button"
          aria-describedby="existing-description"
          onClick={onClick}
          onFocus={onFocus}
        >
          Details
        </button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Details' });
    expect(triggerRef.current).toBe(trigger);
    expect(trigger.getAttribute('aria-describedby')?.split(' ')).toContain('existing-description');
    expect(trigger.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);

    fireEvent.focus(trigger);
    fireEvent.click(trigger);
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('can omit an ARIA relationship when content repeats an explicit accessible name', () => {
    render(
      <Tooltip content="Close selected tabs" relationship="none">
        <button type="button" aria-label="Close selected tabs">
          ×
        </button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Close selected tabs' });
    expect(trigger).not.toHaveAttribute('aria-describedby');
    expect(trigger).not.toHaveAttribute('aria-labelledby');
    fireEvent.pointerEnter(trigger);
    advance(250);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Close selected tabs');
  });

  it('can supply a label while preserving an existing labelled-by relationship', () => {
    render(
      <Tooltip content="More information" relationship="label">
        <button type="button" aria-labelledby="context-label">
          i
        </button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'More information' });
    expect(trigger.getAttribute('aria-labelledby')?.split(' ')).toContain('context-label');
    expect(trigger.getAttribute('aria-labelledby')?.split(' ')).toHaveLength(2);
  });

  it('shows a compact-only tooltip only when its marked label has no rendered box', () => {
    render(
      <Tooltip content="Select filtered tabs" onlyWhenLabelHidden relationship="none">
        <button type="button" aria-label="Select filtered tabs">
          <span data-tooltip-label>Select filtered</span>
        </button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Select filtered tabs' });
    const label = screen.getByText('Select filtered');
    const getClientRects = vi.spyOn(label, 'getClientRects');
    getClientRects.mockReturnValue([{} as DOMRect] as unknown as DOMRectList);

    fireEvent.pointerEnter(trigger);
    advance(500);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    getClientRects.mockReturnValue([] as unknown as DOMRectList);
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerEnter(trigger);
    advance(250);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Select filtered tabs');

    getClientRects.mockReturnValue([{} as DOMRect] as unknown as DOMRectList);
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('rechecks compact label visibility before a delayed tooltip opens', () => {
    render(
      <Tooltip content="Close selected tabs" onlyWhenLabelHidden relationship="none">
        <button type="button" aria-label="Close selected tabs">
          <span data-tooltip-label>Close</span>
        </button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Close selected tabs' });
    const label = screen.getByText('Close');
    const getClientRects = vi.spyOn(label, 'getClientRects');
    getClientRects.mockReturnValue([] as unknown as DOMRectList);

    fireEvent.pointerEnter(trigger);
    advance(249);
    getClientRects.mockReturnValue([{} as DOMRect] as unknown as DOMRectList);
    advance(1);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not attach or display a disabled tooltip', () => {
    render(
      <Tooltip content="Hidden tooltip" disabled>
        <button type="button">Labeled action</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Labeled action' });
    expect(trigger).not.toHaveAttribute('aria-describedby');
    fireEvent.pointerEnter(trigger);
    fireEvent.focus(trigger);
    advance(500);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
