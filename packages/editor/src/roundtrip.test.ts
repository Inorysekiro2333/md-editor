// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestEditor } from './testing/create-test-editor'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8')

async function roundtrip(input: string): Promise<string> {
  const editor = await createTestEditor(input)
  try {
    return editor.getMarkdown()
  } finally {
    await editor.destroy()
  }
}

describe('round-trip headings', () => {
  // h1
  it('h1', async () => {
    expect(await roundtrip('# Title\n')).toBe('# Title\n')
  })
  // h2
  it('h2', async () => {
    expect(await roundtrip('## Section\n')).toBe('## Section\n')
  })
  // h3
  it('h3', async () => {
    expect(await roundtrip('### Sub\n')).toBe('### Sub\n')
  })
  // h4
  it('h4', async () => {
    expect(await roundtrip('#### Deep\n')).toBe('#### Deep\n')
  })
  // h5
  it('h5', async () => {
    expect(await roundtrip('##### Deeper\n')).toBe('##### Deeper\n')
  })
  // h6
  it('h6', async () => {
    expect(await roundtrip('###### Deepest\n')).toBe('###### Deepest\n')
  })
  // setext-h1
  // Registered normalization (R1): Setext `===` normalizes to ATX `#`.
  it('setext-h1', async () => {
    expect(await roundtrip('Setext H1\n===\n')).toBe('# Setext H1\n')
  })
  // setext-h2
  // Registered normalization (R1): Setext `---` normalizes to ATX `##`.
  it('setext-h2', async () => {
    expect(await roundtrip('Setext H2\n---\n')).toBe('## Setext H2\n')
  })
  // trailing-hashes
  // Registered normalization (R1): Trailing closing `#` is dropped.
  it('trailing-hashes', async () => {
    expect(await roundtrip('# Title #\n')).toBe('# Title\n')
  })
  // heading-emphasis
  it('heading-emphasis', async () => {
    expect(await roundtrip('# *Em* and **strong**\n')).toBe('# *Em* and **strong**\n')
  })
})

describe('round-trip lists', () => {
  // list-dash
  // Registered normalization (R1): `-` bullets serialize as `*`.
  it('list-dash', async () => {
    expect(await roundtrip('- a\n- b\n')).toBe('* a\n* b\n')
  })
  // list-star
  it('list-star', async () => {
    expect(await roundtrip('* a\n* b\n')).toBe('* a\n* b\n')
  })
  // list-plus
  // Registered normalization (R1): `+` bullets serialize as `*`.
  it('list-plus', async () => {
    expect(await roundtrip('+ a\n+ b\n')).toBe('* a\n* b\n')
  })
  // list-mixed
  // Registered normalization (R1): Mixed bullet chars parse as three sibling lists, each re-bulleted (`*`/`-`/`*`).
  it('list-mixed', async () => {
    expect(await roundtrip('- a\n* b\n+ c\n')).toBe('* a\n\n- b\n\n* c\n')
  })
  // list-nested-2
  // Registered normalization (R1): Nested 2-space indent re-bullets to `*` (indent preserved).
  it('list-nested-2', async () => {
    expect(await roundtrip('- a\n  - b\n')).toBe('* a\n  * b\n')
  })
  // list-nested-4
  // Registered normalization (R1): Nested 4-space indent collapses to 2-space `*`.
  it('list-nested-4', async () => {
    expect(await roundtrip('- a\n    - b\n')).toBe('* a\n  * b\n')
  })
  // ordered
  it('ordered', async () => {
    expect(await roundtrip('1. a\n2. b\n')).toBe('1. a\n2. b\n')
  })
  // ordered-start-3
  it('ordered-start-3', async () => {
    expect(await roundtrip('3. a\n4. b\n')).toBe('3. a\n4. b\n')
  })
  // ordered-nested
  it('ordered-nested', async () => {
    expect(await roundtrip('1. a\n   1. b\n')).toBe('1. a\n   1. b\n')
  })
  // ordered-paren
  // Registered normalization (R1): `1)` delimiter normalizes to `1.`.
  it('ordered-paren', async () => {
    expect(await roundtrip('1) a\n2) b\n')).toBe('1. a\n2. b\n')
  })
})

describe('round-trip blockquote', () => {
  // list-loose
  // Registered normalization (R1): Loose list keeps blank line between items, bullets become `*`.
  it('list-loose', async () => {
    expect(await roundtrip('- a\n\n- b\n')).toBe('* a\n\n* b\n')
  })
  // quote
  it('quote', async () => {
    expect(await roundtrip('> q\n')).toBe('> q\n')
  })
  // quote-nested
  it('quote-nested', async () => {
    expect(await roundtrip('> > deep\n')).toBe('> > deep\n')
  })
  // quote-list
  // Registered normalization (R1): Bullets inside quotes serialize as `*`.
  it('quote-list', async () => {
    expect(await roundtrip('> - a\n> - b\n')).toBe('> * a\n> * b\n')
  })
})

