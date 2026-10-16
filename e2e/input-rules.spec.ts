import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function launchApp(file: string) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
}

async function typeAndSave(content: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-doc-'))
  const file = join(dir, 'sample.md')
  writeFileSync(file, '')
  const app = await launchApp(file)
  const window = await app.firstWindow()
  const editor = window.locator('.ProseMirror')
  await editor.click()
  await window.keyboard.type(content)
  await window.waitForTimeout(500)
  await window.keyboard.press('Control+s')
  await expect(window.locator('[data-testid="status"]')).toContainText('已保存')
  const saved = readFileSync(file, 'utf8')
  await app.close()
  return saved
}

test('heading rule', async () => {
  const saved = await typeAndSave('# 标题\r内容')
  expect(saved).toBe('# 标题\n\n内容\n')
})

test('blockquote rule', async () => {
  const saved = await typeAndSave('> 引用')
  expect(saved).toBe('> 引用\n')
})

test('bullet rule', async () => {
  const saved = await typeAndSave('- 项目')
  // Registered normalization: Milkdown 序列化统一使用 "*" 作为 bullet 标记，"-" 输入被规范化为 "*"
  expect(saved).toBe('* 项目\n')
})

test('ordered rule', async () => {
  const saved = await typeAndSave('1. 第一')
  expect(saved).toBe('1. 第一\n')
})

test('fence rule', async () => {
  const saved = await typeAndSave('```ts\rconst a=1')
  expect(saved).toBe('```ts\nconst a=1\n```\n')
})

test('table pipe rule', async () => {
  const saved = await typeAndSave('| a | b |\r')
  // Registered normalization: 表格序列化对单元格做等宽补齐（| a  | b  |），分隔行统一为 "| :- | :- |"
  expect(saved).toBe('| a  | b  |\n| :- | :- |\n')
})

test('table pipe with escaped cell', async () => {
  const saved = await typeAndSave('| a\\|b | c |\r')
  // Registered normalization: 单元格内转义竖线被解析为字面 "|"，序列化时重新转义为 "\|"；单元格按序列化宽度做等宽补齐（"c" 后多一个空格，分隔行 " :--- "）
  expect(saved).toBe('| a\\|b | c  |\n| :--- | :- |\n')
})
test('tasklist rule', async () => {
  const saved = await typeAndSave('- [ ] 待办')
  // Registered normalization: tasklist 属 bullet list，序列化统一使用 "*" 标记
  expect(saved).toBe('* [ ] 待办\n')
})

test('escape keeps literal text', async () => {
  const saved = await typeAndSave('1\\. 不是列表')
  // Registered normalization: 文本中的字面反斜杠序列化时转义为 "\\"，round-trip 语义不变，且未被解析为列表
  expect(saved).toBe('1\\\\. 不是列表\n')
})
