import { THEMES, THEME_VARIABLES, isThemeId, type ThemeId } from './themes'

/**
 * 把主题变量写到 document.documentElement.style，并设置 data-theme 属性
 * （e2e 通过 [data-theme=...] 断言当前主题）。
 * 未知 id 回退 github-light，避免渲染层拿到非法值后无样式可用。
 */
export function applyTheme(id: ThemeId): void {
  const themeId = isThemeId(id) ? id : 'github-light'
  const vars = THEMES[themeId]
  const root = document.documentElement
  for (const name of THEME_VARIABLES) {
    root.style.setProperty(name, vars[name])
  }
  root.setAttribute('data-theme', themeId)
}