describe('round-trip code', () => {
  // quote-code
  it('quote-code', async () => {
    expect(await roundtrip('> ```js\n> code\n> ```\n')).toBe('> ```js\n> code\n> ```\n')
  })
  // code-plain
  it('code-plain', async () => {
    expect(await roundtrip('```\nplain\n```\n')).toBe('```\nplain\n```\n')
  })
  // code-tilde
  // Registered normalization (R1): Tilde fences normalize to backtick fences.
  it('code-tilde', async () => {
    expect(await roundtrip('~~~\ntilde\n~~~\n')).toBe('```\ntilde\n```\n')
  })
  // code-indented
  // Registered normalization (R1): Indented code blocks serialize as fenced blocks.
  it('code-indented', async () => {
    expect(await roundtrip('    indented code\n')).toBe('```\nindented code\n```\n')
  })
  // code-special
  it('code-special', async () => {
    expect(await roundtrip('```md\n| a | # b |\n```\n')).toBe('```md\n| a | # b |\n```\n')
  })
})

describe('round-trip table', () => {
  // inline-code
  it('inline-code', async () => {
    expect(await roundtrip('para `code` end\n')).toBe('para `code` end\n')
  })
  // table-basic
  // Registered normalization (R1): Delimiter row shrinks to minimal `| - |`.
  it('table-basic', async () => {
    expect(await roundtrip('| a | b |\n| --- | --- |\n| 1 | 2 |\n')).toBe(
      '| a | b |\n| - | - |\n| 1 | 2 |\n',
    )
  })
  // table-center
  // Registered normalization (R1): Centered tables get symmetric cell padding and `:-:` align markers.
  it('table-center', async () => {
    expect(await roundtrip('| a | b |\n| :---: | :---: |\n| 1 | 2 |\n')).toBe(
      '|  a  |  b  |\n| :-: | :-: |\n|  1  |  2  |\n',
    )
  })
  // table-right
  // Registered normalization (R1): Right-aligned tables pad cells to column width with `:-` style markers.
  it('table-right', async () => {
    expect(await roundtrip('| a | b |\n| ---: | ---: |\n| 1 | 2 |\n')).toBe(
      '|  a |  b |\n| -: | -: |\n|  1 |  2 |\n',
    )
  })
  // table-left
  // Registered normalization (R1): Left-aligned tables pad cells to column width with `:-` markers.
  it('table-left', async () => {
    expect(await roundtrip('| a | b |\n| :--- | :--- |\n| 1 | 2 |\n')).toBe(
      '| a  | b  |\n| :- | :- |\n| 1  | 2  |\n',
    )
  })
  // table-escaped-pipe
  // Registered normalization (R1): Cells are padded to the widest column; escaped pipes survive.
  it('table-escaped-pipe', async () => {
    expect(await roundtrip('| a | b |\n| - | - |\n| x \\| y | 2 |\n')).toBe(
      '| a      | b |\n| ------ | - |\n| x \\| y | 2 |\n',
    )
  })
  // table-empty-cell
  // Registered normalization (R1): Empty cells are emitted as spaces.
  it('table-empty-cell', async () => {
    expect(await roundtrip('| a | b |\n| - | - |\n|  | 2 |\n')).toBe(
      '| a | b |\n| - | - |\n|   | 2 |\n',
    )
  })
})

describe('round-trip tasklist', () => {
  // table-header-only
  it('table-header-only', async () => {
    expect(await roundtrip('| a |\n| - |\n')).toBe('| a |\n| - |\n')
  })
  // task-open
  // Registered normalization (R1): Task list bullets serialize as `*`.
  it('task-open', async () => {
    expect(await roundtrip('- [ ] todo\n')).toBe('* [ ] todo\n')
  })
  // task-done
  // Registered normalization (R1): Checked state preserved, bullet becomes `*`.
  it('task-done', async () => {
    expect(await roundtrip('- [x] done\n')).toBe('* [x] done\n')
  })
  // task-nested
  // Registered normalization (R1): Nested tasks re-bullet to `*`.
  it('task-nested', async () => {
    expect(await roundtrip('- [ ] a\n  - [x] b\n')).toBe('* [ ] a\n  * [x] b\n')
  })
})

