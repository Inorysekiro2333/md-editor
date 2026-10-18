import { describe, expect, it } from 'vitest'
import { hasInlineDataUriImages, toInlineDataUri } from './dataUri'

describe('toInlineDataUri', () => {
  it('builds a data uri from mime and base64', () => {
    expect(toInlineDataUri('image/png', 'AAA=')).toBe('data:image/png;base64,AAA=')
  })
})

describe('hasInlineDataUriImages', () => {
  it('detects inline data uri images in the buffer', () => {
    expect(hasInlineDataUriImages('![pic](data:image/png;base64,AAA=)')).toBe(true)
  })

  it('ignores assets and remote references', () => {
    expect(hasInlineDataUriImages('![a](assets/pic.png)\n![b](https://example.com/a.png)')).toBe(
      false,
    )
  })

  it('returns false for empty and non-image data uris', () => {
    expect(hasInlineDataUriImages('')).toBe(false)
    expect(hasInlineDataUriImages('[link](data:text/plain;base64,AAA=)')).toBe(false)
  })
})
