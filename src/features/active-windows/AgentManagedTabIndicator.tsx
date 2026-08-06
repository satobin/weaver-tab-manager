import { Bot } from 'lucide-react';

interface AgentManagedTabIndicatorProps {
  id?: string;
}

export function AgentManagedTabIndicator({ id }: AgentManagedTabIndicatorProps) {
  return (
    <span
      id={id}
      className="agent-managed-tab-indicator"
      role="img"
      aria-label="Agent-managed tab"
      title="Agent-managed tab detected locally"
    >
      <Bot aria-hidden="true" size={13} strokeWidth={2.1} />
    </span>
  );
}
