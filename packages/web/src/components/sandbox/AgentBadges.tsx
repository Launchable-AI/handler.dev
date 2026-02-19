/**
 * AgentBadges — Shows AI agent logos for installed/running agents in a sandbox.
 * Grayed out = installed but not running, full color = running (with pulse animation).
 */

import { useSandboxAgents } from '../../hooks/useSandboxes';

interface AgentBadgesProps {
  sandboxId: string;
  isRunning: boolean;
  compact?: boolean;
}

const AGENT_COLORS: Record<string, string> = {
  claude: '#6B5CE7',
  codex: '#10A37F',
  gemini: '#4285F4',
  opencode: '#06B6D4',
};

function ClaudeLogo({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 2L10.5 6.5L15 8L10.5 9.5L8 14L5.5 9.5L1 8L5.5 6.5L8 2Z" fill={color} />
    </svg>
  );
}

function CodexLogo({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke={color} strokeWidth="1.5" fill="none" />
      <circle cx="8" cy="8" r="2.5" fill={color} />
    </svg>
  );
}

function GeminiLogo({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 1L9.5 6.5L15 8L9.5 9.5L8 15L6.5 9.5L1 8L6.5 6.5L8 1Z" fill={color} opacity="0.6" />
      <path d="M8 4L9 6.5L11.5 7.5L9 8.5L8 11L7 8.5L4.5 7.5L7 6.5L8 4Z" fill={color} />
    </svg>
  );
}

function OpenCodeLogo({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke={color} strokeWidth="1.2" fill="none" />
      <path d="M5 7L7 9L5 11" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="9" y1="11" x2="12" y2="11" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

const AGENT_LOGOS: Record<string, typeof ClaudeLogo> = {
  claude: ClaudeLogo,
  codex: CodexLogo,
  gemini: GeminiLogo,
  opencode: OpenCodeLogo,
};

export function AgentBadges({ sandboxId, isRunning, compact }: AgentBadgesProps) {
  const { data: agents } = useSandboxAgents(sandboxId, isRunning);

  if (!agents) return null;

  const visibleAgents = agents.filter(a => a.installed || a.running);
  if (visibleAgents.length === 0) return null;

  const size = compact ? 12 : 14;

  return (
    <div className="flex items-center gap-0.5">
      {visibleAgents.map(agent => {
        const Logo = AGENT_LOGOS[agent.id];
        const color = AGENT_COLORS[agent.id] || '#888';
        if (!Logo) return null;

        return (
          <span
            key={agent.id}
            title={`${agent.name}: ${agent.running ? 'running' : 'installed'}`}
            className={`inline-flex ${agent.running ? 'animate-pulse' : 'opacity-40'}`}
          >
            <Logo color={color} size={size} />
          </span>
        );
      })}
    </div>
  );
}
