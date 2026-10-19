// theme:check —— 主题规范校验（M4）。
// 校验内容：
// 1. packages/theming/src/themes/*.css 与 themes.ts 的 THEME_VARIABLES 键集合一致（必需变量全部存在，无多余键）。
// 2. 核心 CSS（packages/app/src/app.css）中 color/background/border 声明不得引入
//    豁免清单之外的硬编码颜色；豁免逐条注释，等待后续主题别名变量迁移。
// 3. 关键前景/背景组合的 WCAG 对比度：--ui-fg/--ui-bg、--ui-fg-muted/--ui-bg、
//    --ui-accent-fg/--ui-accent、--md-fg/--md-bg；rgba() 按不透明处理，无法静态解析的值安全跳过。
// 退出码：0 = 通过；1 = 存在校验错误（错误列表输出到 stderr）。
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')

const COLOR_PROPERTY =
  /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?)$/
const COLOR_LITERAL =
  /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:white|black|red|green|blue|gray|grey)\b/i

export function extractStringArray(source, constName) {
  const match = source.match(new RegExp(`export const ${constName}\\s*=\\s*\\[([^\\]]*)\\]`))
  if (!match) return null
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

function parseThemeVariables(cssSource) {
  const keys = new Set()
  for (const match of cssSource.matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
    keys.add(match[1])
  }
  return keys
}

// 主题变量声明解析：变量名 -> 原始值（仅统计行首 --* 声明）。
function parseThemeDeclarations(cssSource) {
  const vars = new Map()
  for (const match of cssSource.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
    vars.set(match[1], match[2].trim())
  }
  return vars
}

// WCAG 对比度校验的成对组合与阈值（AA 正文 4.5:1，外壳主文本 7:1）。
const CONTRAST_PAIRS = [
  { fg: '--ui-fg', bg: '--ui-bg', min: 7, label: 'ui-fg/ui-bg' },
  { fg: '--ui-fg-muted', bg: '--ui-bg', min: 4.5, label: 'ui-fg-muted/ui-bg' },
  { fg: '--ui-accent-fg', bg: '--ui-accent', min: 4.5, label: 'ui-accent-fg/ui-accent' },
  { fg: '--md-fg', bg: '--md-bg', min: 4.5, label: 'md-fg/md-bg' },
]

// 解析颜色为 [r, g, b]；支持十六进制（3/4/6/8 位）与 rgb()/rgba()，
// rgba() 按不透明处理（忽略 alpha），var()/颜色关键字等返回 null 由调用方跳过，避免误报或崩溃。
function parseColorChannels(value) {
  const v = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)
  if (hex) {
    let h = hex[1]
    if (h.length <= 4) h = [...h].map((c) => c + c).join('')
    return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16))
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(v)
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3) return null
    // 百分比分量需按 0-100 语义换算，此处直接拒绝，避免被当作 0-255 静默算错。
    if (parts.slice(0, 3).some((p) => p.includes('%'))) return null
    const channels = parts.slice(0, 3).map((p) => Number.parseFloat(p))
    if (channels.some((c) => !Number.isFinite(c))) return null
    return channels
  }
  return null
}

function relativeLuminance([r, g, b]) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

// 返回对比度比值；任一颜色无法解析时返回 null（由调用方跳过该组合）。
export function contrastRatio(fgValue, bgValue) {
  const fg = parseColorChannels(fgValue)
  const bg = parseColorChannels(bgValue)
  if (!fg || !bg) return null
  const [l1, l2] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a)
  return (l1 + 0.05) / (l2 + 0.05)
}

export function checkThemeContrast(variables, themeFile) {
  const errors = []
  for (const { fg, bg, min, label } of CONTRAST_PAIRS) {
    const fgValue = variables.get(fg)
    const bgValue = variables.get(bg)
    if (!fgValue || !bgValue) continue
    const ratio = contrastRatio(fgValue, bgValue)
    if (ratio === null) continue
    if (ratio < min) {
      errors.push(
        `${themeFile}: ${label} 对比度 ${ratio.toFixed(2)}:1 低于 ${min}:1（${fgValue} / ${bgValue}）`,
      )
    }
  }
  return errors
}

export async function checkThemes({ themeDir, themeIds, requiredVariables }) {
  const errors = []
  for (const themeId of themeIds) {
    const file = `${themeId}.css`
    let cssSource
    try {
      cssSource = await readFile(path.join(themeDir, file), 'utf8')
    } catch {
      errors.push(`主题文件缺失: themes/${file}`)
      continue
    }
    const keys = parseThemeVariables(cssSource)
    for (const variable of requiredVariables) {
      if (!keys.has(variable)) {
        errors.push(`${file}: 缺少必需主题变量 ${variable}`)
      }
    }
    for (const key of keys) {
      if (!requiredVariables.includes(key)) {
        errors.push(`${file}: 主题变量不在必需集合中: ${key}`)
      }
    }
    // --ui-* 已包含在 THEME_VARIABLES 必需集合中，键集合一致性由上方统一校验；
    // 这里补充关键前景/背景组合的 WCAG 对比度校验。
    errors.push(...checkThemeContrast(parseThemeDeclarations(cssSource), file))
  }
  return errors
}

const normalize = (value) => value.trim().replace(/\s+/g, ' ')

