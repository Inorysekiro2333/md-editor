import { Plugin, PluginKey } from '@milkdown/prose/state'
import type { EditorState } from '@milkdown/prose/state'
import { Step } from '@milkdown/prose/transform'
import type { EditorView } from '@milkdown/prose/view'

/**
 * 会话级撤销栈存储（内存 Map，随渲染进程存活）。
 *
 * 机制：Milkdown 的 history plugin（prosemirror-history）不导出其 plugin key，
 * 其 HistoryState 也不支持 JSON 序列化，且每次创建 Milkdown Editor 都会产生
 * 新的 schema 实例，无法跨实例直接注入 state。因此用自带的 recording plugin
 * 记录每个改变文档的事务（step JSON + tr.time），恢复时按原顺序重放——
 * prosemirror-history 会原生重建撤销/重做栈（分组依据 tr.time 保持一致）。
 *
 * 基线协议：record.baseMarkdown 是撤销栈的基线内容。恢复时若当前 initialMarkdown
 * 与基线不一致（外部重载场景），先把 doc 重置为基线（不入撤销历史、不记录），
 * 再重放事务；重放期间 recorder 被抑制（重放事务本身已在 record 中，
 * 且会附带 heading-id 等 appended 事务噪声），结束后 recorder 状态被重置为
 * record.transactions，后续用户编辑在其上追加，基线永远不被污染。
 */
export interface SerializedTransaction {
  steps: unknown[]
  time: number
}

export interface SessionHistoryRecord {
  baseMarkdown: string
  transactions: SerializedTransaction[]
}

export const sessionRecorderKey = new PluginKey<SerializedTransaction[]>('mdEditorSessionRecorder')

/** 恢复重放期间为 true：recorder 跳过记录，避免 appended 事务噪声污染会话序列。 */
let restoring = false

export const sessionRecorderPlugin = new Plugin<SerializedTransaction[]>({
  key: sessionRecorderKey,
  state: {
    init: () => [],
    apply: (tr, recorded) => {
      if (restoring) return recorded
      const meta = tr.getMeta(sessionRecorderKey)
      if (Array.isArray(meta)) return meta
      if (!tr.docChanged || meta !== undefined) return recorded
      return [...recorded, { steps: tr.steps.map((step) => step.toJSON()), time: tr.time }]
    },
  },
})

const store = new Map<string, SessionHistoryRecord>()

export function saveHistory(docId: string, record: SessionHistoryRecord): void {
  store.set(docId, record)
}

export function loadHistory(docId: string): SessionHistoryRecord | null {
  return store.get(docId) ?? null
}

export function clearHistory(docId: string): void {
  store.delete(docId)
}

export function buildSessionHistory(
  state: EditorState,
  baseMarkdown: string,
): SessionHistoryRecord {
  return { baseMarkdown, transactions: sessionRecorderKey.getState(state) ?? [] }
}

export interface RestoreSessionOptions {
  /** 外部重载场景：当前 initialMarkdown 与基线不一致时，用它把 doc 重置回基线 */
  currentMarkdown?: string
  parseBase?: (markdown: string) => unknown
}

/** 在新 editor 的 view 上重放保存的事务序列，原生重建撤销/重做栈。 */
export function restoreSessionHistory(
  record: SessionHistoryRecord,
  view: EditorView,
  options: RestoreSessionOptions = {},
): void {
  restoring = true
  try {
    if (
      options.currentMarkdown !== undefined &&
      options.parseBase &&
      record.baseMarkdown !== options.currentMarkdown
    ) {
      const base = options.parseBase(record.baseMarkdown)
      if (base && typeof base === 'object' && 'type' in base) {
        view.dispatch(
          view.state.tr
            .replaceWith(0, view.state.doc.content.size, base as never)
            // 不入撤销历史：重置事务不属于用户编辑，撤销不应越过基线
            .setMeta('addToHistory', false),
        )
      }
    }
    for (const { steps, time } of record.transactions) {
      const tr = view.state.tr
      for (const json of steps) {
        tr.step(Step.fromJSON(view.state.schema, json))
      }
      if (time > 0) tr.setTime(time)
      view.dispatch(tr)
    }
  } finally {
    restoring = false
  }
  // recorder 状态重置为 record 的事务序列（须在 restoring=false 之后，否则会被跳过）：
  // 重放内容已在 record 中，后续用户编辑从这里追加（防止 appended 事务随每次重挂累积）
  view.dispatch(
    view.state.tr.setMeta(sessionRecorderKey, record.transactions).setMeta('addToHistory', false),
  )
}
