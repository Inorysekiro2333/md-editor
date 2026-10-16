import { _electron as electron, expect, test, type CDPSession, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// 中文 IME 专项验证（自动化模拟，非真人微软拼音实测）。
// 通过 CDP Input.imeSetComposition 走 Chromium 真实 IME 合成路径：
// compositionstart → compositionupdate（连打）→ 文本提交（commit）。
// 与真人输入法的保真度边界见 development.md 6 节 R2 记录。

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
}

async function openDoc(initial: string) {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-ime-'))
  const file = join(dir, 'sample.md')
  writeFileSync(file, initial)
  const app = await launchApp(file)
  const window = await app.firstWindow()
  const editor = window.locator('.ProseMirror')
  await expect(editor).toBeVisible()
  const session = await window.context().newCDPSession(window)
  return { app, window, editor, session, file }
}

// 连打：一组 compositionupdate 快速连续推进，最后提交最终文本。
async function imeCommit(session: CDPSession, updates: string[], final: string) {
  for (const text of updates) {
    await session.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    })
  }
  await session.send('Input.insertText', { text: final })
}

async function commitIn(
  window: Page,
  editor: ReturnType<Page['locator']>,
  updates: string[],
  final: string,
) {
  await editor.click()
  await window.keyboard.press('Control+End')
  const session = await window.context().newCDPSession(window)
  await imeCommit(session, updates, final)
  return session
}

test('heading: pinyin burst + commit + undo inside heading', async () => {
  const { app, window, editor, file } = await openDoc('# 已有标题\n')
  await commitIn(window, editor, ['pinyin', '拼音', '拼音ce'], '拼音测试')
  await expect(editor.locator('h1')).toContainText('已有标题拼音测试')

  await window.waitForTimeout(500)
  await window.keyboard.press('Control+s')
  await expect(window.locator('[data-testid="status"]')).toContainText('已保存')
  expect(readFileSync(file, 'utf8')).toBe('# 已有标题拼音测试\n')

  await window.keyboard.press('Control+z')
  await expect(editor.locator('h1')).toContainText('已有标题')
  await expect(editor.locator('h1')).not.toContainText('拼音测试')
  await app.close()
})

test('list item: pinyin burst + commit + undo keeps list structure', async () => {
  const { app, window, editor, file } = await openDoc('- 项目\n')
  await commitIn(window, editor, ['liuyan', '留言nei', '留言内容'], '留言内容')
  await expect(editor.locator('li')).toContainText('项目留言内容')

  await window.waitForTimeout(500)
  await window.keyboard.press('Control+s')
  await expect(window.locator('[data-testid="status"]')).toContainText('已保存')
  // Registered normalization (R1): bullet "-" 序列化统一为 "*"
  expect(readFileSync(file, 'utf8')).toBe('* 项目留言内容\n')

  await window.keyboard.press('Control+z')
  await expect(editor.locator('li')).toContainText('项目')
  await expect(editor.locator('li')).not.toContainText('留言内容')
  await app.close()
})

test('table cell: pinyin burst + commit inside cell', async () => {
  const { app, window, editor } = await openDoc('| 名字 | 值 |\n| --- | --- |\n')
  const cell = editor.locator('th').first()
  await cell.click()
  const session = await window.context().newCDPSession(window)
  await imeCommit(session, ['mingzi', '名字jia', '名字价值'], '名字价值')
  await expect(cell).toContainText('名字价值')
  await app.close()
})

test('code block: pinyin burst + commit stays inside fence', async () => {
  const { app, window, editor } = await openDoc('```ts\nconst a=1\n```\n')
  // NodeView（CM6）在 SchemaReady 后才挂载；慢环境（xvfb）下必须在点击/输入前
  // 等 .cm-content 存在且真正拿到焦点，否则 CDP 组合事件落到未聚焦的 CM DOM
  // 被吞（Windows 本地快、Linux CI 间歇性触发的竞态）。
  const cmContent = editor.locator('.md-codeblock .cm-content')
  await expect(cmContent).toBeVisible()
  await cmContent.click()
  await expect(cmContent).toBeFocused()
  await window.keyboard.press('Control+End')
  await imeCommit(
    await window.context().newCDPSession(window),
    ['bianma', '编码zhu', '编码注释'],
    '编码注释',
  )
  // M2 起代码块由 CM6 NodeView 渲染（.md-codeblock），不再是原生 <pre>。
  await expect(editor.locator('.md-codeblock .cm-content')).toContainText('const a=1')
  await expect(editor.locator('.md-codeblock .cm-content')).toContainText('编码注释')
  await expect(editor.locator('p')).toHaveCount(0)
  await app.close()
})

