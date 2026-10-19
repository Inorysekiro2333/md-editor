export const THEME_IDS = ['github-light', 'github-dark', 'paper-serif'] as const

export type ThemeId = (typeof THEME_IDS)[number]

/**
 * 双层 token：--md-* 为文档层（Milkdown/CodeMirror 正文），--ui-* 为 chrome 层
 * （侧栏/标签页/工具栏/状态栏/弹窗等外壳）。applyTheme() 会把两组一起写到
 * documentElement 内联样式；scripts/theme-check.mjs 校验键集合与 WCAG 对比度。
 */
export const THEME_VARIABLES = [
  // 文档层
  '--md-bg',
  '--md-fg',
  '--md-accent',
  '--md-border',
  '--md-code-bg',
  '--md-font-serif',
  // chrome 层
  '--ui-bg',
  '--ui-surface',
  '--ui-surface-hover',
  '--ui-fg',
  '--ui-fg-muted',
  '--ui-border',
  '--ui-accent',
  '--ui-accent-fg',
  '--ui-danger',
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
    // chrome 层：GitHub 冷灰体系，外壳底色让文档区白色更突出
    '--ui-bg': '#f6f8fa',
    '--ui-surface': '#ffffff',
    '--ui-surface-hover': '#eff2f5',
    '--ui-fg': '#1f2328',
    '--ui-fg-muted': '#57606a',
    '--ui-border': '#d0d7de',
    '--ui-accent': '#0969da',
    '--ui-accent-fg': '#ffffff',
    '--ui-danger': '#cf222e',
  },
  'github-dark': {
    '--md-bg': '#0d1117',
    '--md-fg': '#e6edf3',
    '--md-accent': '#4493f8',
    '--md-border': '#30363d',
    '--md-code-bg': '#161b22',
    '--md-font-serif': "Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif",
    // chrome 层：GitHub 暗色体系，accent 提亮保证可读性
    '--ui-bg': '#0d1117',
    '--ui-surface': '#161b22',
    '--ui-surface-hover': '#21262d',
    '--ui-fg': '#e6edf3',
    '--ui-fg-muted': '#8b949e',
    '--ui-border': '#30363d',
    '--ui-accent': '#4493f8',
    '--ui-accent-fg': '#0d1117',
    '--ui-danger': '#f85149',
  },
  'paper-serif': {
    '--md-bg': '#faf7f2',
    '--md-fg': '#3b2f2a',
    '--md-accent': '#8b4a2f',
    '--md-border': '#e2d8c8',
    '--md-code-bg': '#f1eade',
    '--md-font-serif': "Georgia, 'Times New Roman', 'Songti SC', 'Noto Serif SC', serif",
    // chrome 层：暖纸体系，琥珀 accent 呼应奶油底色
    '--ui-bg': '#fffbec',
    '--ui-surface': '#ffffff',
    '--ui-surface-hover': '#f6f0dc',
    '--ui-fg': '#0f172a',
    '--ui-fg-muted': '#475569',
    '--ui-border': '#e8e0c9',
    '--ui-accent': '#d97706',
    '--ui-accent-fg': '#000000',
    '--ui-danger': '#dc2626',
  },
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}
