export interface FindOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

export interface FindMatch {
  from: number
  to: number
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 构造查找用正则。非法 regex 返回 null（调用方据此提示，不得写盘）。
 * 非 regex 时 query 按字面量转义；wholeWord 用 \b 包裹（仅非 regex）。
 */
export function compileFindRegex(query: string, options: FindOptions): RegExp | null {
  if (options.regex) {
    try {
      return new RegExp(query, options.caseSensitive ? 'g' : 'gi')
    } catch {
      return null
    }
  }
  const source = options.wholeWord ? `\\b(?:${escapeRegExp(query)})\\b` : escapeRegExp(query)
  return new RegExp(source, options.caseSensitive ? 'g' : 'gi')
}

/** Buffer 级匹配：非重叠（从前一次匹配末尾继续），零长匹配跳过。 */
export function computeMatches(
  text: string,
  query: string,
  options: FindOptions,
): Array<FindMatch> {
  if (query === '') return []
  const regex = compileFindRegex(query, options)
  if (regex === null) return []
  const matches: Array<FindMatch> = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1
      continue
    }
    matches.push({ from: match.index, to: match.index + match[0].length })
  }
  return matches
}

/**
 * 替换语义（ADR-6 偏离登记见 component-api.md）：
 * regex 分支用 `slice + replace` 产出，replacement 支持 $1 等分组引用；
 * 非 regex 分支 replacement 是字面量，不做任何 $ 展开。
 */
export function buildReplacedText(
  text: string,
  matches: ReadonlyArray<FindMatch>,
  query: string,
  options: FindOptions,
  replacement: string,
): string {
  let result = ''
  let cursor = 0
  for (const match of matches) {
    result += text.slice(cursor, match.from)
    if (options.regex) {
      const re = new RegExp(query, options.caseSensitive ? '' : 'i')
      result += text.slice(match.from, match.to).replace(re, replacement)
    } else {
      result += replacement
    }
    cursor = match.to
  }
  result += text.slice(cursor)
  return result
}
