/**
 * IPC 载荷 base64 守卫：doc:write / asset:save 的二进制载荷必须是
 * 合法 base64 且不超过通道大小上限。非法载荷在主进程入口干净拒绝，
 * 不触碰磁盘（也不产生 .tmp）。
 */
export const DOC_WRITE_MAX_BYTES = 10 * 1024 * 1024
export const ASSET_SAVE_MAX_BYTES = 20 * 1024 * 1024

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

/** 计算合法 base64 字符串解码后的字节数。 */
export function base64DecodedLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

/**
 * 校验 IPC base64 载荷：必须是 string、字符集/填充合法、
 * 解码字节数不超过 maxBytes。
 */
export function isValidBase64Payload(value: unknown, maxBytes: number): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length % 4 !== 0) return false
  if (!BASE64_RE.test(value)) return false
  // 全填充串（如 '===='）或填充错位：解码为空/非法，干净拒绝（Task 8 清理波）。
  if (value.startsWith('=')) return false
  return base64DecodedLength(value) <= maxBytes
}
