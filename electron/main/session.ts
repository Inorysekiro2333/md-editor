import { readFile } from 'node:fs/promises'
import { writeAtomic } from './fs_io'

export interface SessionTabSnapshot {
  path: string
  dirty: boolean
  text: string
}

export interface SessionSnapshot {
  version: number
  savedAt: number
  activePath: string | null
  tabs: SessionTabSnapshot[]
}

/** 快照体积守卫：> 5MB 拒绝写入（userData 不应被超大文档撑爆）。 */
export const SESSION_MAX_BYTES = 5 * 1024 * 1024

export async function saveSession(json: string, filePath: string): Promise<void> {
  if (typeof json !== 'string') {
    throw new Error('invalid session payload')
  }
  const bytes = Buffer.from(json, 'utf8')
  if (bytes.byteLength > SESSION_MAX_BYTES) {
    throw new Error('session snapshot exceeds 5MB')
  }
  await writeAtomic(filePath, bytes)
}

/** 读不到 / JSON 解析失败 → null；调用方按「无快照」处理。 */
export async function loadSession(filePath: string): Promise<SessionSnapshot | null> {
  let raw: Buffer
  try {
    raw = await readFile(filePath)
  } catch {
    return null
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as SessionSnapshot
  } catch {
    return null
  }
}
