import { Bot } from 'lucide-react';

interface AgentAssociatedTabIndicatorProps {
  dedupeProtected: boolean;
  id: string;
}

function getDescription(dedupeProtected: boolean) {
  return dedupeProtected
    ? 'Agent-associated tab · activity appears ongoing or is unclear, so it stays open during duplicate cleanup; Weaver keeps any containing group together during sorting and moving.'
    : 'Agent-associated tab · no longer appears in active agent use, so its agent status does not protect it from duplicate cleanup; Weaver keeps any containing group together during sorting and moving.';
}

function getTooltip(dedupeProtected: boolean) {
  return dedupeProtected
    ? 'Agent may still be using this tab — Weaver keeps it open during duplicate cleanup'
    : 'Agent appears finished — Weaver may close it if it’s a duplicate';
}

export function AgentAssociatedTabIndicator({
  dedupeProtected,
  id,
}: AgentAssociatedTabIndicatorProps) {
  const description = getDescription(dedupeProtected);
  return (
    <>
      <span
        className="agent-associated-tab-indicator"
        aria-hidden="true"
        data-tooltip={getTooltip(dedupeProtected)}
        title=""
      >
        <Bot aria-hidden="true" size={13} strokeWidth={2.1} />
      </span>
      <span id={id} className="sr-only popup-sr-only">
        {description}
      </span>
    </>
  );
}
