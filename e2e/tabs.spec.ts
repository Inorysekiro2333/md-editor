import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CONTENT_A = '# Doc A\n\nfirst\n'
const CONTENT_B = '# Doc B\n\nsecond\n'

function launchApp(file: string, envOverrides: Record<string, string> = {}) {
  return electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: {
      ...process.env,
      MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-tabs-')),
      ...envOverrides,
    },
  })
}

function writeFixtures(): { fileA: string; fileB: string } {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-tabs-fixture-'))
  const fileA = join(dir, 'a.md')
  const fileB = join(dir, 'b.md')
  writeFileSync(fileA, CONTENT_A)
  writeFileSync(fileB, CONTENT_B)
  return { fileA, fileB }
}

async function waitReady(window: import('@playwright/test').Page): Promise<void> {
  await expect(window.locator('[data-editor-ready="true"]')).toHaveCount(1)
}

async function editActiveDoc(window: import('@playwright/test').Page): Promise<void> {
  const editor = window.locator('.ProseMirror')
  await editor.click()
  await window.keyboard.press('Control+End')
  await window.keyboard.type('typed')
  await window.waitForTimeout(600)
}

test('opens a second document into a second active tab', async () => {
  const { fileA, fileB } = writeFixtures()
  const app = await launchApp(fileA)
  const window = await app.firstWindow()
  await waitReady(window)

  await app.evaluate(({ BrowserWindow }, target) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:open-file', target)
  }, fileB)

  const tabs = window.locator('[data-testid="tab"]')
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toHaveAttribute('data-active', 'true')
  await expect(tabs.nth(0)).not.toHaveAttribute('data-active')
  await expect(window.locator('.ProseMirror')).toContainText('Doc B')
  await app.close()
})

test('marks the active tab dirty while typing', async () => {
  const { fileA } = writeFixtures()
  const app = await launchApp(fileA)
  const window = await app.firstWindow()
  await waitReady(window)

  await editActiveDoc(window)

  const tab = window.locator('[data-testid="tab"]').first()
  await expect(tab).toHaveAttribute('data-dirty', 'true')
  await expect(window.locator('[data-testid="status"]')).toContainText('未保存')
  await app.close()
})

test('closing a dirty tab asks for confirmation', async () => {
  const { fileA } = writeFixtures()
  const app = await launchApp(fileA)
  const window = await app.firstWindow()
  await waitReady(window)

  await editActiveDoc(window)
  const tab = window.locator('[data-testid="tab"]').first()
  const closeButton = tab.locator('[data-testid="tab-close"]')

  await closeButton.click()
  const modal = window.locator('[data-testid="modal"]')
  await expect(modal).toBeVisible()
  await window.locator('[data-testid="modal-cancel"]').click()
  await expect(modal).toHaveCount(0)
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(1)
  await expect(tab).toHaveAttribute('data-dirty', 'true')

  await closeButton.click()
  await expect(modal).toBeVisible()
  await window.locator('[data-testid="modal-confirm"]').click()
  await expect(window.locator('[data-testid="tab"]')).toHaveCount(0)
  await app.close()
})

test('window close guard asks before discarding dirty docs', async () => {
  test.setTimeout(60_000)
  const { fileA } = writeFixtures()
  const app = await launchApp(fileA, { MD_EDITOR_NO_CLOSE_GUARD: '' })
  const window = await app.firstWindow()
  await waitReady(window)

  await editActiveDoc(window)

  await app.evaluate(({ BrowserWindow }) => {
    void BrowserWindow.getAllWindows()[0]?.close()
  })
  const modal = window.locator('[data-testid="modal"]')
  await expect(modal).toBeVisible()
  await window.locator('[data-testid="modal-cancel"]').click()
  await expect(modal).toHaveCount(0)
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false),
    )
    .toBe(true)

  await app.evaluate(({ BrowserWindow }) => {
    void BrowserWindow.getAllWindows()[0]?.close()
  })
  await expect(modal).toBeVisible()
  const confirmClick = window
    .locator('[data-testid="modal-confirm"]')
    .click()
    .catch(() => undefined)

  const proc = app.process()
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('app did not exit')), 20_000)
    proc.once('exit', () => {
      clearTimeout(timer)
      resolvePromise()
    })
  })
  await confirmClick
})
