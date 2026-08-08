import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentAssociatedTabIndicator } from './AgentAssociatedTabIndicator';

describe('AgentAssociatedTabIndicator', () => {
  it.each([
    [
      true,
      'Agent-associated tab · activity appears ongoing or is unclear, so it stays open during duplicate cleanup; Weaver keeps any containing group together during sorting and moving.',
      'Agent may still be using this tab — Weaver keeps it open during duplicate cleanup',
    ],
    [
      false,
      'Agent-associated tab · no longer appears in active agent use, so its agent status does not protect it from duplicate cleanup; Weaver keeps any containing group together during sorting and moving.',
      'Agent appears finished — Weaver may close it if it’s a duplicate',
    ],
  ] as const)(
    'describes duplicate-cleanup protection %s through the parent control',
    (dedupeProtected, description, tooltip) => {
      const { container } = render(
        <button type="button" aria-label="Focus Agent task" aria-describedby="agent-description">
          <AgentAssociatedTabIndicator dedupeProtected={dedupeProtected} id="agent-description" />
        </button>,
      );

      expect(screen.getByRole('button', { name: 'Focus Agent task' })).toHaveAccessibleDescription(
        description,
      );
      expect(screen.getByText(description)).toHaveClass('sr-only', 'popup-sr-only');
      expect(container.querySelector('.agent-associated-tab-indicator')).toHaveAttribute(
        'data-tooltip',
        tooltip,
      );
      expect(container.querySelector('.agent-associated-tab-indicator')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
    },
  );
});
