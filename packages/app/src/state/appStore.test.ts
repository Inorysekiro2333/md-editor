import { beforeEach, describe, expect, it } from 'vitest'
import { MdDocument } from '../document/MdDocument'
import { useAppStore } from './appStore'

function makeDoc(path: string): MdDocument {
  return new MdDocument({
    id: `${path}#1`,
    path,
    text: `# ${path}\n`,
    originalBytesBase64: '',
    eol: 'lf',
    hasBom: false,
  })
}

describe('appStore multi-tab state', () => {
  beforeEach(() => {
    useAppStore.setState({ docs: [], activeDocId: null })
  })

  it('openDoc activates the existing doc when the same path is opened again', () => {
    const first = makeDoc('C:/notes/a.md')
    useAppStore.getState().openDoc(first)
    expect(useAppStore.getState().docs).toHaveLength(1)
    expect(useAppStore.getState().activeDocId).toBe(first.id)

    const duplicate = makeDoc('C:/notes/a.md')
    useAppStore.getState().openDoc(duplicate)
    const state = useAppStore.getState()
    expect(state.docs).toHaveLength(1)
    expect(state.activeDocId).toBe(first.id)
  })

  it('closeDoc activates the adjacent left tab and clears to null when empty', () => {
    const a = makeDoc('C:/notes/a.md')
    const b = makeDoc('C:/notes/b.md')
    const c = makeDoc('C:/notes/c.md')
    const store = useAppStore.getState()
    store.openDoc(a)
    store.openDoc(b)
    store.openDoc(c)
    expect(useAppStore.getState().activeDocId).toBe(c.id)

    useAppStore.getState().closeDoc(c.id)
    expect(useAppStore.getState().activeDocId).toBe(b.id)

    useAppStore.getState().closeDoc(b.id)
    expect(useAppStore.getState().activeDocId).toBe(a.id)

    useAppStore.getState().closeDoc(a.id)
    expect(useAppStore.getState().docs).toHaveLength(0)
    expect(useAppStore.getState().activeDocId).toBeNull()
  })

  it('closeDoc activates the left neighbor when a middle active tab closes', () => {
    const a = makeDoc('C:/notes/a.md')
    const b = makeDoc('C:/notes/b.md')
    const c = makeDoc('C:/notes/c.md')
    const store = useAppStore.getState()
    store.openDoc(a)
    store.openDoc(b)
    store.openDoc(c)
    useAppStore.getState().setActiveDoc(b.id)

    useAppStore.getState().closeDoc(b.id)
    const state = useAppStore.getState()
    expect(state.docs.map((doc) => doc.id)).toEqual([a.id, c.id])
    expect(state.activeDocId).toBe(a.id)
  })

  it('openDoc allows multiple untitled docs with path=null', () => {
    const first = new MdDocument({
      id: 'untitled#1',
      path: null,
      text: '',
      originalBytesBase64: '',
      eol: 'lf',
      hasBom: false,
    })
    const second = new MdDocument({
      id: 'untitled#2',
      path: null,
      text: '',
      originalBytesBase64: '',
      eol: 'lf',
      hasBom: false,
    })

    useAppStore.getState().openDoc(first)
    useAppStore.getState().openDoc(second)

    const state = useAppStore.getState()
    expect(state.docs).toHaveLength(2)
    expect(state.activeDocId).toBe(second.id)
  })

  it('replaceDoc swaps the instance with the same id and keeps order', () => {
    const a = makeDoc('C:/notes/a.md')
    useAppStore.getState().openDoc(a)

    const saved = a.withPath('C:/notes/b.md')
    useAppStore.getState().replaceDoc(saved)

    const state = useAppStore.getState()
    expect(state.docs).toEqual([saved])
    expect(state.activeDocId).toBe(saved.id)
    // 未知 id 是幂等空操作
    const ghost = makeDoc('C:/notes/ghost.md')
    useAppStore.getState().replaceDoc(ghost)
    expect(useAppStore.getState().docs).toEqual([saved])
  })

  it('closeDoc keeps the active tab when a background tab closes', () => {
    const a = makeDoc('C:/notes/a.md')
    const b = makeDoc('C:/notes/b.md')
    const store = useAppStore.getState()
    store.openDoc(a)
    store.openDoc(b)
    useAppStore.getState().setActiveDoc(a.id)

    useAppStore.getState().closeDoc(b.id)
    const state = useAppStore.getState()
    expect(state.docs).toHaveLength(1)
    expect(state.activeDocId).toBe(a.id)
  })
})
