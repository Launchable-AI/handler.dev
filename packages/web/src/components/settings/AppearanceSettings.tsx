import { Moon, Sun, Check } from 'lucide-react';
import { useTheme, DARK_THEMES, LIGHT_THEMES, type Theme, type ThemeConfig } from '../../hooks/useTheme';

// Representative swatch colors per theme (hardcoded HSL strings for preview)
const THEME_SWATCHES: Record<Theme, string[]> = {
  terminal:  ['hsl(220 20% 8%)',  'hsl(185 70% 50%)', 'hsl(38 90% 55%)',  'hsl(145 60% 45%)'],
  midnight:  ['hsl(230 30% 7%)',  'hsl(220 85% 60%)', 'hsl(260 65% 62%)', 'hsl(200 80% 55%)'],
  handler:   ['hsl(200 10% 6%)',  'hsl(42 90% 50%)',  'hsl(175 50% 42%)', 'hsl(40 15% 90%)'],
  ember:     ['hsl(15 18% 7%)',   'hsl(5 80% 55%)',   'hsl(25 95% 55%)',  'hsl(275 50% 58%)'],
  void:      ['hsl(0 0% 5%)',     'hsl(185 30% 48%)', 'hsl(0 0% 50%)',    'hsl(0 0% 85%)'],
  blueprint: ['hsl(42 33% 96%)',  'hsl(192 85% 35%)', 'hsl(32 95% 42%)',  'hsl(152 60% 32%)'],
  paper:     ['hsl(0 0% 97%)',    'hsl(210 70% 45%)', 'hsl(0 0% 12%)',    'hsl(150 55% 32%)'],
  daylight:  ['hsl(205 40% 96%)', 'hsl(215 80% 48%)', 'hsl(195 80% 38%)', 'hsl(155 60% 34%)'],
  sand:      ['hsl(35 35% 94%)',  'hsl(28 90% 42%)',  'hsl(185 65% 35%)', 'hsl(25 25% 14%)'],
  frost:     ['hsl(210 25% 96%)', 'hsl(215 65% 48%)', 'hsl(192 70% 36%)', 'hsl(215 22% 14%)'],
};

function ThemeCard({ config, isSelected, onClick }: { config: ThemeConfig; isSelected: boolean; onClick: () => void }) {
  const swatches = THEME_SWATCHES[config.id];

  return (
    <button
      onClick={onClick}
      className={`relative text-left p-3 border-2 transition-all duration-200 hover:border-[hsl(var(--border-highlight))] ${
        isSelected
          ? 'border-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.05)] shadow-[0_0_12px_hsl(var(--cyan)/0.15)]'
          : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]'
      }`}
    >
      {isSelected && (
        <div className="absolute top-2 right-2">
          <Check className="h-3.5 w-3.5 text-[hsl(var(--cyan))]" />
        </div>
      )}

      {/* Color swatch row */}
      <div className="flex gap-1.5 mb-2.5">
        {swatches.map((color, i) => (
          <div
            key={i}
            className="h-5 flex-1 rounded-sm"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>

      <div className="text-xs font-medium text-[hsl(var(--text-primary))]">{config.name}</div>
      <div className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">{config.description}</div>
    </button>
  );
}

export function AppearanceSettings() {
  const { isDark, toggleTheme, preferredDark, preferredLight, setPreferredDark, setPreferredLight } = useTheme();

  return (
    <div className="space-y-8">
      {/* Mode Toggle */}
      <div>
        <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">Mode</h3>
        <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1 mb-3">
          Switch between dark and light mode
        </p>
        <div className="flex items-center gap-1 p-1 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] w-fit">
          <button
            onClick={() => { if (!isDark) toggleTheme(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
              isDark
                ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] border border-[hsl(var(--cyan)/0.3)]'
                : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
            }`}
          >
            <Moon className="h-3.5 w-3.5" />
            Dark
          </button>
          <button
            onClick={() => { if (isDark) toggleTheme(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
              !isDark
                ? 'bg-[hsl(var(--amber)/0.15)] text-[hsl(var(--amber))] border border-[hsl(var(--amber)/0.3)]'
                : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
            }`}
          >
            <Sun className="h-3.5 w-3.5" />
            Light
          </button>
        </div>
      </div>

      {/* Dark Themes */}
      <div>
        <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">Dark Themes</h3>
        <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1 mb-3">
          Choose your preferred dark theme
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {DARK_THEMES.map(config => (
            <ThemeCard
              key={config.id}
              config={config}
              isSelected={preferredDark === config.id}
              onClick={() => setPreferredDark(config.id)}
            />
          ))}
        </div>
      </div>

      {/* Light Themes */}
      <div>
        <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">Light Themes</h3>
        <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1 mb-3">
          Choose your preferred light theme
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {LIGHT_THEMES.map(config => (
            <ThemeCard
              key={config.id}
              config={config}
              isSelected={preferredLight === config.id}
              onClick={() => setPreferredLight(config.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
