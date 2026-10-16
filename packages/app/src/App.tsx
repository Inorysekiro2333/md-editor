import {
  EditorHost,
  SourceEditor,
  type EditorHandle,
  type SourceEditorHandle,
} from '@md-editor/editor'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MdDocument } from './document/MdDocument'
import { ipc } from './ipc'
import { useAppStore } from './state/appStore'

const ASSET_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

function toStatusMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw
}

export function App() {
  const doc = useAppStore((state) => state.doc)
  const setDoc = useAppStore((state) => state.setDoc)
  const externalNotice = useAppStore((state) => state.externalNotice)
  const setExternalNotice = useAppStore((state) => state.setExternalNotice)
  const mode = useAppStore((state) => state.mode)
  const setMode = useAppStore((state) => state.setMode)
  const [status, setStatus] = useState('未打开文件')
  const [editorReady, setEditorReady] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [info, setInfo] = useState<{ version: string; electron: string } | null>(null)
  const editorHandle = useRef<EditorHandle | null>(null)
  const sourceHandle = useRef<SourceEditorHandle | null>(null)
  const pendingSelection = useRef<{ anchor: number; head: number } | null>(null)
  const pendingScrollRatio = useRef(0)

  const toggleMode = useCallback(() => {
    const current = useAppStore.getState().mode
    if (current === 'wysiwyg') {
      const handle = editorHandle.current
      handle?.flushNow()
      pendingSelection.current = handle?.getSelectionOffsets() ?? null
      pendingScrollRatio.current = handle?.getScrollRatio() ?? 0
      setMode('source')
    } else {
      const handle = sourceHandle.current
      if (handle === null) {
        pendingSelection.current = null
        pendingScrollRatio.current = 0
      } else {
        handle.flushNow()
        pendingSelection.current = handle.getSelectionOffsets()
        pendingScrollRatio.current = handle.getScrollRatio()
      }
      setMode('wysiwyg')
    }
  }, [setMode])

  const onPasteAsset = useCallback(async (base64: string, mime: string): Promise<string> => {
    const current = useAppStore.getState().doc
    const path = current?.path ?? null
    if (path === null) {
      setStatus('请先保存文档后再粘贴图片')
      throw new Error('请先保存文档后再粘贴图片')
    }
    const ext = ASSET_EXT_BY_MIME[mime]
    if (ext === undefined) {
      setStatus('不支持的图片格式')
      throw new Error('不支持的图片格式')
    }
    try {
      const rel = await ipc.saveAsset(path, base64, ext)
      setStatus(`已保存图片 ${rel}`)
      return rel
    } catch (error) {
      console.error('[app] saveAsset failed', error)
      setStatus(`图片保存失败：${toStatusMessage(error)}`)
      throw error
    }
  }, [])

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
    setEditorReady(false)
  }, [doc, reloadToken])

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
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() !== 's' && event.key !== '/') return
      event.preventDefault()
      if (event.key === '/') {
        // capture 阶段拦截：CodeMirror 默认把 Ctrl+/ 绑定为切换注释，
        // 必须在到达编辑器前停止传播，否则源码模式会混入 <!-- -->
        event.stopPropagation()
        toggleMode()
        return
      }
      void save()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save, toggleMode])

  return (
    <main className="workspace">
      <header className="chrome">
        <span data-testid="status">
          {doc?.isDirty === true ? '未保存 · ' : ''}
          {status}
        </span>
        <button type="button" data-testid="mode-toggle" onClick={toggleMode}>
          编辑模式：{mode === 'wysiwyg' ? '所见即所得' : '源码'}
        </button>
      </header>
      <p data-testid="app-info">
        {info === null ? '加载中…' : `md-editor ${info.version} · Electron ${info.electron}`}
      </p>
      {externalNotice !== null ? <p className="notice">{externalNotice}</p> : null}
      <section className="editor-host" data-editor-ready={editorReady ? 'true' : undefined}>
        {doc === null ? (
          <p className="placeholder">正在等待文件…</p>
        ) : mode === 'wysiwyg' ? (
          <EditorHost
            key={`${doc.id}-${reloadToken}`}
            docId={doc.id}
            initialMarkdown={doc.text}
            onMarkdownChange={(markdown) => doc.applyEditorMarkdown(markdown)}
            initialSelection={pendingSelection.current}
            onSelectionApplied={() => {
              pendingSelection.current = null
            }}
            onReady={(handle) => {
              editorHandle.current = handle
              setEditorReady(true)
            }}
            onPasteAsset={onPasteAsset}
          />
        ) : (
          <SourceEditor
            key={`${doc.id}-${reloadToken}`}
            initialMarkdown={doc.text}
            initialScrollRatio={pendingScrollRatio.current}
            onMarkdownChange={(markdown) => doc.applyEditorMarkdown(markdown)}
            onReady={(handle) => {
              sourceHandle.current = handle
              setEditorReady(true)
              const pending = pendingSelection.current
              if (pending !== null) {
                handle.setSelectionOffsets(pending.anchor, pending.head)
                pendingSelection.current = null
                handle.focus()
              }
            }}
          />
        )}
      </section>
    </main>
  )
}
