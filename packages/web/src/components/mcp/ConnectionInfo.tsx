import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { MCPConnectionConfig } from '../../api/client';

interface ConnectionInfoProps {
  config: MCPConnectionConfig;
  transport: string;
}

export function ConnectionInfo({ config, transport }: ConnectionInfoProps) {
  const [copied, setCopied] = useState(false);

  const configJson = JSON.stringify(config, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(configJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
          Connection Config ({transport})
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-[hsl(var(--green))]" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="p-3 text-[10px] font-mono bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] overflow-x-auto whitespace-pre-wrap">
        {configJson}
      </pre>
    </div>
  );
}
