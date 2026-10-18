import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkCoreCss, checkThemes, extractStringArray, runCheck } from './theme-check.mjs'

const REQUIRED = [
  '--md-bg',
  '--md-fg',
  '--md-accent',
  '--md-border',
  '--md-code-bg',
  '--md-font-serif',
]

function themeCss(vars: string[]) {
  return ["[data-theme='x'] {", ...vars.map((v) => `  ${v}: #123456;`), '}'].join('\n')
}

async function makeFixture(options: {
  themeVars?: string[][]
  themeIds?: string[]
  requiredVars?: string[]
  appCss?: string
}) {
  const root = await mkdtemp(path.join(tmpdir(), 'theme-check-'))
  const themingSrc = path.join(root, 'packages', 'theming', 'src')
  await mkdir(path.join(themingSrc, 'themes'), { recursive: true })
  const ids = options.themeIds ?? ['github-light', 'github-dark', 'paper-serif']
  await writeFile(
    path.join(themingSrc, 'themes.ts'),
    `export const THEME_IDS = [${ids.map((id) => `'${id}'`).join(', ')}] as const\n\nexport const THEME_VARIABLES = [${(
      options.requiredVars ?? REQUIRED
    )
      .map((v) => `'${v}'`)
      .join(', ')}] as const\n`,
  )
  const vars = options.themeVars ?? [REQUIRED, REQUIRED, REQUIRED]
  for (let i = 0; i < ids.length; i += 1) {
    await writeFile(path.join(themingSrc, 'themes', `${ids[i]}.css`), themeCss(vars[i] ?? []))
  }
  const appSrc = path.join(root, 'packages', 'app', 'src')
  await mkdir(appSrc, { recursive: true })
  await writeFile(
    path.join(appSrc, 'app.css'),
    options.appCss ?? 'body {\n  color: var(--fg);\n}\n',
  )
  return root
}

const fixtures: string[] = []
async function trackedFixture(options: Parameters<typeof makeFixture>[0]) {
  const root = await makeFixture(options)
  fixtures.push(root)
  return root
}

afterAll(async () => {
  for (const root of fixtures) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('extractStringArray', () => {
  it('extracts THEME_VARIABLES from themes.ts', async () => {
    const root = await trackedFixture({})
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(path.join(root, 'packages', 'theming', 'src', 'themes.ts'), 'utf8'),
    )
    expect(extractStringArray(source, 'THEME_VARIABLES')).toEqual(REQUIRED)
  })
})

describe('checkThemes', () => {
  it('passes when all themes declare exactly the required variables', async () => {
    const root = await trackedFixture({})
    const errors = await checkThemes({
      themeDir: path.join(root, 'packages', 'theming', 'src', 'themes'),
      themeIds: ['github-light'],
      requiredVariables: REQUIRED,
    })
    expect(errors).toEqual([])
  })

  it('reports missing required variables per theme file', async () => {
    const root = await trackedFixture({ themeVars: [REQUIRED.filter((v) => v !== '--md-accent')] })
    const errors = await checkThemes({
      themeDir: path.join(root, 'packages', 'theming', 'src', 'themes'),
      themeIds: ['github-light'],
      requiredVariables: REQUIRED,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('github-light.css')
    expect(errors[0]).toContain('--md-accent')
  })

  it('reports keys that are not in the required set', async () => {
    const root = await trackedFixture({ themeVars: [[...REQUIRED, '--md-extra']] })
    const errors = await checkThemes({
      themeDir: path.join(root, 'packages', 'theming', 'src', 'themes'),
      themeIds: ['github-light'],
      requiredVariables: REQUIRED,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('--md-extra')
  })

  it('reports a theme file that is missing entirely', async () => {
    const root = await trackedFixture({ themeIds: ['github-light'] })
    const errors = await checkThemes({
      themeDir: path.join(root, 'packages', 'theming', 'src', 'themes'),
      themeIds: ['github-light', 'github-dark'],
      requiredVariables: REQUIRED,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('github-dark.css')
  })
})

describe('checkCoreCss', () => {
  it('passes when declarations use theme variables', () => {
    const errors = checkCoreCss({
      cssSource:
        'body {\n  color: var(--fg);\n  background: var(--md-bg, #ffffff);\n  border: 1px solid var(--md-border);\n}\n',
      filePath: 'app.css',
    })
    expect(errors).toEqual([])
  })

  it('reports hardcoded color literals without var()', () => {
    const errors = checkCoreCss({
      cssSource: '.badge {\n  color: #123456;\n  background: rgba(0, 0, 0, 0.5);\n}\n',
      filePath: 'app.css',
    })
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('app.css:2')
    expect(errors[1]).toContain('background')
  })

  it('allows declarations listed in the explicit exemption list', () => {
    const errors = checkCoreCss({
      cssSource: '.hover {\n  background: rgba(31, 35, 40, 0.06);\n}\n',
      filePath: 'app.css',
      exemptions: [
        { property: 'background', value: 'rgba(31, 35, 40, 0.06)', reason: 'hover overlay' },
      ],
    })
    expect(errors).toEqual([])
  })
})

describe('runCheck', () => {
  it('passes on a compliant repo layout', async () => {
    const root = await trackedFixture({
      appCss: 'body {\n  color: var(--fg);\n  background: var(--bg);\n}\n',
    })
    const result = await runCheck({ root })
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('collects theme and core css errors with exit-code semantics', async () => {
    const root = await trackedFixture({
      themeVars: [REQUIRED.slice(0, 5), REQUIRED, REQUIRED],
      appCss: '.tab {\n  color: #123456;\n}\n',
    })
    const result = await runCheck({ root })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e: string) => e.includes('github-light.css'))).toBe(true)
    expect(result.errors.some((e: string) => e.includes('app.css:2'))).toBe(true)
  })
})
