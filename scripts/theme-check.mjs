// theme:check —— 主题规范校验（M4）。
// 校验内容：
// 1. packages/theming/src/themes/*.css 与 themes.ts 的 THEME_VARIABLES 键集合一致（必需变量全部存在，无多余键）。
// 2. 核心 CSS（packages/app/src/app.css）中 color/background/border 声明不得引入
//    豁免清单之外的硬编码颜色；豁免逐条注释，等待后续主题别名变量迁移。
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
  }
  return errors
}

const normalize = (value) => value.trim().replace(/\s+/g, ' ')

export function checkCoreCss({ cssSource, filePath, exemptions = [] }) {
  const errors = []
  const lines = cssSource.split('\n')
  lines.forEach((line, index) => {
    const match = line.match(/^\s*([\w-]+)\s*:\s*([^;]+);?\s*$/)
    if (!match) return
    const [, property, rawValue] = match
    if (!COLOR_PROPERTY.test(property)) return
    const value = normalize(rawValue)
    if (!COLOR_LITERAL.test(value) || value.includes('var(')) return
    const exempt = exemptions.some(
      (entry) => entry.property === property && normalize(entry.value) === value,
    )
    if (!exempt) {
      errors.push(
        `${filePath}:${index + 1}: ${property}: ${value} 使用了硬编码颜色，` +
          `须改用 var(--md-*) 或主题别名，或在 theme-check.mjs 豁免清单登记`,
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
