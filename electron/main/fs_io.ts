import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'
import { isAssetExt, type AssetExt } from '../shared/asset'

export interface FileContent {
  base64: string
  text: string
  eol: 'lf' | 'crlf'
  hasBom: boolean
}

export interface WriteCredential {
  path: string
  size: number
  mtimeMs: number
  writtenAtMs: number
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf])

export function tmpPathFor(path: string): string {
  return `${path}.tmp`
}

export async function readFile(path: string): Promise<FileContent> {
  const raw = await fs.readFile(path)
  const hasBom = raw.length >= 3 && raw.subarray(0, 3).equals(BOM)
  const body = hasBom ? raw.subarray(3) : raw

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    throw new Error(`文件不是有效的 UTF-8，无法打开：${path}`)
  }

  return {
    base64: raw.toString('base64'),
    text,
    eol: text.includes('\r\n') ? 'crlf' : 'lf',
    hasBom,
  }
}

async function syncParentDirectory(target: string): Promise<void> {
  // Windows 不允许以文件句柄方式打开目录，该平台跳过父目录 fsync。
  if (process.platform === 'win32') return
  const handle = await fs.open(dirname(target), 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function writeAtomic(path: string, bytes: Buffer): Promise<WriteCredential> {
  const tmpPath = tmpPathFor(path)

  const handle = await fs.open(tmpPath, 'w')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await fs.rename(tmpPath, path)
  } catch (error) {
    await fs.rm(tmpPath, { force: true })
    throw error
  }

  await syncParentDirectory(path)

  const info = await fs.stat(path)
  return {
    path,
    size: info.size,
    mtimeMs: info.mtimeMs,
    writtenAtMs: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// asset:save —— 粘贴图片存盘
// ---------------------------------------------------------------------------

export { ASSET_EXT_WHITELIST, isAssetExt } from '../shared/asset'
export type { AssetExt } from '../shared/asset'

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

export function assetFileName(now: Date, randHex: string, ext: AssetExt): string {
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}` +
    `-${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`
  return `${stamp}-${randHex}.${ext}`
}

/** 把粘贴的图片写入 <docDir>/assets/，返回 assets/xxx.ext 相对路径。 */
export async function saveAssetFile(docPath: string, bytes: Buffer, ext: string): Promise<string> {
  if (!isAssetExt(ext)) {
    throw new Error('不支持的图片格式')
  }
  if (typeof docPath !== 'string' || docPath.length === 0 || !isAbsolute(docPath)) {
    throw new Error('无法保存图片：文档路径无效，请先保存文档')
  }
  let stat
  try {
    stat = await fs.stat(docPath)
  } catch {
    throw new Error('无法保存图片：文档路径无效，请先保存文档')
  }
  if (!stat.isFile()) {
    throw new Error('无法保存图片：文档路径无效，请先保存文档')
  }
  const dir = join(dirname(docPath), 'assets')
  await fs.mkdir(dir, { recursive: true })
  const name = assetFileName(new Date(), randomBytes(4).toString('hex'), ext)
  await writeAtomic(join(dir, name), bytes)
  return `assets/${name}`
}
