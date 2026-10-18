import { app, dialog } from 'electron'
import { join } from 'node:path'

export const UNTITLED_NOTE_NAME = '未命名.md'

export const MARKDOWN_SAVE_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown'] }]

/**
 * 另存为对话框：默认落到 userData/<defaultName>，用户取消返回 null。
 * defaultName 只取文件名语义，路径分隔符会被替换，避免把默认目录顶掉。
 */
export interface SaveDialogFilter {
  name: string
  extensions: string[]
}

export const PDF_SAVE_FILTERS: SaveDialogFilter[] = [{ name: 'PDF', extensions: ['pdf'] }]

export async function showSaveDialog(
  defaultName: string,
  filters: SaveDialogFilter[] = MARKDOWN_SAVE_FILTERS,
  title = '另存为',
): Promise<string | null> {
  const safeName =
    typeof defaultName === 'string' && defaultName.trim() !== ''
      ? defaultName.replace(/[\\/]/g, '-')
      : UNTITLED_NOTE_NAME
  const result = await dialog.showSaveDialog({
    title,
    defaultPath: join(app.getPath('userData'), safeName),
    filters,
  })
  if (result.canceled || result.filePath === '') return null
  return result.filePath
}
