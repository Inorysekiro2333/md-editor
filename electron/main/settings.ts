import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { mergeSettings, type AppSettings } from '../shared/settings'

/** 读不到 / JSON 解析失败 → 默认值，不抛错（与 session 语义一致）。 */
export function loadSettings(filePath: string): AppSettings {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return mergeSettings(null)
  }
  try {
    return mergeSettings(JSON.parse(raw))
  } catch {
    return mergeSettings(null)
  }
}

/** 同步原子写：tmp → rename，避免留下半截 settings.json。 */
export function saveSettings(settings: AppSettings, filePath: string): void {
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  try {
    renameSync(tmpPath, filePath)
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true })
    } catch {
      // tmp 清理失败不掩盖原始写入错误
    }
    throw error
  }
}
