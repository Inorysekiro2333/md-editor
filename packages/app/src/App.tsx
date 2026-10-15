import { EditorHost, type EditorHandle } from '@md-editor/editor'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MdDocument } from './document/MdDocument'
import { ipc } from './ipc'
import { useAppStore } from './state/appStore'

function toStatusMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw
}

export function App() {
  const doc = useAppStore((state) => state.doc)
  const setDoc = useAppStore((state) => state.setDoc)
  const externalNotice = useAppStore((state) => state.externalNotice)
  const setExternalNotice = useAppStore((state) => state.setExternalNotice)
  const [status, setStatus] = useState('未打开文件')
  const [reloadToken, setReloadToken] = useState(0)
  const [info, setInfo] = useState<{ version: string; electron: string } | null>(null)
  const editorHandle = useRef<EditorHandle | null>(null)

  const openFile = useCallback(
    async (path: string) => {
      try {
        const content = await ipc.readFile(path)
        await ipc.watchFile(path)
        setDoc(
          new MdDocument({
            id: `${path}#${Date.now()}`,
            path,
            text: content.text,
            originalBytesBase64: content.base64,
            eol: content.eol,
            hasBom: content.hasBom,
          }),
        )
        setExternalNotice(null)
        setStatus(`已打开 ${path}`)
        setReloadToken((token) => token + 1)
      } catch (error) {
        console.error('[app] openFile failed', error)
        setDoc(null)
        setExternalNotice(null)
        setStatus(`打开失败：${toStatusMessage(error)}`)
      }
    },
    [setDoc, setExternalNotice],
  )

  const save = useCallback(async () => {
    const current = useAppStore.getState().doc
    if (current === null || current.path === null) return
    editorHandle.current?.flushNow()
    const bytes = current.bytesForSave()
    if (bytes === null) {
      setStatus('无改动，已跳过写盘')
      return
    }
    try {
      const credential = await ipc.writeFile(current.path, bytes)
      current.markSaved(credential)
      setStatus('已保存')
    } catch (error) {
      console.error('[app] save failed', error)
      setStatus('保存失败，请重试')
    }
  }, [])

  useEffect(() => {
    void ipc
      .getAppInfo()
      .then(setInfo)
      .catch(() => setInfo(null))
  }, [])

  useEffect(() => {
    const unsubscribe = ipc.onOpenFile((path) => {
      void openFile(path)
    })
    return unsubscribe
  }, [openFile])

  useEffect(() => {
    const unsubscribe = ipc.onExternalModified(async (path) => {
      const current = useAppStore.getState().doc
      if (current === null || current.path !== path) return
      if (current.isDirty) {
        setExternalNotice('文件已被外部修改，请另存以免覆盖')
        return
      }
      try {
        const content = await ipc.readFile(path)
        current.setExternalText(content.text, content.base64)
        setReloadToken((token) => token + 1)
        setExternalNotice(null)
        setStatus('已自动重载外部修改')
      } catch (error) {
        console.error('[app] reload external change failed', error)
        setStatus(`打开失败：${toStatusMessage(error)}`)
      }
    })
    return unsubscribe
  }, [setExternalNotice])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  return (
    <main className="workspace">
      <header className="chrome">
        <span data-testid="status">
          {doc?.isDirty === true ? '未保存 · ' : ''}
          {status}
        </span>
      </header>
      <p data-testid="app-info">
        {info === null ? '加载中…' : `md-editor ${info.version} · Electron ${info.electron}`}
      </p>
      {externalNotice !== null ? <p className="notice">{externalNotice}</p> : null}
      <section className="editor-host">
        {doc === null ? (
          <p className="placeholder">正在等待文件…</p>
        ) : (
          <EditorHost
            key={`${doc.id}-${reloadToken}`}
            docId={doc.id}
            initialMarkdown={doc.text}
            onMarkdownChange={(markdown) => doc.applyEditorMarkdown(markdown)}
            onReady={(handle) => {
              editorHandle.current = handle
            }}
          />
        )}
      </section>
    </main>
  )
}
