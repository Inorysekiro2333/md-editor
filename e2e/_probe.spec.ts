import { _electron as electron, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('probe toolbar click', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'probe3-'))
  const file = join(dir, 't.md')
  writeFileSync(file, '| a | b |\n| - | - |\n| 1 | 2 |\n')
  const app = await electron.launch({ args: [resolve(process.cwd()), '--open', file], env: { ...process.env, MD_EDITOR_USER_DATA: dir } })
  const window = await app.firstWindow()
  window.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 500)))
  await window.waitForSelector('[data-editor-ready="true"]')
  await window.locator('.ProseMirror td').first().click()
  await window.waitForTimeout(300)
  const info = await window.evaluate(() => {
    const tb = document.querySelector('[data-testid="table-toolbar"]')
    const btn = document.querySelector('[data-testid="table-toolbar-row-below"]')
    const r = btn?.getBoundingClientRect()
    const at = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null
    return { parent: tb?.parentElement?.className, style: tb?.getAttribute('style'), rect: r ? [r.x, r.y, r.width, r.height].map(Math.round) : null, at: at ? at.tagName + '.' + (at.className || '') : null }
  })
  console.log('PROBE', JSON.stringify(info))
  await window.getByTestId('table-toolbar-row-below').click({ timeout: 8000 }).catch((e) => console.log('CLICK-FAIL', String(e).split('\n')[0]))
  await app.close()
})
