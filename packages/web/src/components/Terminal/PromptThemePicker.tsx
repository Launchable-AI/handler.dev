import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { PROMPT_THEMES, type ShellPromptTheme } from '../../lib/prompt-themes';

interface PromptThemePickerProps {
  activeTheme: ShellPromptTheme;
  onSelect: (theme: ShellPromptTheme) => void;
  onClose: () => void;
  /** Override default positioning classes */
  className?: string;
}

export function PromptThemePicker({ activeTheme, onSelect, onClose, className }: PromptThemePickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={className || "absolute right-0 bottom-full mb-1 z-50 w-72 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-lg rounded overflow-hidden"}
    >
      <div className="px-3 py-2 border-b border-[hsl(var(--border))]">
        <span className="text-[10px] font-medium text-[hsl(var(--text-muted))] uppercase tracking-wider">
          Shell Prompt Theme
        </span>
      </div>
      <div className="max-h-[320px] overflow-y-auto">
        {PROMPT_THEMES.map((theme) => {
          const isActive = theme.id === activeTheme;
          return (
            <button
              key={theme.id}
              onClick={() => {
                onSelect(theme.id);
                onClose();
              }}
              className={`w-full text-left px-3 py-2.5 transition-colors ${
                isActive
                  ? 'bg-[hsl(var(--cyan)/0.08)]'
                  : 'hover:bg-[hsl(var(--bg-elevated))]'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-[hsl(var(--text-primary))]">
                  {theme.name}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-[hsl(var(--text-muted))]">
                    {theme.description}
                  </span>
                  {isActive && (
                    <Check className="h-3 w-3 text-[hsl(var(--cyan))]" />
                  )}
                </div>
              </div>
              {/* Terminal-style preview */}
              <div className="px-2 py-1.5 rounded bg-[hsl(220_20%_6%)] font-mono text-[11px] leading-relaxed whitespace-pre">
                {theme.previewSegments.map((seg, i) => (
                  <span
                    key={i}
                    style={{ color: seg.color === 'inherit' ? undefined : seg.color }}
                  >
                    {seg.text}
                  </span>
                ))}
                <span className="animate-pulse text-[hsl(180_60%_55%)]">▎</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
