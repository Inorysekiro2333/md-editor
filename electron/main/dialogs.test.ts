import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  getPath: vi.fn(() => join('C:', 'userdata')),
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  dialog: { showSaveDialog: mocks.showSaveDialog },
}))

import { showSaveDialog, UNTITLED_NOTE_NAME } from './dialogs'

describe('showSaveDialog', () => {
  beforeEach(() => {
    mocks.showSaveDialog.mockReset()
    mocks.getPath.mockClear()
  })

  it('uses the markdown filter and defaults to 未命名.md under userData', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: join('C:', 'out.md') })

    const path = await showSaveDialog(UNTITLED_NOTE_NAME)

    expect(path).toBe(join('C:', 'out.md'))
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: join('C:', 'userdata', '未命名.md'),
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      }),
    )
  })

  it('returns null when the user cancels', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    await expect(showSaveDialog('note.md')).resolves.toBeNull()
  })

  it('passes the chosen file path through', async () => {
    const chosen = join('C:', 'docs', 'kept.md')
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: chosen })
    await expect(showSaveDialog('kept.md')).resolves.toBe(chosen)
  })

  it('falls back to 未命名.md for an empty default name', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    await showSaveDialog('')
    expect(mocks.showSaveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: join('C:', 'userdata', '未命名.md') }),
    )
  })

  it('passes pdf filters and dialog title through', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    await showSaveDialog('note.pdf', [{ name: 'PDF', extensions: ['pdf'] }], '导出 PDF')
    expect(mocks.showSaveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: '导出 PDF',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      }),
    )
  })

  it('strips path separators from the default name', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    await showSaveDialog('a/b\\c.md')
    expect(mocks.showSaveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: join('C:', 'userdata', 'a-b-c.md') }),
    )
  })
})
