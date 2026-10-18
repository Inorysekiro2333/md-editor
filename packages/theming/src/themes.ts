export const THEME_IDS = ['github-light', 'github-dark', 'paper-serif'] as const

export type ThemeId = (typeof THEME_IDS)[number]

export const THEME_VARIABLES = [
  '--md-bg',
  '--md-fg',
  '--md-accent',
  '--md-border',
  '--md-code-bg',
  '--md-font-serif',
] as const

export type ThemeVariable = (typeof THEME_VARIABLES)[number]

export type ThemeVars = Record<ThemeVariable, string>

export const THEMES: Record<ThemeId, ThemeVars> = {
  'github-light': {
    '--md-bg': '#ffffff',
    '--md-fg': '#24292f',
    '--md-accent': '#0969da',
    '--md-border': '#d0d7de',
    '--md-code-bg': '#f6f8fa',
    '--md-font-serif': "Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif",
  },
  'github-dark': {
    '--md-bg': '#0d1117',
    '--md-fg': '#e6edf3',
    '--md-accent': '#4493f8',
    '--md-border': '#30363d',
    '--md-code-bg': '#161b22',
    '--md-font-serif': "Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif",
  },
  'paper-serif': {
    '--md-bg': '#faf7f2',
    '--md-fg': '#3b2f2a',
    '--md-accent': '#8b4a2f',
    '--md-border': '#e2d8c8',
    '--md-code-bg': '#f1eade',
    '--md-font-serif': "Georgia, 'Times New Roman', 'Songti SC', 'Noto Serif SC', serif",
  },
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}
