import { schemaCtx } from '@milkdown/kit/core'
import { inputRules, InputRule } from '@milkdown/prose/inputrules'
import { keymap } from '@milkdown/kit/prose/keymap'
import { markRule } from '@milkdown/prose'
import { $prose } from '@milkdown/kit/utils'
import { EditorState, Plugin, TextSelection } from '@milkdown/kit/prose/state'
import type { Mark as PMMark, Node as PMNode } from '@milkdown/prose/model'

/**
 * 表格管道规则：在段落末尾键入 `| a | b |` 后按 Enter，
 * 将该段替换为 GFM 表格（首行即表头）。
 * Milkdown gfm 自带的表格 input rule 由行尾空格触发，Enter 不生效，
 * 故此处用 keymap 补齐，复用 gfm 注册的 table/table_row/table_header 节点。
 */
export const editorInputRules = $prose(() => {
  return keymap({
    Enter: (state, dispatch) => {
      const { $from, empty } = state.selection
      if (!empty || !$from.parent.isTextblock) return false
      if ($from.parentOffset !== $from.parent.content.size) return false
      const match = /^\|(.+)\|$/.exec($from.parent.textContent)
      if (!match) return false
      const table = state.schema.nodes.table
      const row = state.schema.nodes.table_row
      const header = state.schema.nodes.table_header
      const paragraph = state.schema.nodes.paragraph
      if (!table || !row || !header) return false
      if (!dispatch) return true
      const cells = match[1].split(/(?<!\\)\|/).map((raw) => {
        const text = raw.replaceAll('\\|', '|').trim()
        return header.create(null, paragraph.create(null, text ? state.schema.text(text) : null))
      })
      const tableNode = table.create(null, [row.create(null, cells)])
      const tr = state.tr.replaceWith($from.before(1), $from.after(1), tableNode)
      tr.setSelection(TextSelection.near(tr.doc.resolve($from.before(1)), 1)).scrollIntoView()
      dispatch(tr)
      return true
    },
  })
})

/**
 * 三星粗斜体中途拦截：键入 `***text**`（差最后一颗收尾星）时，
 * 内置/自定义 strong 规则会抢先消费 `**text**`（开界取三星中的后两颗），
 * 留下一颗游离字面星，最终序列化出错误的强调结构。
 * 此插件注册在内置 inputRules 之前（EditorHost config 阶段加入 prosePluginsCtx），
 * 对即将凑齐三星收尾的那次键入改为纯文本插入、不跑规则，
 * 让最后一颗星到达时由 editorMarkInputRules 的三星规则整段转换。
 */
export const editorTripleStarGuard = new Plugin({
  props: {
    handleTextInput(view, from, to, text) {
      if (text !== '*') return false
      const { state } = view
      const $from = state.doc.resolve(from)
      const $to = state.doc.resolve(to)
      if (!$from.sameParent($to) || !$from.parent.isTextblock) return false
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC')
      const match = /\*\*\*([^*]+?)\*\*$/.exec(before + text)
      if (!match || !match[1].trim()) return false
      if (rangeHasCodeMark(state, from, to) || typedCharInCodeSpan(state, to)) return false
      view.dispatch(state.tr.insertText(text, from, to))
      return true
    },
  },
})
/** 范围内是否含行内代码 mark（守卫：不在代码 span 内触发强调规则）。 */
function rangeHasCodeMark(state: EditorState, from: number, to: number): boolean {
  const code = state.schema.marks.inlineCode
  if (!code) return false
  let found = false
  state.doc.nodesBetween(from, to, (node: PMNode) => {
    if (node.marks.some((m: PMMark) => m.type === code)) found = true
  })
  return found
}

function typedCharInCodeSpan(state: EditorState, pos: number): boolean {
  const stored = state.storedMarks ?? state.doc.resolve(pos).marks()
  return stored.some((m: PMMark) => m.type === state.schema.marks.inlineCode)
}

/**
 * mark input rules 补充：Milkdown 内置 strong/strikethrough 规则带
 * `(?<![\w:/])` lookbehind，开界标紧跟 ASCII 词字符时拒绝触发
 * （行尾已有文字时键入 `**xx**` 不转加粗，序列化被转义为 `\*\*xx\*\*`）。
 * CommonMark 本身允许词后 `foo**bar**` 成对星号，故对 `*` 系放宽；
 * `__` 保留词内保守性（CommonMark 对 intraword 下划线不强调）。
 * 代码块/行内代码守卫由 markRule 自带校验 + parent code 检查承担。
 * `***text***` 组合规则同时施加 emphasis + strong（序列化为三星粗斜体），
 * 代码 span 守卫与 markRule 一致。
 */
export const editorMarkInputRules = $prose((ctx) => {
  const schema = ctx.get(schemaCtx)
  const strong = schema.marks.strong
  const emphasis = schema.marks.emphasis
  const strikethrough = schema.marks.strike_through
  const markRules: InputRule[] = []
  if (strong && emphasis) {
    markRules.push(
      new InputRule(/\*\*\*([^*]+?)\*\*\*(?![\w/])$/, (state, match, start, end) => {
        const group = match[1]
        if (!group || !group.trim()) return null
        const textStart = start + match[0].indexOf(group)
        const textEnd = textStart + group.length
        if (
          rangeHasCodeMark(state, start, textStart) ||
          rangeHasCodeMark(state, textEnd, end) ||
          typedCharInCodeSpan(state, end)
        ) {
          return null
        }
        const { tr } = state
        const storedMarks = tr.storedMarks ?? []
        tr.delete(textEnd, end)
        tr.delete(start, textStart)
        const markEnd = start + group.length
        // 先 em 后 strong，序列化输出 ***text***
        tr.addMark(start, markEnd, emphasis.create())
        tr.addMark(start, markEnd, strong.create({ marker: '*' }))
        tr.setStoredMarks(storedMarks)
        return tr
      }),
    )
  }
  if (strong) {
    markRules.push(
      markRule(/\*\*([^*_]+?)\*\*(?![\w/])$/, strong, {
        getAttr: () => ({ marker: '*' }),
      }),
      markRule(/(?<![\w:/])__([^*_]+?)__(?![\w/])$/, strong, {
        getAttr: () => ({ marker: '_' }),
      }),
    )
  }
  if (strikethrough) {
    markRules.push(markRule(/(~{1,2})([^~]+?)\1(?!\w|\/)$/, strikethrough))
  }
  return inputRules({ rules: markRules })
})
