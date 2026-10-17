import { describe, expect, it } from 'vitest'
import { buildReplacedText, compileFindRegex, computeMatches } from './finder'

const OFF = { caseSensitive: false, wholeWord: false, regex: false }
const REG = { ...OFF, regex: true }

describe('computeMatches', () => {
  it('finds plain matches with exact offsets', () => {
    expect(computeMatches('alpha beta alpha', 'alpha', OFF)).toEqual([
      { from: 0, to: 5 },
      { from: 11, to: 16 },
    ])
  })

  it('honors the caseSensitive switch', () => {
    const text = 'Alpha alpha ALPHA aLPhA'
    expect(computeMatches(text, 'alpha', OFF)).toHaveLength(4)
    expect(
      computeMatches(text, 'alpha', { caseSensitive: true, wholeWord: false, regex: false }),
    ).toEqual([{ from: 6, to: 11 }])
  })

  it('respects whole-word boundaries: cat does not match category', () => {
    const text = 'cat category cat,cat'
    const whole = computeMatches(text, 'cat', {
      caseSensitive: false,
      wholeWord: true,
      regex: false,
    })
    expect(whole.map((m) => m.from)).toEqual([0, 13, 17])
    expect(computeMatches(text, 'cat', OFF)).toHaveLength(4)
  })

  it('treats underscore as a word character for whole-word', () => {
    expect(
      computeMatches('cat_cat', 'cat', { caseSensitive: false, wholeWord: true, regex: false }),
    ).toEqual([])
  })

  it('matches regex patterns like \\d+', () => {
    expect(computeMatches('a1 b22 c333', '\\d+', REG)).toEqual([
      { from: 1, to: 2 },
      { from: 4, to: 6 },
      { from: 8, to: 11 },
    ])
  })

  it('captures regex groups for $1 expansion offsets', () => {
    const matches = computeMatches('a-b c-d', '(\\w)-(\\w)', REG)
    expect(matches).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
    ])
    expect(buildReplacedText('a-b c-d', matches, '(\\w)-(\\w)', REG, '$1_$2')).toBe('a_b c_d')
  })

  it('returns [] for invalid regex', () => {
    expect(computeMatches('abc', '((', REG)).toEqual([])
    expect(compileFindRegex('((', REG)).toBeNull()
  })

  it('returns [] for empty query', () => {
    expect(computeMatches('abc', '', OFF)).toEqual([])
    expect(
      computeMatches('abc', '', { caseSensitive: true, wholeWord: true, regex: true }),
    ).toEqual([])
  })

  it('does not overlap matches: aaa with aa yields one match', () => {
    expect(computeMatches('aaa', 'aa', OFF)).toEqual([{ from: 0, to: 2 }])
  })

  it('keeps offsets exact across CJK and newlines', () => {
    expect(computeMatches('# 你好\nx alpha', 'alpha', OFF)).toEqual([{ from: 7, to: 12 }])
  })

  it('treats regex specials literally outside regex mode', () => {
    expect(computeMatches('a.b axb', 'a.b', OFF)).toEqual([{ from: 0, to: 3 }])
  })

  it('skips zero-length regex matches', () => {
    expect(computeMatches('abc', 'a*', REG)).toEqual([{ from: 0, to: 1 }])
  })

  it('replaces literally outside regex mode ($1 stays literal)', () => {
    const matches = computeMatches('aaa', 'aa', OFF)
    expect(buildReplacedText('aaa', matches, 'aa', OFF, '$1').replace('OFF->OFF', '')).toBe('$1a')
  })
})
