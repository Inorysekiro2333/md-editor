import { describe, expect, it } from 'vitest'
import { createTestEditor } from './testing/create-test-editor'

// @vitest-environment jsdom

async function roundtrip(input: string): Promise<string> {
  const editor = await createTestEditor(input)
  try {
    return editor.getMarkdown()
  } finally {
    await editor.destroy()
  }
}

describe('round-trip harness smoke', () => {
  it('preserves a heading', async () => {
    expect(await roundtrip('# Hello\n')).toBe('# Hello\n')
  })
  // Registered normalization (R1): remark serializes `-` bullets as `*`.
  it('normalizes bullet markers to asterisks', async () => {
    expect(await roundtrip('- a\n- b\n')).toBe('* a\n* b\n')
  })
  it('preserves a blockquote', async () => {
    expect(await roundtrip('> quote\n')).toBe('> quote\n')
  })
  it('preserves a fenced code block with language', async () => {
    const code = '```ts\nconst a = 1\n```\n'
    expect(await roundtrip(code)).toBe(code)
  })
  // Registered normalization (R1): remark shrinks the table delimiter row to the minimal `| - |` form.
  it('normalizes table delimiter rows to minimal form', async () => {
    expect(await roundtrip('| a | b |\n| --- | --- |\n| 1 | 2 |\n')).toBe(
      '| a | b |\n| - | - |\n| 1 | 2 |\n',
    )
  })
})
