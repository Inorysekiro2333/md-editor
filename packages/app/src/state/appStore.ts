import { create } from 'zustand'
import type { MdDocument } from '../document/MdDocument'

export type EditorMode = 'wysiwyg' | 'source'

export interface AppState {
  doc: MdDocument | null
  mode: EditorMode
  externalNotice: string | null
  setDoc(doc: MdDocument | null): void
  setMode(mode: EditorMode): void
  setExternalNotice(notice: string | null): void
}

export const useAppStore = create<AppState>((set) => ({
  doc: null,
  mode: 'wysiwyg',
  externalNotice: null,
  setDoc: (doc) => set({ doc }),
  setMode: (mode) => set({ mode }),
  setExternalNotice: (externalNotice) => set({ externalNotice }),
}))
