import { describe, expect, it } from 'vitest'
import { ASSET_SAVE_MAX_BYTES, DOC_WRITE_MAX_BYTES, isValidBase64Payload } from './base64'

const doc10MB = Buffer.alloc(DOC_WRITE_MAX_BYTES, 0x61).toString('base64')
const assetOver = Buffer.alloc(ASSET_SAVE_MAX_BYTES + 1, 0x61).toString('base64')

describe('isValidBase64Payload', () => {
  it('accepts valid payloads within the channel limit', () => {
    expect(isValidBase64Payload(Buffer.from('hello').toString('base64'), DOC_WRITE_MAX_BYTES)).toBe(
      true,
    )
    expect(isValidBase64Payload(doc10MB, DOC_WRITE_MAX_BYTES)).toBe(true)
    expect(isValidBase64Payload(doc10MB, ASSET_SAVE_MAX_BYTES)).toBe(true)
  })

  it('rejects non-string and malformed base64', () => {
    expect(isValidBase64Payload(undefined, DOC_WRITE_MAX_BYTES)).toBe(false)
    expect(isValidBase64Payload(123, DOC_WRITE_MAX_BYTES)).toBe(false)
    expect(isValidBase64Payload(null, DOC_WRITE_MAX_BYTES)).toBe(false)
    expect(isValidBase64Payload('', DOC_WRITE_MAX_BYTES)).toBe(false)
    expect(isValidBase64Payload('aGVsbG8', DOC_WRITE_MAX_BYTES)).toBe(false) // 长度非 4 倍数
    expect(isValidBase64Payload('aGVs!g==', DOC_WRITE_MAX_BYTES)).toBe(false) // 非法字符
    expect(isValidBase64Payload('aGVsbG8===', DOC_WRITE_MAX_BYTES)).toBe(false) // 填充非法
  })

  it('rejects payloads over the channel limit', () => {
    expect(isValidBase64Payload(doc10MB + 'YQ==', DOC_WRITE_MAX_BYTES)).toBe(false)
    expect(isValidBase64Payload(assetOver, ASSET_SAVE_MAX_BYTES)).toBe(false)
    // 全填充空串必须拒绝（清理波：原来只校验字符集，'====' 会漏过）
    expect(isValidBase64Payload('====', DOC_WRITE_MAX_BYTES)).toBe(false)
  })
})
