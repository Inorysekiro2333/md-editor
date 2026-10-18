import { describe, expect, it } from 'vitest'
import { markdownToHtml } from './markdown'

describe('markdownToHtml (Task 7 前的占位管线)', () => {
  it('converts headings and emphasis', async () => {
    const html = await markdownToHtml('# Title\n\nsome **bold** text')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
  })

  it('converts fenced code blocks', async () => {
    const html = await markdownToHtml('```js\nconst a = 1\n```')
    expect(html).toContain('<pre>')
    expect(html).toMatch(/<code[ >]/)
    expect(html).toContain('const a = 1')
  })

  it('converts GFM tables', async () => {
    const html = await markdownToHtml('| a | b |\n| - | - |\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
  })

  it('drops raw html including scripts', async () => {
    const html = await markdownToHtml('<script>alert(1)</script>\n\nplain text')
    expect(html).not.toContain('<script')
    expect(html).toContain('plain text')
  })
})
