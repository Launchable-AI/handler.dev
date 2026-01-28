/**
 * CommandBox - Reusable component for displaying copyable commands
 */

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CommandBoxProps {
  label: string;
  command: string;
}

export function CommandBox({ label, command }: CommandBoxProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(command);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = command;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="space-y-1">
      <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wide">
        {label}
      </span>
      <div className="flex items-center gap-2 p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
        <code className="flex-1 text-[10px] text-[hsl(var(--text-muted))] font-mono truncate">
          {command}
        </code>
        <button
          onClick={handleCopy}
          className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] transition-colors flex-shrink-0"
          title={copied ? 'Copied!' : 'Copy command'}
        >
          {copied ? (
            <Check className="h-3 w-3 text-[hsl(var(--green))]" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
    </div>
  );
}
