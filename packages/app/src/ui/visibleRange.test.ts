import { describe, expect, it } from 'vitest'
import { visibleRange } from './visibleRange'

describe('visibleRange', () => {
  it('returns overscan-padded range at the top', () => {
    expect(visibleRange(0, 240, 24, 100)).toEqual({ start: 0, end: 18 })
  })

  it('pads around the first visible row in the middle', () => {
    expect(visibleRange(2400, 240, 24, 1000)).toEqual({ start: 92, end: 118 })
  })

  it('clamps end at total near the bottom', () => {
    expect(visibleRange(2160, 240, 24, 100)).toEqual({ start: 82, end: 100 })
  })

  it('returns empty range for zero total', () => {
    expect(visibleRange(0, 240, 24, 0)).toEqual({ start: 0, end: 0 })
  })

  it('clamps start at zero when scrolled slightly', () => {
    expect(visibleRange(48, 240, 24, 100, 8)).toEqual({ start: 0, end: 20 })
  })
})
