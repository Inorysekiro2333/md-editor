import { describe, expect, it } from 'vitest'
import { cursorToMdOffset, mdOffsetToCursor } from './cursor-map'

describe('mdOffsetToCursor', () => {
  it('maps offset inside a heading text to {path, offset}', () => {
    // '## 你好\n\n正文' → '好' 的 offset = 4；最深节点是 heading 的 text child（start=3）
    expect(mdOffsetToCursor('## 你好\n\n正文', 4)).toEqual({ path: [0, 0], offset: 1 })
  })
  it('resolves deepest node for nested list', () => {
    const md = '- a\n  - b\n'
    // 'b' 在 mdast list>listItem(0)>list>listItem(0)>paragraph>text（嵌套 list 是首个 listItem 的 child），offset 相对 text 起点
    const cursor = mdOffsetToCursor(md, md.indexOf('b'))
    expect(cursor).toEqual({ path: [0, 0, 1, 0, 0, 0], offset: 0 })
  })
  it('returns {path: [], offset: 0} for empty doc', () => {
    expect(mdOffsetToCursor('', 0)).toEqual({ path: [], offset: 0 })
  })
  it('resolves deepest node for nested blockquote', () => {
    const md = '> 引用\n> - b\n'
    const cursor = mdOffsetToCursor(md, md.indexOf('b'))
    expect(cursor).toEqual({ path: [0, 1, 0, 0, 0], offset: 0 })
  })
  it('assigns offset == child.end to that child', () => {
    // '# 标题'：text [2,4)，offset 4 == text.end 也 == heading.end → 归入 text
    expect(mdOffsetToCursor('# 标题', 4)).toEqual({ path: [0, 0], offset: 2 })
  })
})

describe('cursorToMdOffset', () => {
  it('round-trips with mdOffsetToCursor', () => {
    const md = '# 标题\n\n段落**加粗**文字\n'
    for (let offset = 0; offset < md.length; offset++) {
      const cursor = mdOffsetToCursor(md, offset)
      expect(cursorToMdOffset(md, cursor)).toBe(offset)
    }
  })
  it('round-trips for CRLF documents at every offset', () => {
    const md = '第一段\r\n\r\n第二段\r\n'
    for (let offset = 0; offset < md.length; offset++) {
      const cursor = mdOffsetToCursor(md, offset)
      expect(cursorToMdOffset(md, cursor)).toBe(offset)
    }
  })
  it('round-trips for nested list and blockquote documents', () => {
    for (const md of ['- a\n  - b\n', '> 引用\n> - b\n']) {
      for (let offset = 0; offset < md.length; offset++) {
        const cursor = mdOffsetToCursor(md, offset)
        expect(cursorToMdOffset(md, cursor)).toBe(offset)
      }
    }
  })
  it('degrades to nearest ancestor block start when path is invalid', () => {
    const md = '# 标题\n\n正文\n'
    // path [9] 越界 → 最近祖先（document 无块首语义 → 顶层第 0 块块首= 0）
    expect(cursorToMdOffset(md, { path: [9], offset: 3 })).toBe(0)
    // path [0, 5] 越界（heading 只有 text child）→ 最近祖先 heading 块首 = 0
    expect(cursorToMdOffset(md, { path: [0, 5], offset: 1 })).toBe(0)
  })
  it('degrades to nearest resolvable ancestor for deep paths and empty docs', () => {
    const md = '- a\n  - b\n'
    // path [0,0,1,0,0,5] 越界（paragraph 只有 text child）→ 最近祖先 paragraph 块首 = 8
    expect(cursorToMdOffset(md, { path: [0, 0, 1, 0, 0, 5], offset: 2 })).toBe(8)
    expect(cursorToMdOffset('', { path: [0], offset: 1 })).toBe(0)
  })
})
