import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildReplacedText,
  compileFindRegex,
  computeMatches,
  type FindOptions,
} from '../find/finder'

interface FindReplacePanelProps {
  text: string
  /** 计数规则：空匹配显示「0 个结果」，否则显示「N 个结果」 */
  onClose: () => void
  onNavigate: (from: number, to: number) => void
  onReplace: (from: number, to: number, replacement: string) => void
  onReplaceAll: (from: number, to: number, nextText: string) => void
}

export function FindReplacePanel({
  text,
  onClose,
  onNavigate,
  onReplace,
  onReplaceAll,
}: FindReplacePanelProps) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [message, setMessage] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const options: FindOptions = useMemo(
    () => ({ caseSensitive, wholeWord, regex }),
    [caseSensitive, wholeWord, regex],
  )
  const matches = useMemo(() => computeMatches(text, query, options), [text, query, options])
  const invalidRegex = query !== '' && options.regex && compileFindRegex(query, options) === null

  // 查询/文本/选项变化后导航指针回到第一个匹配（当前项从 0 开始）
  useEffect(() => {
    setCurrentIndex(0)
  }, [text, query, caseSensitive, wholeWord, regex])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const goNext = (): void => {
    if (matches.length === 0) return
    const match = matches[currentIndex % matches.length]
    if (match === undefined) return
    onNavigate(match.from, match.to)
    setCurrentIndex((currentIndex + 1) % matches.length)
    setMessage('')
  }

  const goPrev = (): void => {
    if (matches.length === 0) return
    const len = matches.length
    const prev = (currentIndex - 2 + len) % len
    onNavigate(matches[prev].from, matches[prev].to)
    setCurrentIndex((currentIndex - 1 + len) % len)
    setMessage('')
  }

  const replaceOne = (): void => {
    if (invalidRegex) {
      setMessage('无效的正则表达式')
      return
    }
    if (matches.length === 0) {
      setMessage('无匹配')
      return
    }
    const match = matches[currentIndex % matches.length]
    if (match === undefined) return
    const expanded = options.regex
      ? text
          .slice(match.from, match.to)
          .replace(new RegExp(query, caseSensitive ? '' : 'i'), replacement)
      : replacement
    onReplace(match.from, match.to, expanded)
    setMessage('')
  }

  const replaceAll = (): void => {
    if (invalidRegex) {
      setMessage('无效的正则表达式')
      return
    }
    if (matches.length === 0) {
      setMessage('无匹配')
      return
    }
    const nextText = buildReplacedText(text, matches, query, options, replacement)
    onReplaceAll(0, text.length, nextText)
    setMessage('')
  }

  const toggle = (label: string, active: boolean, onClick: () => void, testid: string) => (
    <button
      type="button"
      data-testid={testid}
      data-active={active ? 'true' : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  )

  return (
    <div className="find-panel" data-testid="find-panel">
      <input
        ref={inputRef}
        data-testid="find-input"
        value={query}
        placeholder="查找"
        onChange={(event) => {
          setQuery(event.target.value)
          setMessage('')
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            goNext()
          }
        }}
      />
      <span
        data-testid="find-count"
        className={matches.length === 0 ? 'find-count empty' : 'find-count'}
      >
        {matches.length === 0 ? '0 个结果' : `${matches.length} 个结果`}
      </span>
      {toggle('Aa', caseSensitive, () => setCaseSensitive((v) => !v), 'find-case')}
      {toggle('词', wholeWord, () => setWholeWord((v) => !v), 'find-word')}
      {toggle('.*', regex, () => setRegex((v) => !v), 'find-regex')}
      <button type="button" data-testid="find-prev" onClick={goPrev}>
        ↑
      </button>
      <button type="button" data-testid="find-next" onClick={goNext}>
        ↓
      </button>
      <button type="button" data-testid="find-close" aria-label="关闭查找替换" onClick={onClose}>
        ×
      </button>
      <input
        data-testid="find-replace-input"
        value={replacement}
        placeholder="替换为"
        onChange={(event) => {
          setReplacement(event.target.value)
          setMessage('')
        }}
      />
      <button type="button" data-testid="find-replace" onClick={replaceOne}>
        替换
      </button>
      <button type="button" data-testid="find-replace-all" onClick={replaceAll}>
        全部替换
      </button>
      {message !== '' ? <span className="find-msg">{message}</span> : null}
      {invalidRegex ? <span className="find-msg">无效的正则表达式</span> : null}
    </div>
  )
}
