// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Node as PMNode } from '@milkdown/prose/model'
import {
  cursorToMdOffset,
  type CursorAccuracy,
  mdCursorToPmPos,
  mdOffsetToCursor,
  markdownOffsetToPmPos,
  pmPosToMarkdownOffset,
  pmPosToMdCursor,
} from './cursor-map'
import { createTestEditor } from './testing/create-test-editor'

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
  it('clamps offset beyond node end for a valid path (review follow-up)', () => {
    // '# 标题'：heading>text 为有效 path，offset 99 超出 text end（4）→ clamp 到 4
    expect(cursorToMdOffset('# 标题', { path: [0, 0], offset: 99 })).toBe(4)
    expect(cursorToMdOffset('# 标题', { path: [0], offset: 99 })).toBe(4)
  })
})

function textPos(doc: PMNode, text: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === text) {
      found = pos
      return false
    }
    return true
  })
  return found
}

function atomPos(doc: PMNode, typeName: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found === -1 && !node.isText && node.type.name === typeName) {
      found = pos
      return false
    }
    return true
  })
  return found
}

describe('cursor-map PM bridge', () => {
  const planMd = '# 标题\n\n正文**加粗**继续\n\n```ts\nconst a = 1\n```\n'
  const inlineMd = '前`code`中[链接](https://x.y)后\n\n![图](https://x.y/a.png)尾\n\na  \nb\n'
  const tableMd = '| h1 | h2 |\n| --- | --- |\n| 1 | 2 |\n'
  const scanFixtures = [
    planMd,
    '- a\n  - b\n',
    '> 引用\n> - b\n',
    tableMd,
    inlineMd,
    '~~删除~~与后续\n',
    '<div>块</div>\n\n段<b>行内</b>尾\n',
    '',
  ]

  async function withDoc(md: string, fn: (doc: PMNode) => void): Promise<void> {
    const te = await createTestEditor(md)
    try {
      fn(te.getView().state.doc)
    } finally {
      await te.destroy()
    }
  }

  it('exports CursorAccuracy type values', () => {
    const accuracy: CursorAccuracy = 'ancestor'
    expect(['exact', 'ancestor']).toContain(accuracy)
  })

  it('maps positions inside heading/bold/fence text exactly', async () => {
    await withDoc(planMd, (doc) => {
      expect(pmPosToMarkdownOffset(planMd, doc, textPos(doc, '标题'))).toBe(planMd.indexOf('标题'))
      const boldPos = textPos(doc, '加粗')
      expect(pmPosToMarkdownOffset(planMd, doc, boldPos)).toBe(planMd.indexOf('加'))
      expect(pmPosToMarkdownOffset(planMd, doc, boldPos + 1)).toBe(planMd.indexOf('加') + 1)
      expect(markdownOffsetToPmPos(planMd, doc, planMd.indexOf('加'))).toEqual({
        pos: boldPos,
        accuracy: 'exact',
      })
      expect(pmPosToMarkdownOffset(planMd, doc, textPos(doc, 'const a = 1'))).toBe(
        planMd.indexOf('const a = 1'),
      )
    })
  })

  it('maps inline code, link, image and hardbreak', async () => {
    await withDoc(inlineMd, (doc) => {
      expect(pmPosToMarkdownOffset(inlineMd, doc, textPos(doc, 'code'))).toBe(
        inlineMd.indexOf('code'),
      )
      const linkPos = textPos(doc, '链接')
      expect(pmPosToMarkdownOffset(inlineMd, doc, linkPos)).toBe(inlineMd.indexOf('链接'))
      expect(markdownOffsetToPmPos(inlineMd, doc, inlineMd.indexOf('链接'))).toEqual({
        pos: linkPos,
        accuracy: 'exact',
      })
      const imgPos = atomPos(doc, 'image')
      expect(pmPosToMarkdownOffset(inlineMd, doc, imgPos)).toBe(inlineMd.indexOf('![图'))
      const hbPos = atomPos(doc, 'hardbreak')
      // break 起点 = 'a' 之后的 '  \n'（offset 55）；'b' 起点 = 58
      expect(pmPosToMarkdownOffset(inlineMd, doc, hbPos)).toBe(55)
      expect(markdownOffsetToPmPos(inlineMd, doc, 58)).toEqual({
        pos: hbPos + 1,
        accuracy: 'exact',
      })
    })
  })

  it('atomic node boundaries stay anchored to matching-kind leaves (Task 8 guard)', async () => {
    // kind 守卫为防御性（当前 schema 下原子节点只对应 image/break/html/other 叶子），
    // 本用例登记原子边界语义：image/hardbreak 前后边界锚到叶子 range。
    await withDoc(inlineMd, (doc) => {
      const imgPos = atomPos(doc, 'image')
      expect(pmPosToMarkdownOffset(inlineMd, doc, imgPos)).toBe(inlineMd.indexOf('![图'))
      expect(pmPosToMarkdownOffset(inlineMd, doc, imgPos + 1)).toBe(inlineMd.indexOf('尾'))
      const hbPos = atomPos(doc, 'hardbreak')
      expect(pmPosToMarkdownOffset(inlineMd, doc, hbPos)).toBe(55)
    })
  })

  it('prefers the exact anchor when anchors collide at the document end', async () => {
    // 去重优先 exact（Task 8 清理波 ②）：无尾换行文档末尾同时有
    // 叶子末尾 exact 锚点与 root 末尾非 exact 锚点。
    const md = 'hi'
    await withDoc(md, (doc) => {
      expect(markdownOffsetToPmPos(md, doc, 2)).toEqual({
        pos: doc.content.size - 1,
        accuracy: 'exact',
      })
    })
  })

  it('maps nested list and blockquote', async () => {
    const listMd = '- a\n  - b\n'
    await withDoc(listMd, (doc) => {
      const bPos = textPos(doc, 'b')
      expect(bPos).toBe(8)
      expect(pmPosToMarkdownOffset(listMd, doc, bPos)).toBe(listMd.indexOf('b'))
      expect(markdownOffsetToPmPos(listMd, doc, listMd.indexOf('b'))).toEqual({
        pos: bPos,
        accuracy: 'exact',
      })
    })
    const quoteMd = '> 引用\n> - b\n'
    await withDoc(quoteMd, (doc) => {
      expect(pmPosToMarkdownOffset(quoteMd, doc, textPos(doc, '引用'))).toBe(
        quoteMd.indexOf('引用'),
      )
      expect(pmPosToMarkdownOffset(quoteMd, doc, textPos(doc, 'b'))).toBe(quoteMd.indexOf('b'))
    })
  })

  it('maps table cells', async () => {
    await withDoc(tableMd, (doc) => {
      expect(pmPosToMarkdownOffset(tableMd, doc, textPos(doc, 'h1'))).toBe(tableMd.indexOf('h1'))
      expect(pmPosToMarkdownOffset(tableMd, doc, textPos(doc, '2'))).toBe(tableMd.indexOf('2', 20))
      expect(markdownOffsetToPmPos(tableMd, doc, tableMd.indexOf('2', 20))).toMatchObject({
        accuracy: 'exact',
      })
    })
  })

  it('maps strike-through text (mdast delete)', async () => {
    const md = '~~删除~~与后续\n'
    await withDoc(md, (doc) => {
      expect(pmPosToMarkdownOffset(md, doc, textPos(doc, '删除'))).toBe(md.indexOf('删除'))
    })
  })

  it('handles empty document', async () => {
    await withDoc('', (doc) => {
      for (let pos = 0; pos <= doc.content.size; pos++) {
        expect(pmPosToMarkdownOffset('', doc, pos)).toBe(0)
      }
      expect(markdownOffsetToPmPos('', doc, 0)).toMatchObject({ pos: 0 })
    })
  })

  it('clamps out-of-range pos and offset', async () => {
    await withDoc(planMd, (doc) => {
      expect(pmPosToMarkdownOffset(planMd, doc, -5)).toBe(0)
      expect(pmPosToMarkdownOffset(planMd, doc, 10 ** 6)).toBe(planMd.length)
      expect(markdownOffsetToPmPos(planMd, doc, -5)).toEqual({ pos: 0, accuracy: 'ancestor' })
      expect(markdownOffsetToPmPos(planMd, doc, 10 ** 6)).toEqual({
        pos: doc.content.size,
        accuracy: 'ancestor',
      })
    })
  })

  it('maps invalid cursor path to ancestor block start', async () => {
    const md = '# 标题\n\n正文\n'
    await withDoc(md, (doc) => {
      expect(mdCursorToPmPos(md, doc, { path: [9], offset: 3 })).toEqual({
        pos: 0,
        accuracy: 'ancestor',
      })
      expect(mdCursorToPmPos(md, doc, { path: [0, 5], offset: 1 })).toEqual({
        pos: 0,
        accuracy: 'ancestor',
      })
    })
    const listMd = '- a\n  - b\n'
    await withDoc(listMd, (doc) => {
      // 深层 path 失效 → 最近祖先 'b' 段落块首（PM pos 8）
      expect(mdCursorToPmPos(listMd, doc, { path: [0, 0, 1, 0, 0, 5], offset: 2 })).toMatchObject({
        pos: 8,
      })
    })
  })

  it('composes pmPosToMdCursor / mdCursorToPmPos', async () => {
    await withDoc(planMd, (doc) => {
      const boldPos = textPos(doc, '加粗')
      const cursor = pmPosToMdCursor(planMd, doc, boldPos)
      expect(cursorToMdOffset(planMd, cursor)).toBe(planMd.indexOf('加'))
      expect(mdCursorToPmPos(planMd, doc, cursor)).toEqual({ pos: boldPos, accuracy: 'exact' })
      expect(cursorToMdOffset(planMd, pmPosToMdCursor(planMd, doc, 0))).toBe(0)
    })
  })

  it('round-trips every PM pos through md cursor for all fixtures', async () => {
    for (const md of scanFixtures) {
      await withDoc(md, (doc) => {
        for (let pos = 0; pos <= doc.content.size; pos++) {
          const cursor = pmPosToMdCursor(md, doc, pos)
          const back = mdCursorToPmPos(md, doc, cursor)
          const off = pmPosToMarkdownOffset(md, doc, pos)
          const sameOrSameBoundary =
            back.pos === pos || pmPosToMarkdownOffset(md, doc, back.pos) === off
          expect(sameOrSameBoundary, 'pos ' + pos + ' of ' + JSON.stringify(md)).toBe(true)
        }
      })
    }
  })

  it('scans every markdown offset for all fixtures', async () => {
    for (const md of scanFixtures) {
      await withDoc(md, (doc) => {
        for (let off = 0; off <= md.length; off++) {
          const pr = markdownOffsetToPmPos(md, doc, off)
          expect(pr.pos).toBeGreaterThanOrEqual(0)
          expect(pr.pos).toBeLessThanOrEqual(doc.content.size)
          // 与 cursor 组合入口一致
          expect(pr.pos).toBe(mdCursorToPmPos(md, doc, mdOffsetToCursor(md, off)).pos)
          if (pr.accuracy === 'exact') {
            expect(
              pmPosToMarkdownOffset(md, doc, pr.pos),
              'offset ' + off + ' of ' + JSON.stringify(md),
            ).toBe(off)
          }
        }
      })
    }
  })
})
