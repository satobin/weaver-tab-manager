import { Bot } from 'lucide-react';

import type { AgentActivity, AgentTabDetection } from './agentManagedTabs';

interface AgentManagedTabIndicatorProps {
  detection?: AgentTabDetection | null;
  id?: string;
}

const ACTIVITY_LABELS: Readonly<Record<AgentActivity, string | null>> = {
  'awaiting-permission': 'awaiting permission',
  idle: 'idle or completed',
  'output-ready': 'output ready',
  unknown: null,
  'waiting-to-continue': 'waiting to continue',
  working: 'working',
};

function describeAgentDetection(detection: AgentTabDetection | null | undefined): string {
  const details = ['Agent-associated tab detected locally'];
  if (detection?.providerHint === 'claude') {
    details.push('likely Claude');
  } else if (detection?.providerHint === 'codex') {
    details.push('likely Codex/ChatGPT');
  } else if (detection?.providerHint === 'unknown') {
    details.push('provider uncertain');
  }

  const activityLabel = detection ? ACTIVITY_LABELS[detection.activity] : null;
  if (activityLabel) {
    details.push(activityLabel);
  }

  return details.join(' · ');
}

export function AgentManagedTabIndicator({ detection, id }: AgentManagedTabIndicatorProps) {
  const description = describeAgentDetection(detection);
  return (
    <span
      id={id}
      className="agent-managed-tab-indicator"
      role="img"
      aria-label={description}
      data-tooltip={description}
      title=""
    >
      <Bot aria-hidden="true" size={13} strokeWidth={2.1} />
    </span>
  );
}