// 撤销到指定干净状态：文本精确匹配且无标题/列表结构残留
async function undoUntil(window: Page, editor: ReturnType<Page['locator']>, expected: string) {
  const clean = async () => {
    const text = ((await editor.textContent()) ?? '').replace(/\s+/g, '')
    const structural = await editor.locator('ul, ol, h1').count()
    return text === expected && structural === 0
  }
  for (let i = 0; i < 20; i += 1) {
    if (await clean()) return
    await window.keyboard.press('Control+z')
  }
  throw new Error(`undo did not reach expected state: ${expected}`)
}

// 等待编辑器空闲：文本连续两拍（间隔 50ms）无变化，确保上一步（IME commit / undo）完全落定，
// 避免 Linux 上 CDP composition 拆除延迟吞掉后续普通键入
async function waitEditorIdle(window: Page, editor: ReturnType<Page['locator']>) {
  let prev: string | null = null
  for (let i = 0; i < 20; i += 1) {
    const text = ((await editor.textContent()) ?? '').replace(/\s+/g, '')
    if (text === prev) return
    prev = text
    await window.waitForTimeout(50)
  }
}

// 点击段落任意位置后按 Home，把光标确定地放到块首（输入规则只在块首触发）。
// 不依赖固定像素偏移，避免 Linux 字体度量差异导致点击落点偏移。
async function clickParagraphStart(window: Page, editor: ReturnType<Page['locator']>) {
  await editor.locator('p').first().click()
  await window.keyboard.press('Home')
  await waitEditorIdle(window, editor)
}

test('composition containing "#" does not trigger heading rule', async () => {
  const { app, window, editor } = await openDoc('正文\n')

  // 反向对照：同样文本非组合普通键入必须触发标题规则
  await clickParagraphStart(window, editor)
  await window.keyboard.type('# 标题文字')
  await expect(editor.locator('h1')).toContainText('标题文字')
  await undoUntil(window, editor, '正文')

  // 组合路径：块首组合，中间态包含规则触发序列 "# "
  const session = await window.context().newCDPSession(window)
  await imeCommit(session, ['#', '# ', '# 标题', '# 标题文字'], '# 标题文字')
  await expect(editor.locator('p').first()).toContainText('# 标题文字')
  expect(await editor.locator('h1').count()).toBe(0)

  await undoUntil(window, editor, '正文')
  await app.close()
})

test('composition containing "-" and "1." does not trigger list rules', async () => {
  const { app, window, editor } = await openDoc('第一段\n\n第二段\n')
  const session = await window.context().newCDPSession(window)

  // 反向对照 1：同样文本非组合普通键入必须触发 bullet 规则
  await clickParagraphStart(window, editor)
  await window.keyboard.type('- 连字符')
  await expect(editor.locator('li')).toContainText('连字符')
  await undoUntil(window, editor, '第一段第二段')

  // 组合路径 1：块首组合，中间态包含规则触发序列 "- "
  await imeCommit(session, ['-', '- ', '- 连字符'], '- 连字符')
  await expect(editor.locator('p').first()).toContainText('- 连字符')
  expect(await editor.locator('ul').count()).toBe(0)
  await undoUntil(window, editor, '第一段第二段')

  // 反向对照 2：同样文本非组合普通键入必须触发 ordered 规则
  await clickParagraphStart(window, editor)
  await window.keyboard.type('1. 第一')
  await expect(editor.locator('ol')).toContainText('第一')
  await undoUntil(window, editor, '第一段第二段')

  // 组合路径 2：块首组合，中间态包含规则触发序列 "1. "
  await imeCommit(session, ['1.', '1. ', '1. 第一'], '1. 第一')
  await expect(editor.locator('p').first()).toContainText('1. 第一')
  expect(await editor.locator('ol').count()).toBe(0)

  await app.close()
})