// var(--x, fallback)：token 未定义时 fallback 是实际生效值，必须参与硬编码检查。
// 迭代展开最内层 var()，最多 5 层；无 fallback 的 var() 展开为空串（无法核验，放行）。
function resolveVarFallbacks(value) {
  let resolved = value
  for (let i = 0; i < 5 && resolved.includes('var('); i += 1) {
    const next = resolved.replace(
      /var\(\s*--[\w-]+\s*(?:,\s*((?:[^()]|\([^()]*\))*?)\s*)?\)/g,
      (_, fallback) => (fallback === undefined ? '' : fallback),
    )
    if (next === resolved) break
    resolved = normalize(next)
  }
  return resolved
}

export function checkCoreCss({ cssSource, filePath, exemptions = [] }) {
  const errors = []
  const lines = cssSource.split('\n')
  lines.forEach((line, index) => {
    const match = line.match(/^\s*([\w-]+)\s*:\s*([^;]+);?\s*$/)
    if (!match) return
    const [, property, rawValue] = match
    if (!COLOR_PROPERTY.test(property)) return
    const resolved = resolveVarFallbacks(normalize(rawValue))
    if (!COLOR_LITERAL.test(resolved)) return
    const exempt = exemptions.some(
      (entry) => entry.property === property && normalize(entry.value) === resolved,
    )
    if (!exempt) {
      errors.push(
        `${filePath}:${index + 1}: ${property}: ${resolved} 使用了硬编码颜色，` +
          `须改用 var(--md-*) / var(--ui-*) 或主题别名，或在 theme-check.mjs 豁免清单登记`,
      )
    }
  })
  return errors
}

// 显式豁免清单：既有硬编码颜色逐条登记，待主题别名变量（如 --md-fg-muted）落地后迁移。
export const CORE_CSS_EXEMPTIONS = [
  {
    property: 'color',
    value: '#57606a',
    reason: '浅色主题 muted 文本；待引入 --md-fg-muted 别名后迁移',
  },
  {
    property: 'color',
    value: '#cf222e',
    reason: '查找错误提示等危险文本色；待引入 --md-danger 别名后迁移',
  },
  {
    property: 'background',
    value: 'rgba(31, 35, 40, 0.06)',
    reason: '浅色主题 hover 覆盖层（文件行/按钮）',
  },
  {
    property: 'background',
    value: 'rgba(31, 35, 40, 0.08)',
    reason: '表格工具栏按钮 hover 覆盖层',
  },
  { property: 'background', value: 'rgba(31, 35, 40, 0.4)', reason: '模态遮罩半透明覆盖层' },
  { property: 'background', value: 'rgba(9, 105, 218, 0.12)', reason: '大纲激活项 accent 覆盖层' },
  {
    property: 'background',
    value: '#0969da',
    reason: '查找激活按钮 accent 背景；待引入别名后迁移',
  },
  {
    property: 'border-color',
    value: '#0969da',
    reason: '查找激活按钮 accent 边框；待引入别名后迁移',
  },
  { property: 'color', value: '#ffffff', reason: '查找激活按钮 accent 上的反白前景' },
  {
    property: 'border',
    value: '1px solid #d0d7de',
    reason: 'var(--md-border) 的 fallback 兜底；token 已定义，待去除 fallback 后移除豁免',
  },
  { property: 'border-bottom', value: '1px solid #d0d7de', reason: '同 border 豁免' },
  { property: 'border-right', value: '1px solid #d0d7de', reason: '同 border 豁免' },
  { property: 'border-left', value: '1px solid #d0d7de', reason: '同 border 豁免' },
  {
    property: 'background',
    value: '#f6f8fa',
    reason: '代码块背景 var(--md-code-bg) 的 fallback；token 已定义，待去除 fallback 后移除豁免',
  },
  {
    property: 'background',
    value: 'color-mix(in srgb, #f6f8fa 55%, transparent)',
    reason: '行内代码标签背景 color-mix 的 fallback；token 已定义，待去除 fallback 后移除豁免',
  },
  {
    property: 'background',
    value: 'rgba(31, 35, 40, 0.05)',
    reason: '表头/代码块头部背景 var() 的 fallback；token 已定义，待去除 fallback 后移除豁免',
  },
]

export async function runCheck({ root = REPO_ROOT } = {}) {
  const errors = []
  let themeIds = []
  let requiredVariables = []
  try {
    const themesTsSource = await readFile(path.join(root, 'packages/theming/src/themes.ts'), 'utf8')
    themeIds = extractStringArray(themesTsSource, 'THEME_IDS') ?? []
    requiredVariables = extractStringArray(themesTsSource, 'THEME_VARIABLES') ?? []
  } catch {
    errors.push('无法读取 packages/theming/src/themes.ts，跳过主题键集合校验')
  }
  if (themeIds.length > 0 && requiredVariables.length > 0) {
    const themeErrors = await checkThemes({
      themeDir: path.join(root, 'packages/theming/src/themes'),
      themeIds,
      requiredVariables,
    })
    errors.push(...themeErrors)
  }
  try {
    const appCssSource = await readFile(path.join(root, 'packages/app/src/app.css'), 'utf8')
    errors.push(
      ...checkCoreCss({
        cssSource: appCssSource,
        filePath: 'packages/app/src/app.css',
        exemptions: CORE_CSS_EXEMPTIONS,
      }),
    )
  } catch {
    errors.push('无法读取 packages/app/src/app.css，跳过核心 CSS 硬编码颜色校验')
  }
  return { ok: errors.length === 0, errors }
}

async function main() {
  const { ok, errors } = await runCheck()
  if (ok) {
    console.log('theme:check 通过：主题键集合一致，核心 CSS 无未豁免硬编码颜色')
    return
  }
  for (const error of errors) {
    console.error(error)
  }
  process.exit(1)
}

const isCli =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isCli) {
  await main()
}