describe('round-trip emphasis', () => {
  // task-emphasis
  // Registered normalization (R1): Emphasis inside tasks preserved, bullet becomes `*`.
  it('task-emphasis', async () => {
    expect(await roundtrip('- [ ] **bold** task\n')).toBe('* [ ] **bold** task\n')
  })
  // em-star
  it('em-star', async () => {
    expect(await roundtrip('para *a* end\n')).toBe('para *a* end\n')
  })
  // em-underscore
  // Registered normalization (R1): Underline emphasis is preserved as `_` (remark keeps it).
  it('em-underscore', async () => {
    expect(await roundtrip('para _a_ end\n')).toBe('para _a_ end\n')
  })
  // strong-star
  it('strong-star', async () => {
    expect(await roundtrip('para **b** end\n')).toBe('para **b** end\n')
  })
  // strong-underscore
  // Registered normalization (R1): Double-underline strong is preserved as `__`.
  it('strong-underscore', async () => {
    expect(await roundtrip('para __b__ end\n')).toBe('para __b__ end\n')
  })
  // strike
  it('strike', async () => {
    expect(await roundtrip('para ~~del~~ end\n')).toBe('para ~~del~~ end\n')
  })
  // em-cjk
  it('em-cjk', async () => {
    expect(await roundtrip('中文*强调*中文\n')).toBe('中文*强调*中文\n')
  })
})

describe('round-trip links-images', () => {
  // strong-nested
  // Registered normalization (R1): Nested `**_x_**` flips to `_**x**_` (strong becomes inner).
  it('strong-nested', async () => {
    expect(await roundtrip('para **_x_** end\n')).toBe('para _**x**_ end\n')
  })
  // link
  it('link', async () => {
    expect(await roundtrip('see [t](https://example.com) now\n')).toBe(
      'see [t](https://example.com) now\n',
    )
  })
  // link-title
  it('link-title', async () => {
    expect(await roundtrip('see [t](https://example.com "T") now\n')).toBe(
      'see [t](https://example.com "T") now\n',
    )
  })
  // autolink
  // Registered normalization (R1): Autolinks keep the `<...>` form.
  it('autolink', async () => {
    expect(await roundtrip('see <https://example.com> now\n')).toBe(
      'see <https://example.com> now\n',
    )
  })
  // image
  it('image', async () => {
    expect(await roundtrip('pic ![alt](img.png) end\n')).toBe('pic ![alt](img.png) end\n')
  })
  // link-space-url
  it('link-space-url', async () => {
    expect(await roundtrip('see [t](<https://example.com/a b>) now\n')).toBe(
      'see [t](<https://example.com/a b>) now\n',
    )
  })
  // link-bold
  // Registered normalization (R1): Emphasis wrapping a link moves outside the link text.
  it('link-bold', async () => {
    expect(await roundtrip('see [**b**](u) now\n')).toBe('see **[b](u)** now\n')
  })
  // ref-link
  // Registered normalization (R1): Reference links are inlined; definitions are dropped.
  it('ref-link', async () => {
    expect(await roundtrip('see [t][r] now\n\n[r]: https://example.com\n')).toBe(
      'see [t](https://example.com) now\n',
    )
  })
})

describe('round-trip hr', () => {
  // hr-dashes
  // Registered normalization (R1): Thematic breaks normalize to `***`.
  it('hr-dashes', async () => {
    expect(await roundtrip('---\n')).toBe('***\n')
  })
})

describe('round-trip mixed-nesting', () => {
  // hr-between-paragraphs
  it('hr-between-paragraphs', async () => {
    expect(await roundtrip('para\n\n***\n\npara2\n')).toBe('para\n\n***\n\npara2\n')
  })
  // quote-table
  it('quote-table', async () => {
    expect(await roundtrip('> | a | b |\n> | - | - |\n> | 1 | 2 |\n')).toBe(
      '> | a | b |\n> | - | - |\n> | 1 | 2 |\n',
    )
  })
  // list-code
  // Registered normalization (R1): Loose list item with fenced code keeps structure, bullet becomes `*`.
  it('list-code', async () => {
    expect(await roundtrip('- item\n\n  ```js\n  code\n  ```\n')).toBe(
      '* item\n\n  ```js\n  code\n  ```\n',
    )
  })
  // table-br
  // Registered normalization (R1): Raw `<br>` is kept and cells are padded to column width.
  it('table-br', async () => {
    expect(await roundtrip('| a |\n| - |\n| line1<br>line2 |\n')).toBe(
      '| a              |\n| -------------- |\n| line1<br>line2 |\n',
    )
  })
  // blank-lines-2
  // Registered normalization (R1): Two blank lines between paragraphs collapse to one.
  it('blank-lines-2', async () => {
    expect(await roundtrip('p1\n\n\np2\n')).toBe('p1\n\np2\n')
  })
})

describe('round-trip long-docs', () => {
  // Registered normalizations across all three docs (R1): '-' bullets serialize as '*',
  // thematic breaks normalize to '***', tables are padded to column width and the
  // delimiter row is rewritten. The registered expected snapshots below capture the
  // exact normalized serialization of each fixture.
  for (const name of ['long-doc-1', 'long-doc-2', 'long-doc-3']) {
    it(`preserves ${name} with registered normalizations`, async () => {
      const input = fixture(`${name}.md`)
      const expected = fixture(`${name}.expected.md`)
      expect(await roundtrip(input)).toBe(expected)
    })
  }
})
