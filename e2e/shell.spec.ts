import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface MdEditorApi {
  getAppInfo(): Promise<{ version: string; electron: string }>
}

test('opens a window with the preload bridge and no node access', async () => {
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
  const window = await app.firstWindow()

  await expect(window).toHaveTitle('md-editor')

  const bridgeType = await window.evaluate(
    () => typeof (window as unknown as { mdEditor?: unknown }).mdEditor,
  )
  expect(bridgeType).toBe('object')

  const nodeLeak = await window.evaluate(
    () => typeof (window as unknown as { require?: unknown }).require,
  )
  expect(nodeLeak).toBe('undefined')

  const appInfo = await window.evaluate(() =>
    (window as unknown as { mdEditor: MdEditorApi }).mdEditor.getAppInfo(),
  )
  expect(appInfo.electron).toBe('44.7.2')

  await expect(window.locator('[data-testid="app-info"]')).toContainText('Electron')

  await app.close()
})
