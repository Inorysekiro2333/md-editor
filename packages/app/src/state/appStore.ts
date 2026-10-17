import { create } from 'zustand'
import type { MdDocument } from '../document/MdDocument'

export type EditorMode = 'wysiwyg' | 'source'

export interface AppState {
  docs: MdDocument[]
  activeDocId: string | null
  mode: EditorMode
  externalNotice: string | null
  /** 同 path 已存在 → 激活既有 tab，不重复打开。 */
  openDoc(doc: MdDocument): void
  /** 关活跃 tab → 激活相邻左侧；清空 → null。 */
  closeDoc(id: string): void
  setActiveDoc(id: string): void
  setMode(mode: EditorMode): void
  setExternalNotice(notice: string | null): void
}

export const useAppStore = create<AppState>((set) => ({
  docs: [],
  activeDocId: null,
  mode: 'wysiwyg',
  externalNotice: null,
  openDoc: (doc) =>
    set((state) => {
      const existing = state.docs.find((current) => current.path === doc.path)
      if (existing !== undefined) {
        return { activeDocId: existing.id }
      }
      return { docs: [...state.docs, doc], activeDocId: doc.id }
    }),
  closeDoc: (id) =>
    set((state) => {
      const index = state.docs.findIndex((doc) => doc.id === id)
      if (index === -1) return state
      const docs = state.docs.filter((doc) => doc.id !== id)
      if (state.activeDocId !== id) return { docs }
      const neighbor = docs[Math.min(index, docs.length - 1)] ?? null
      return { docs, activeDocId: neighbor?.id ?? null }
    }),
  setActiveDoc: (activeDocId) => set({ activeDocId }),
  setMode: (mode) => set({ mode }),
  setExternalNotice: (externalNotice) => set({ externalNotice }),
}))
