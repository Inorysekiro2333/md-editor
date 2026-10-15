import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('prints the rendered document to a silent pdf', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-editor-pdf-'))
  const file = join(dir, 'sample.md')
  const pdf = join(dir, 'out.pdf')
  writeFileSync(file, '# PDF smoke\n\ncontent\n')

  const app = await electron.launch({
    args: [resolve(process.cwd()), '--open', file],
    env: { ...process.env, MD_EDITOR_USER_DATA: mkdtempSync(join(tmpdir(), 'md-editor-e2e-')) },
  })
  const window = await app.firstWindow()
  await expect(window.locator('.ProseMirror')).toContainText('PDF smoke')

  const data = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.printToPDF({ printBackground: true }),
  )
  writeFileSync(pdf, data)

  const bytes = readFileSync(pdf)
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF')
  expect(bytes.length).toBeGreaterThan(1000)

  await app.close()
})
