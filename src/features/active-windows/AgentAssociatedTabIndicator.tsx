import { Bot } from 'lucide-react';

interface AgentAssociatedTabIndicatorProps {
  id: string;
}

const DESCRIPTION =
  'Agent-associated tab · kept open during duplicate cleanup; Weaver keeps any containing group together during sorting and moving.';

export function AgentAssociatedTabIndicator({ id }: AgentAssociatedTabIndicatorProps) {
  return (
    <>
      <span
        className="agent-associated-tab-indicator"
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
