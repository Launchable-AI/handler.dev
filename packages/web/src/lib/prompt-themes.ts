export type ShellPromptTheme = 'minimal' | 'clean' | 'bracket' | 'lambda' | 'cyberpunk' | 'multiline';

export interface PreviewSegment {
  text: string;
  color: string; // Color for dark terminal background
  lightColor?: string; // Color for light terminal background (falls back to color)
}

export interface PromptThemeDefinition {
  id: ShellPromptTheme;
  name: string;
  description: string;
  previewSegments: PreviewSegment[];
}

export const PROMPT_THEMES: PromptThemeDefinition[] = [
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean and simple with cyan accents',
    previewSegments: [
      { text: 'user', color: 'hsl(180 60% 55%)', lightColor: '#0e7490' },
      { text: ' ', color: 'inherit' },
      { text: '~/project', color: 'hsl(220 10% 85%)', lightColor: '#1e1e1e' },
      { text: ' ', color: 'inherit' },
      { text: 'main', color: 'hsl(280 60% 70%)', lightColor: '#8250df' },
      { text: ' ', color: 'inherit' },
      { text: '$', color: 'hsl(180 60% 55%)', lightColor: '#0e7490' },
      { text: ' ', color: 'inherit' },
    ],
  },
  {
    id: 'clean',
    name: 'Clean',
    description: 'Path-focused with ❯ prompt',
    previewSegments: [
      { text: '~/project', color: 'hsl(220 10% 95%)', lightColor: '#1e1e1e' },
      { text: ' on ', color: 'hsl(220 15% 40%)', lightColor: '#57606a' },
      { text: 'main', color: 'hsl(140 60% 55%)', lightColor: '#1a7f37' },
      { text: ' ❯', color: 'hsl(180 60% 55%)', lightColor: '#0e7490' },
      { text: ' ', color: 'inherit' },
    ],
  },
  {
    id: 'bracket',
    name: 'Bracket',
    description: 'Classic bracket-delimited segments',
    previewSegments: [
      { text: '[', color: 'hsl(210 80% 65%)', lightColor: '#0550ae' },
      { text: 'user@host', color: 'hsl(140 60% 55%)', lightColor: '#1a7f37' },
      { text: ']', color: 'hsl(210 80% 65%)', lightColor: '#0550ae' },
      { text: ' ', color: 'inherit' },
      { text: '[', color: 'hsl(210 80% 65%)', lightColor: '#0550ae' },
      { text: '~/project', color: 'hsl(40 80% 55%)', lightColor: '#9a6700' },
      { text: ']', color: 'hsl(210 80% 65%)', lightColor: '#0550ae' },
      { text: ' ', color: 'inherit' },
      { text: '[', color: 'hsl(210 80% 65%)', lightColor: '#0550ae' },
      { text: 'main', color: 'hsl(180 60% 55%)', lightColor: '#0e7490' },
      { text: ']', color: 'hsl(210 80% 65%)', lightColor: '#0550ae' },
      { text: ' $', color: 'hsl(210 80% 65%)', lightColor: '#0550ae' },
    ],
  },
  {
    id: 'lambda',
    name: 'Lambda',
    description: 'Minimalist with exit-code indicator',
    previewSegments: [
      { text: 'λ', color: 'hsl(140 60% 55%)', lightColor: '#1a7f37' },
      { text: ' ', color: 'inherit' },
      { text: '~/project', color: 'hsl(220 10% 85%)', lightColor: '#1e1e1e' },
      { text: ' ', color: 'inherit' },
      { text: '(main)', color: 'hsl(280 60% 70%)', lightColor: '#8250df' },
      { text: ' ', color: 'inherit' },
    ],
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: 'Neon arrows with vivid colors',
    previewSegments: [
      { text: '▸ ', color: 'hsl(280 60% 70%)', lightColor: '#8250df' },
      { text: 'user', color: 'hsl(180 60% 55%)', lightColor: '#0e7490' },
      { text: ' ▸ ', color: 'hsl(280 60% 70%)', lightColor: '#8250df' },
      { text: '~/project', color: 'hsl(40 80% 55%)', lightColor: '#9a6700' },
      { text: ' ▸ ', color: 'hsl(280 60% 70%)', lightColor: '#8250df' },
      { text: 'main', color: 'hsl(140 60% 55%)', lightColor: '#1a7f37' },
      { text: ' ▸', color: 'hsl(280 60% 70%)', lightColor: '#8250df' },
      { text: ' ', color: 'inherit' },
    ],
  },
  {
    id: 'multiline',
    name: 'Multiline',
    description: 'Two-line with box-drawing characters',
    previewSegments: [
      { text: '┌─[', color: 'hsl(210 80% 65%)', lightColor: '#0550ae' },
      { text: 'user@host', color: 'hsl(140 60% 55%)', lightColor: '#1a7f37' },
      { text: ']─[', color: 'hsl(210 80% 65%)', lightColor: '#0550ae' },
      { text: '~/project', color: 'hsl(40 80% 55%)', lightColor: '#9a6700' },
      { text: ']─[', color: 'hsl(210 80% 65%)', lightColor: '#0550ae' },
      { text: 'main', color: 'hsl(180 60% 55%)', lightColor: '#0e7490' },
      { text: ']\n└─$', color: 'hsl(210 80% 65%)', lightColor: '#0550ae' },
      { text: ' ', color: 'inherit' },
    ],
  },
];
