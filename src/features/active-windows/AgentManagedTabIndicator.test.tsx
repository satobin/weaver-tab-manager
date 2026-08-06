import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentManagedTabIndicator } from './AgentManagedTabIndicator';

describe('AgentManagedTabIndicator', () => {
  it('provides generic duplicate-cleanup context as the parent control description', () => {
    const description = 'Agent-associated tab · kept open during duplicate cleanup';
    const { container } = render(
      <button type="button" aria-label="Focus Agent task" aria-describedby="agent-description">
        <AgentManagedTabIndicator id="agent-description" />
      </button>,
    );

    expect(screen.getByRole('button', { name: 'Focus Agent task' })).toHaveAccessibleDescription(
      description,
    );
    expect(screen.getByText(description)).toHaveClass('sr-only', 'popup-sr-only');
    expect(container.querySelector('.agent-managed-tab-indicator')).toHaveAttribute(
      'data-tooltip',
      description,
    );
    expect(container.querySelector('.agent-managed-tab-indicator')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
