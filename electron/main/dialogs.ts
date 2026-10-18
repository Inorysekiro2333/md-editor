import { app, dialog } from 'electron'
import { join } from 'node:path'

export const UNTITLED_NOTE_NAME = '未命名.md'

export const MARKDOWN_SAVE_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown'] }]

/**
 * 另存为对话框：默认落到 userData/<defaultName>，用户取消返回 null。
 * defaultName 只取文件名语义，路径分隔符会被替换，避免把默认目录顶掉。
 */
export async function showSaveDialog(defaultName: string): Promise<string | null> {
  const safeName =
    typeof defaultName === 'string' && defaultName.trim() !== ''
      ? defaultName.replace(/[\\/]/g, '-')
      : UNTITLED_NOTE_NAME
  const result = await dialog.showSaveDialog({
    title: '另存为',
    defaultPath: join(app.getPath('userData'), safeName),
    filters: MARKDOWN_SAVE_FILTERS,
  })
  if (result.canceled || result.filePath === '') return null
  return result.filePath
}
