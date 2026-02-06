export type ShellPromptTheme = 'minimal' | 'clean' | 'bracket' | 'lambda' | 'cyberpunk' | 'multiline';

export interface PreviewSegment {
  text: string;
  color: string; // Tailwind/HSL color class
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
      { text: 'user', color: 'hsl(180 60% 55%)' },
      { text: ' ', color: 'inherit' },
      { text: '~/project', color: 'hsl(220 10% 85%)' },
      { text: ' ', color: 'inherit' },
      { text: 'main', color: 'hsl(280 60% 70%)' },
      { text: ' ', color: 'inherit' },
      { text: '$', color: 'hsl(180 60% 55%)' },
      { text: ' ', color: 'inherit' },
    ],
  },
  {
    id: 'clean',
    name: 'Clean',
    description: 'Path-focused with ❯ prompt',
    previewSegments: [
      { text: '~/project', color: 'hsl(220 10% 95%)' },
      { text: ' on ', color: 'hsl(220 15% 40%)' },
      { text: 'main', color: 'hsl(140 60% 55%)' },
      { text: ' ❯', color: 'hsl(180 60% 55%)' },
      { text: ' ', color: 'inherit' },
    ],
  },
  {
    id: 'bracket',
    name: 'Bracket',
    description: 'Classic bracket-delimited segments',
    previewSegments: [
      { text: '[', color: 'hsl(210 80% 65%)' },
      { text: 'user@host', color: 'hsl(140 60% 55%)' },
      { text: ']', color: 'hsl(210 80% 65%)' },
      { text: ' ', color: 'inherit' },
      { text: '[', color: 'hsl(210 80% 65%)' },
      { text: '~/project', color: 'hsl(40 80% 55%)' },
      { text: ']', color: 'hsl(210 80% 65%)' },
      { text: ' ', color: 'inherit' },
      { text: '[', color: 'hsl(210 80% 65%)' },
      { text: 'main', color: 'hsl(180 60% 55%)' },
      { text: ']', color: 'hsl(210 80% 65%)' },
      { text: ' $', color: 'hsl(210 80% 65%)' },
    ],
  },
  {
    id: 'lambda',
    name: 'Lambda',
    description: 'Minimalist with exit-code indicator',
    previewSegments: [
      { text: 'λ', color: 'hsl(140 60% 55%)' },
      { text: ' ', color: 'inherit' },
      { text: '~/project', color: 'hsl(220 10% 85%)' },
      { text: ' ', color: 'inherit' },
      { text: '(main)', color: 'hsl(280 60% 70%)' },
      { text: ' ', color: 'inherit' },
    ],
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: 'Neon arrows with vivid colors',
    previewSegments: [
      { text: '▸ ', color: 'hsl(280 60% 70%)' },
      { text: 'user', color: 'hsl(180 60% 55%)' },
      { text: ' ▸ ', color: 'hsl(280 60% 70%)' },
      { text: '~/project', color: 'hsl(40 80% 55%)' },
      { text: ' ▸ ', color: 'hsl(280 60% 70%)' },
      { text: 'main', color: 'hsl(140 60% 55%)' },
      { text: ' ▸', color: 'hsl(280 60% 70%)' },
      { text: ' ', color: 'inherit' },
    ],
  },
  {
    id: 'multiline',
    name: 'Multiline',
    description: 'Two-line with box-drawing characters',
    previewSegments: [
      { text: '┌─[', color: 'hsl(210 80% 65%)' },
      { text: 'user@host', color: 'hsl(140 60% 55%)' },
      { text: ']─[', color: 'hsl(210 80% 65%)' },
      { text: '~/project', color: 'hsl(40 80% 55%)' },
      { text: ']─[', color: 'hsl(210 80% 65%)' },
      { text: 'main', color: 'hsl(180 60% 55%)' },
      { text: ']\n└─$', color: 'hsl(210 80% 65%)' },
      { text: ' ', color: 'inherit' },
    ],
  },
];
