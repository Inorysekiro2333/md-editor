import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('settings panel switches theme and updates data-theme', async () => {
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
  const window = await app.firstWindow()
  await expect(window.locator('[data-testid="app-info"]')).toBeVisible()

  await window.getByTestId('open-settings').click()
  await expect(window.getByTestId('theme-github-light')).toBeVisible()
  expect(await window.locator('html').getAttribute('data-theme')).toBe('github-light')

  await window.getByTestId('theme-github-dark').check()
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'github-dark')

  await window.getByTestId('settings-close').click()
  await expect(window.getByTestId('settings-backdrop')).toHaveCount(0)

  await app.close()
})
