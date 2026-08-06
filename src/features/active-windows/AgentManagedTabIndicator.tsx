import { Bot } from 'lucide-react';

interface AgentManagedTabIndicatorProps {
  id: string;
}

const DESCRIPTION = 'Agent-associated tab · kept open during duplicate cleanup';

export function AgentManagedTabIndicator({ id }: AgentManagedTabIndicatorProps) {
  return (
    <>
      <span
        className="agent-managed-tab-indicator"
        aria-hidden="true"
        data-tooltip={DESCRIPTION}
        title=""
      >
        <Bot aria-hidden="true" size={13} strokeWidth={2.1} />
      </span>
      <span id={id} className="sr-only popup-sr-only">
        {DESCRIPTION}
      </span>
    </>
  );
}
