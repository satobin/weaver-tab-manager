import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentManagedTabIndicator } from './AgentManagedTabIndicator';
import type { AgentActivity, AgentTabDetection } from './agentManagedTabs';

function createCodexDetection(activity: AgentActivity): AgentTabDetection {
  return {
    activity,
    evidence: 'codex-favicon',
    providerHint: 'codex',
  };
}

describe('AgentManagedTabIndicator', () => {
  it.each([
    ['working', 'working'],
    ['output-ready', 'output ready'],
    ['waiting-to-continue', 'waiting to continue'],
  ] as const)('describes a Codex %s state', (activity, activityLabel) => {
    const description = `Agent-associated tab detected locally · likely Codex/ChatGPT · ${activityLabel}`;

    render(<AgentManagedTabIndicator detection={createCodexDetection(activity)} />);

    const indicator = screen.getByRole('img', { name: description });
    expect(indicator).toHaveAttribute('data-tooltip', description);
    expect(indicator).toHaveAttribute('title', '');
  });

  it('does not claim an activity when the Codex marker state is unfamiliar', () => {
    const description = 'Agent-associated tab detected locally · likely Codex/ChatGPT';

    render(<AgentManagedTabIndicator detection={createCodexDetection('unknown')} />);

    expect(screen.getByRole('img', { name: description })).toHaveAttribute(
      'data-tooltip',
      description,
    );
  });
});
