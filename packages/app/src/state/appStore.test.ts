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
