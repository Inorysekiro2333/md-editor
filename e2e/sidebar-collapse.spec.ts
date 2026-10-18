import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('sidebar collapses and expands via toggle button', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-sidebar-'))
  const file = join(dir, 'sidebar.md')
  writeFileSync(file, '# Sidebar\n\ncontent\n')
  const app = await electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: {
      ...process.env,
      MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-sidebar-')),
    },
  })
  const window = await app.firstWindow()
  const sidebar = window.getByTestId('file-sidebar')
  const toggle = window.getByTestId('sidebar-toggle')
  await expect(sidebar).toBeVisible()
  await toggle.click()
  await expect(sidebar).toHaveClass(/collapsed/)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.click()
  await expect(sidebar).not.toHaveClass(/collapsed/)
  await app.close()
})
