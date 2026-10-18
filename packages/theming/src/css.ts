import { THEMES, THEME_VARIABLES, type ThemeId } from './themes'

/** 生成导出 HTML 用的主题 CSS：变量 + body/代码/引用/链接基础排版。 */
export function themeCss(id: ThemeId): string {
  const vars = THEMES[id]
  const lines = THEME_VARIABLES.map((name) => `  ${name}: ${vars[name]};`)
  return [
    ':root {',
    ...lines,
    '}',
    '',
    'body {',
    '  margin: 0 auto;',
    '  max-width: 52em;',
    '  padding: 2rem 1.5rem 4rem;',
    '  background: var(--md-bg);',
    '  color: var(--md-fg);',
    '  line-height: 1.7;',
    '}',
    'h1, h2, h3, h4, h5, h6 {',
    '  line-height: 1.3;',
    '}',
    'a {',
    '  color: var(--md-accent);',
    '}',
    'code, pre {',
    '  background: var(--md-code-bg);',
    '}',
    'blockquote {',
    '  border-left: 4px solid var(--md-border);',
    '  margin-left: 0;',
    '  padding-left: 1rem;',
    '  color: var(--md-fg);',
    '}',
    'table {',
    '  border-collapse: collapse;',
    '}',
    'th, td {',
    '  border: 1px solid var(--md-border);',
    '  padding: 0.35rem 0.75rem;',
    '}',
    'img {',
    '  max-width: 100%;',
    '}',
  ].join('\n')
}
