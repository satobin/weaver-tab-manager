import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentAssociatedTabIndicator } from './AgentAssociatedTabIndicator';

describe('AgentAssociatedTabIndicator', () => {
  it('provides generic duplicate-cleanup context as the parent control description', () => {
    const description =
      'Agent-associated tab · kept open during duplicate cleanup; Weaver keeps any containing group together during sorting and moving.';
    const { container } = render(
      <button type="button" aria-label="Focus Agent task" aria-describedby="agent-description">
        <AgentAssociatedTabIndicator id="agent-description" />
      </button>,
    );

    expect(screen.getByRole('button', { name: 'Focus Agent task' })).toHaveAccessibleDescription(
      description,
    );
    expect(screen.getByText(description)).toHaveClass('sr-only', 'popup-sr-only');
    expect(container.querySelector('.agent-associated-tab-indicator')).toHaveAttribute(
      'data-tooltip',
      description,
    );
    expect(container.querySelector('.agent-associated-tab-indicator')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
