import { describe, expect, it } from 'vitest'
import { encodeUtf8Base64 } from '../base64'
import { MdDocument } from './MdDocument'

function createDoc(text: string) {
  return new MdDocument({
    id: 'doc-1',
    path: 'C:/notes/doc.md',
    text,
    originalBytesBase64: encodeUtf8Base64(text),
    eol: 'lf',
    hasBom: false,
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
})
