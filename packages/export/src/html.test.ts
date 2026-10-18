import { describe, expect, it } from 'vitest'
import { buildStandaloneHtml } from './html'

const baseOpts = { themeCss: ':root { --md-bg: #ffffff; }', inlineImages: false, title: 'Doc' }

describe('buildStandaloneHtml', () => {
  it('converts headings, fenced code and tables through the remark pipeline', async () => {
    const md = '# Title\n\n```js\nconst a = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'
    const html = await buildStandaloneHtml(md, baseOpts)
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('language-js')
    expect(html).toContain('const a = 1')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
  })

  it('inlines the theme css in a style tag and sets the title', async () => {
    const html = await buildStandaloneHtml('hello', baseOpts)
    expect(html).toContain('<title>Doc</title>')
    expect(html).toMatch(/<style>[\s\S]*--md-bg[\s\S]*<\/style>/)
  })

  it('emits a CSP meta that allows no scripts', async () => {
    const html = await buildStandaloneHtml('<script>alert(1)</script>\n\nbody text', baseOpts)
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).not.toContain('<script')
    expect(html).toContain('body text')
  })

  it('replaces relative-path images with data urls via the injected reader', async () => {
    const md = '![alt](assets/pic.png)\n\n![remote](https://example.com/a.png)'
    const html = await buildStandaloneHtml(md, {
      ...baseOpts,
      inlineImages: true,
      inlineImage: async (src) => (src === 'assets/pic.png' ? 'data:image/png;base64,AAA' : null),
    })
    expect(html).toContain('src="data:image/png;base64,AAA"')
    expect(html).toContain('alt="alt"')
    expect(html).toContain('src="https://example.com/a.png"')
  })

  it('keeps remote and data image urls untouched and skips inlining when disabled', async () => {
    let called = 0
    const md = '![a](https://example.com/a.png)\n\n![b](assets/pic.png)'
    const html = await buildStandaloneHtml(md, {
      ...baseOpts,
      inlineImages: false,
      inlineImage: async () => {
        called += 1
        return null
      },
    })
    expect(called).toBe(0)
    expect(html).toContain('src="https://example.com/a.png"')
    expect(html).toContain('src="assets/pic.png"')
  })

  it('falls back to the original src when the reader returns null', async () => {
    const md = '![missing](assets/gone.png)'
    const html = await buildStandaloneHtml(md, {
      ...baseOpts,
      inlineImages: true,
      inlineImage: async () => null,
    })
    expect(html).toContain('src="assets/gone.png"')
  })
})

describe('buildStandaloneHtml data uri images', () => {
  it('keeps inline data uri images untouched even when inlining is enabled', async () => {
    let called = 0
    const md = '![inline](data:image/png;base64,AAA=)'
    const html = await buildStandaloneHtml(md, {
      ...baseOpts,
      inlineImages: true,
      inlineImage: async () => {
        called += 1
        return 'data:image/png;base64,BBB='
      },
    })
    expect(called).toBe(0)
    expect(html).toContain('src="data:image/png;base64,AAA="')
  })
})
