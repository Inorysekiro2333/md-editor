import { describe, expect, it } from 'vitest'
import { decodeUtf8Base64, encodeUtf8Base64 } from '../base64'
import { MdDocument } from './MdDocument'

type MdDocumentOverrides = { eol?: 'lf' | 'crlf'; hasBom?: boolean }

function createDoc(text: string, overrides: MdDocumentOverrides = {}) {
  return new MdDocument({
    id: 'doc-1',
    path: 'C:/notes/doc.md',
    text,
    originalBytesBase64: encodeUtf8Base64(text),
    eol: 'lf',
    hasBom: false,
    ...overrides,
  })
}

describe('MdDocument', () => {
  it('starts clean and exposes the buffer text', () => {
    const doc = createDoc('# hello\n')
    expect(doc.isDirty).toBe(false)
    expect(doc.text).toBe('# hello\n')
  })

  it('returns null from bytesForSave while untouched (零编辑不写盘)', () => {
    expect(createDoc('# hello\n').bytesForSave()).toBeNull()
  })

  it('becomes dirty when the editor converges back into the buffer', () => {
    const doc = createDoc('# hello\n')
    doc.applyEditorMarkdown('# hello world\n')
    expect(doc.isDirty).toBe(true)
    expect(doc.text).toBe('# hello world\n')
    expect(doc.bytesForSave()).toBe(encodeUtf8Base64('# hello world\n'))
  })

  it('stays clean when the editor reports identical markdown', () => {
    const doc = createDoc('# hello\n')
    doc.applyEditorMarkdown('# hello\n')
    expect(doc.isDirty).toBe(false)
  })

  it('supports range replacement for find-replace semantics', () => {
    const doc = createDoc('abc def\n')
    doc.replaceText({ from: 0, to: 3 }, 'xyz')
    expect(doc.text).toBe('xyz def\n')
    expect(doc.isDirty).toBe(true)
  })

  it('clears dirty state after a successful save', () => {
    const doc = createDoc('a\n')
    doc.applyEditorMarkdown('b\n')
    doc.markSaved()
    expect(doc.isDirty).toBe(false)
    expect(doc.bytesForSave()).toBeNull()
  })

  it('adopts external content and resets dirty state', () => {
    const doc = createDoc('old\n')
    doc.applyEditorMarkdown('mine\n')
    doc.setExternalText('external\n', encodeUtf8Base64('external\n'))
    expect(doc.text).toBe('external\n')
    expect(doc.isDirty).toBe(false)
    expect(doc.bytesForSave()).toBeNull()
  })

  it('converts LF to CRLF on save for a CRLF document (§3.3)', () => {
    const doc = createDoc('a\nb\n', { eol: 'crlf' })
    doc.applyEditorMarkdown('c\nd\n')
    expect(decodeUtf8Base64(doc.bytesForSave()!)).toBe('c\r\nd\r\n')
  })

  it('keeps already-CRLF lines unchanged when converting for a CRLF document', () => {
    const doc = createDoc('a\r\nb\n', { eol: 'crlf' })
    doc.replaceText({ from: 0, to: 1 }, 'x')
    expect(doc.text).toBe('x\r\nb\n')
    expect(decodeUtf8Base64(doc.bytesForSave()!)).toBe('x\r\nb\r\n')
  })

  it('does not rewrite existing CRLF bytes for an LF document', () => {
    const doc = createDoc('a\r\nb\n', { eol: 'lf' })
    doc.applyEditorMarkdown('c\r\nb\n')
    expect(decodeUtf8Base64(doc.bytesForSave()!)).toBe('c\r\nb\n')
  })

  it('prepends a BOM on save for a BOM document (§3.3)', () => {
    const doc = createDoc('# hello\n', { hasBom: true })
    doc.applyEditorMarkdown('# hello world\n')
    // 注意：TextDecoder 默认会剥离 BOM，所以这里直接对字节编码做相等断言。
    expect(doc.bytesForSave()).toBe(encodeUtf8Base64('\uFEFF# hello world\n'))
  })
})
