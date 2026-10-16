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
 * 重放事务带 meta 标记，不会被再次记录。
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

export const sessionRecorderPlugin = new Plugin<SerializedTransaction[]>({
  key: sessionRecorderKey,
  state: {
    init: () => [],
    apply: (tr, recorded) => {
      if (!tr.docChanged || tr.getMeta(sessionRecorderKey) !== undefined) return recorded
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
  const transactions = sessionRecorderKey.getState(state) ?? []
  return { baseMarkdown, transactions }
}

/** 在新 editor 的 view 上重放保存的事务序列，原生重建撤销/重做栈。 */
export function restoreSessionHistory(record: SessionHistoryRecord, view: EditorView): void {
  for (const { steps, time } of record.transactions) {
    const tr = view.state.tr
    for (const json of steps) {
      tr.step(Step.fromJSON(view.state.schema, json))
    }
    if (time > 0) tr.setTime(time)
    tr.setMeta(sessionRecorderKey, 'replay')
    view.dispatch(tr)
  }
}
