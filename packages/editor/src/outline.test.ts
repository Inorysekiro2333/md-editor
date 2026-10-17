import { describe, expect, it } from 'vitest'
import { parseOutline } from './outline'

describe('parseOutline', () => {
  it('collects top-level ATX headings with exact offsets', () => {
    // 精确值经真实 remark position 校准（2026-10-17）：
    // '# T1\n\ntext\n\n## Sub\n\n### Deep\n' → T1@0, Sub@12, Deep@20
    expect(parseOutline('# T1\n\ntext\n\n## Sub\n\n### Deep\n')).toEqual([
      { level: 1, text: 'T1', offset: 0, textOffset: 2 },
      { level: 2, text: 'Sub', offset: 12, textOffset: 15 },
      { level: 3, text: 'Deep', offset: 20, textOffset: 24 },
    ])
  })

  it('collects setext headings with textOffset = start offset', () => {
    expect(parseOutline('Title\n=====\n')).toEqual([
      { level: 1, text: 'Title', offset: 0, textOffset: 0 },
    ])
  })

  it('ignores headings inside fenced code blocks', () => {
    const md = '# Real\n\n```\n# not-heading\n```\n'
    expect(parseOutline(md)).toEqual([{ level: 1, text: 'Real', offset: 0, textOffset: 2 }])
  })

  it('ignores headings inside blockquotes and list items', () => {
    const md = '> # quoted\n\n- # in-list\n\n# Top\n'
    expect(parseOutline(md)).toEqual([
      { level: 1, text: 'Top', offset: md.indexOf('# Top'), textOffset: md.indexOf('# Top') + 2 },
    ])
  })

  it('returns empty for empty string', () => {
    expect(parseOutline('')).toEqual([])
  })

  it('returns empty when there are no headings', () => {
    expect(parseOutline('plain text\n\n```js\n# x\n```\n')).toEqual([])
  })

  it('concatenates inline text (code spans and bold) in source order', () => {
    expect(parseOutline('# `code` and **bold** mix\n')).toEqual([
      { level: 1, text: 'code and bold mix', offset: 0, textOffset: 2 },
    ])
  })

  it('does not treat "#tag" without space as heading', () => {
    expect(parseOutline('#T4 nospace\n')).toEqual([])
  })
})
