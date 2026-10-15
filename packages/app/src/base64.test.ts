import { describe, expect, it } from 'vitest'
import { decodeUtf8Base64, encodeUtf8Base64 } from './base64'

describe('base64 helpers', () => {
  it('round-trips ascii, CJK and emoji', () => {
    const text = '中文标题 🎉\n\n第二段\n'
    expect(decodeUtf8Base64(encodeUtf8Base64(text))).toBe(text)
  })

  it('round-trips crlf and empty input', () => {
    expect(decodeUtf8Base64(encodeUtf8Base64('a\r\nb\r\n'))).toBe('a\r\nb\r\n')
    expect(decodeUtf8Base64(encodeUtf8Base64(''))).toBe('')
  })
})
