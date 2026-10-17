import {
  clearHistory,
  EditorHost,
  SourceEditor,
  type EditorHandle,
  type OutlineItem,
  type SourceEditorHandle,
} from '@md-editor/editor'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MdDocument } from './document/MdDocument'
import { ipc } from './ipc'
import { useAppStore } from './state/appStore'
import { FileTree, insertIntoTree } from './ui/FileTree'
import { OutlinePanel } from './ui/OutlinePanel'
import { Modal } from './ui/Modal'
import { FindReplacePanel } from './ui/FindReplacePanel'
import type { WorkspaceNode } from './bridge'

const ASSET_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

type PendingClose = { kind: 'tab'; id: string } | { kind: 'window' }

function toStatusMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw
}

function addPathToSet(paths: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(paths)
  next.add(path)
  return next
}

function removePathFromSet(paths: ReadonlySet<string>, path: string): ReadonlySet<string> {
  if (!paths.has(path)) return paths
  const next = new Set(paths)
  next.delete(path)
  return next
}

function tabTitle(path: string | null): string {
  if (path === null) return '未命名'
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 1] ?? path
}

export function App() {
  const docs = useAppStore((state) => state.docs)
  const activeDocId = useAppStore((state) => state.activeDocId)
  const setActiveDoc = useAppStore((state) => state.setActiveDoc)
  const activeDoc = docs.find((doc) => doc.id === activeDocId) ?? null
  const setExternalNotice = useAppStore((state) => state.setExternalNotice)
  const externalNotice = useAppStore((state) => state.externalNotice)
  const mode = useAppStore((state) => state.mode)
  const setMode = useAppStore((state) => state.setMode)
  const [status, setStatus] = useState('未打开文件')
  const [editorReady, setEditorReady] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [cursorOffset, setCursorOffset] = useState<number | null>(null)
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null)
  const [pendingExternalPaths, setPendingExternalPaths] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )
  const [findOpen, setFindOpen] = useState(false)
  // Ruling-7：上次快照时是否存在 dirty doc；全库转干净后需删快照。
  const hadDirtyRef = useRef(false)
  // MdDocument 是可变对象，脏变化不会触发 zustand；靠 tick 重渲染读取 isDirty。
  const [, bumpDirtyTick] = useState(0)
  const [info, setInfo] = useState<{
    version: string
    electron: string
    hasCliOpen: boolean
  } | null>(null)
  const [workspaceNodes, setWorkspaceNodes] = useState<WorkspaceNode[] | null>(null)
  const workspaceDirRef = useRef<string | null>(null)
  const editorHandle = useRef<EditorHandle | null>(null)
  const sourceHandle = useRef<SourceEditorHandle | null>(null)
  const pendingSelection = useRef<{ anchor: number; head: number } | null>(null)
  const pendingScrollRatio = useRef(0)
  // 大纲高亮的 200ms 节流（编辑器侧插件已 150ms 节流，这里挡住高频 setState）
  const cursorEmitRef = useRef({ last: 0, timer: null as number | null })
  const addPendingExternalPath = useCallback((path: string) => {
    setPendingExternalPaths((paths) => addPathToSet(paths, path))
  }, [])

  const removePendingExternalPath = useCallback((path: string) => {
    setPendingExternalPaths((paths) => removePathFromSet(paths, path))
  }, [])

  const onCursorChange = useCallback((offset: number) => {
    const now = Date.now()
    const { last, timer } = cursorEmitRef.current
    if (timer !== null) window.clearTimeout(timer)
    const elapsed = now - last
    if (elapsed >= 200) {
      cursorEmitRef.current.last = now
      cursorEmitRef.current.timer = null
      setCursorOffset(offset)
      return
    }
    cursorEmitRef.current.timer = window.setTimeout(() => {
      cursorEmitRef.current.last = Date.now()
      cursorEmitRef.current.timer = null
      setCursorOffset(offset)
    }, 200 - elapsed)
  }, [])

  // 切换文档 / 重挂载时旧 offset 无意义，清空高亮
  useEffect(() => {
    setCursorOffset(null)
  }, [activeDocId, reloadToken])

  const activePendingExternalPath =
    activeDoc?.path !== undefined &&
    activeDoc.path !== null &&
    pendingExternalPaths.has(activeDoc.path)
      ? activeDoc.path
      : null

  const jumpToOutlineItem = useCallback(
    (item: OutlineItem) => {
      if (mode === 'wysiwyg') {
        const handle = editorHandle.current
        if (handle === null) return
        handle.setSelectionOffsets(item.textOffset, item.textOffset)
        handle.focus()
        return
      }
      const handle = sourceHandle.current
      if (handle === null) return
      handle.setSelectionOffsets(item.textOffset, item.textOffset)
      handle.focus()
    },
    [mode],
  )

  // 查找替换：handle 每次经 ref 取最新值（替换后 reloadToken 重挂载，旧 handle 失效）
  const getActiveHandle = useCallback((): EditorHandle | SourceEditorHandle | null => {
    const state = useAppStore.getState()
    const current = state.docs.find((doc) => doc.id === state.activeDocId) ?? null
    if (current === null) return null
    return state.mode === 'wysiwyg' ? editorHandle.current : sourceHandle.current
  }, [])

  const navigateToOffset = useCallback(
    (from: number, to: number) => {
      const handle = getActiveHandle()
      if (handle === null) return
      handle.setSelectionOffsets(from, to)
      handle.focus()
    },
    [getActiveHandle],
  )

  const replaceRange = useCallback((from: number, to: number, replacement: string) => {
    const state = useAppStore.getState()
    const doc = state.docs.find((item) => item.id === state.activeDocId) ?? null
    if (doc === null) return
    doc.replaceText({ from, to }, replacement)
    setReloadToken((token) => token + 1)
    bumpDirtyTick((tick) => tick + 1)
  }, [])

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
    const state = useAppStore.getState()
    const current = state.docs.find((doc) => doc.id === state.activeDocId) ?? null
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

  // Ruling-7：全库无 dirty 时删除崩溃快照（保存成功 / 关 dirty tab 后触发）。
  const invalidateSnapshotIfClean = useCallback(async () => {
    if (useAppStore.getState().docs.some((doc) => doc.isDirty)) return
    hadDirtyRef.current = false
    await ipc.removeSession().catch(() => {})
  }, [])

  const openFile = useCallback(
    async (path: string) => {
      try {
        const existing = useAppStore.getState().docs.find((doc) => doc.path === path)
        if (existing !== undefined) {
          useAppStore.getState().setActiveDoc(existing.id)
          setStatus(`已打开 ${path}`)
          return
        }
        const content = await ipc.readFile(path)
        await ipc.watchFile(path)
        useAppStore.getState().openDoc(
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
        setExternalNotice(null)
        setStatus(`打开失败：${toStatusMessage(error)}`)
      }
    },
    [setExternalNotice],
  )

  const save = useCallback(async () => {
    const state = useAppStore.getState()
    const current = state.docs.find((doc) => doc.id === state.activeDocId) ?? null
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
      bumpDirtyTick((tick) => tick + 1)
      setStatus('已保存')
      void invalidateSnapshotIfClean()
    } catch (error) {
      console.error('[app] save failed', error)
      setStatus('保存失败，请重试')
    }
  }, [invalidateSnapshotIfClean])

  const closeTab = useCallback(
    (target: { id: string; path: string | null; isDirty: boolean }) => {
      if (target.isDirty) {
        setPendingClose({ kind: 'tab', id: target.id })
        return
      }
      useAppStore.getState().closeDoc(target.id)
      if (target.path !== null) {
        void ipc.unwatchFile(target.path).catch(() => {})
        removePendingExternalPath(target.path)
      }
      void invalidateSnapshotIfClean()
    },
    [invalidateSnapshotIfClean, removePendingExternalPath],
  )

  const confirmPendingClose = useCallback(() => {
    const pending = pendingClose
    if (pending === null) return
    void (async () => {
      if (pending.kind === 'tab') {
        const target = useAppStore.getState().docs.find((doc) => doc.id === pending.id)
        useAppStore.getState().closeDoc(pending.id)
        if (target?.path !== undefined && target.path !== null) {
          await ipc.unwatchFile(target.path).catch(() => {})
          removePendingExternalPath(target.path)
        }
      } else {
        await ipc.confirmClose()
        return
      }
      void invalidateSnapshotIfClean()
      setPendingClose(null)
    })()
  }, [invalidateSnapshotIfClean, pendingClose, removePendingExternalPath])

  useEffect(() => {
    setEditorReady(false)
  }, [activeDoc, reloadToken])

  useEffect(() => {
    void ipc
      .getAppInfo()
      .then(setInfo)
      .catch(() => setInfo(null))
  }, [])

  // ADR-7 崩溃恢复：仅当本次启动不带 --open 时，从 userData session.json 逐 tab 还原。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const appInfo = await ipc.getAppInfo()
        if (appInfo.hasCliOpen || cancelled) return
        const snapshot = await ipc.loadSession()
        if (snapshot === null || cancelled || snapshot.version !== 1) return
        // 磁盘上已存在快照：hadDirty 记为 true，恢复后关 tab/保存也走失效逻辑。
        hadDirtyRef.current = true
        let restored = 0
        for (const tab of snapshot.tabs) {
          if (cancelled) return
          // 文件缺失 → 跳过该 tab；openDoc 保证同 path 去重。
          const content = await ipc.readFile(tab.path).catch(() => null)
          if (content === null) continue
          const hasSnapshotText = typeof tab.text === 'string'
          useAppStore.getState().openDoc(
            new MdDocument({
              id: `${tab.path}#${Date.now()}`,
              path: tab.path,
              text: tab.dirty && hasSnapshotText ? tab.text : content.text,
              originalBytesBase64: content.base64, // 还原时以磁盘内容为 original
              eol: content.eol,
              hasBom: content.hasBom,
              dirty: tab.dirty && hasSnapshotText,
            }),
          )
          await ipc.watchFile(tab.path)
          restored += 1
        }
        if (cancelled || restored === 0) return
        setReloadToken((token) => token + 1)
        // 按 snapshot.activePath 激活对应 tab（找不到则保持最后打开的 tab）。
        if (typeof snapshot.activePath === 'string') {
          const target = useAppStore.getState().docs.find((doc) => doc.path === snapshot.activePath)
          if (target !== undefined) useAppStore.getState().setActiveDoc(target.id)
        }
        setStatus('已恢复未保存的会话')
      } catch (error) {
        console.error('[app] session restore failed', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ADR-7 周期快照：每 5s，存在 dirty doc 时写入 userData session.json。
  useEffect(() => {
    const saveSnapshot = async (): Promise<void> => {
      const state = useAppStore.getState()
      const hasDirty = state.docs.some((doc) => doc.isDirty)
      if (!hasDirty) {
        // 全库干净：清掉残留快照（此前有过 dirty 才需要）。
        if (hadDirtyRef.current) {
          hadDirtyRef.current = false
          await ipc.removeSession().catch(() => {})
        }
        return
      }
      hadDirtyRef.current = true
      const active = state.docs.find((doc) => doc.id === state.activeDocId) ?? null
      const payload = JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        activePath: active?.path ?? null,
        tabs: state.docs
          .filter((doc) => doc.path !== null)
          .map((doc) => ({ path: doc.path, dirty: doc.isDirty, text: doc.text })),
      })
      await ipc.saveSession(payload).catch(() => {})
    }
    const timer = window.setInterval(() => {
      void saveSnapshot()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const unsubscribe = ipc.onOpenFile((path) => {
      void openFile(path)
    })
    return unsubscribe
  }, [openFile])

  useEffect(() => {
    const unsubscribe = ipc.onExternalModified((path) => {
      void (async () => {
        const state = useAppStore.getState()
        const target = state.docs.find((doc) => doc.path === path)
        if (target === undefined) return
        const isActive = target.id === state.activeDocId
        if (target.isDirty) {
          addPendingExternalPath(path)
          return
        }
        try {
          const content = await ipc.readFile(path)
          // readFile 期间用户可能已编辑；不能把脏 Buffer 覆盖掉。
          if (target.isDirty) {
            addPendingExternalPath(path)
            return
          }
          clearHistory(target.id)
          target.setExternalText(content.text, content.base64)
          if (isActive) {
            setReloadToken((token) => token + 1)
            setExternalNotice(null)
            setStatus('已自动重载外部修改')
          }
          void invalidateSnapshotIfClean()
        } catch (error) {
          console.error('[app] reload external change failed', error)
          setStatus(`打开失败：${toStatusMessage(error)}`)
        }
      })()
    })
    return unsubscribe
  }, [addPendingExternalPath, invalidateSnapshotIfClean, setExternalNotice])

  const confirmExternalReload = useCallback(() => {
    const path = activePendingExternalPath
    if (path === null) return
    removePendingExternalPath(path)
    const state = useAppStore.getState()
    const current = state.docs.find((doc) => doc.id === state.activeDocId) ?? null
    if (current === null || current.path !== path) return
    void (async () => {
      try {
        const content = await ipc.readFile(path)
        clearHistory(current.id)
        current.setExternalText(content.text, content.base64)
        setReloadToken((token) => token + 1)
        setExternalNotice(null)
        setStatus('已自动重载外部修改')
        void invalidateSnapshotIfClean()
      } catch (error) {
        console.error('[app] reload external change failed', error)
        setStatus(`打开失败：${toStatusMessage(error)}`)
      }
    })()
  }, [
    activePendingExternalPath,
    invalidateSnapshotIfClean,
    removePendingExternalPath,
    setExternalNotice,
  ])

  const cancelExternalKeep = useCallback(() => {
    const path = activePendingExternalPath
    if (path === null) return
    removePendingExternalPath(path)
    setExternalNotice('已保留我的修改；请尽快另存或关闭该文件')
    setStatus('已保留我的修改；请尽快另存或关闭该文件')
  }, [activePendingExternalPath, removePendingExternalPath, setExternalNotice])

  useEffect(() => {
    const unsubscribe = ipc.onCloseGuardRequest(() => {
      const hasDirty = useAppStore.getState().docs.some((doc) => doc.isDirty)
      if (!hasDirty) {
        void ipc.confirmClose()
        return
      }
      setPendingClose({ kind: 'window' })
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = ipc.onOpenWorkspace((dir) => {
      workspaceDirRef.current = dir
      void ipc.openWorkspace(dir)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribeTree = ipc.onWorkspaceTree((nodes) => {
      setWorkspaceNodes(nodes)
    })
    const unsubscribeUpdate = ipc.onWorkspaceUpdate(({ added, removed }) => {
      if (removed.length > 0) {
        // 目录被清空等结构性变化：重新 openWorkspace 拉全量树，避免主进程树 diff。
        const dir = workspaceDirRef.current
        if (dir !== null) void ipc.openWorkspace(dir)
        return
      }
      if (added.length > 0) {
        const dir = workspaceDirRef.current
        setWorkspaceNodes((nodes) =>
          dir === null || nodes === null ? nodes : insertIntoTree(nodes, added, dir),
        )
      }
    })
    return () => {
      unsubscribeTree()
      unsubscribeUpdate()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setFindOpen(false)
        return
      }
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'f') {
        // capture 阶段拦截 Ctrl+F：浏览器/编辑器默认查找不生效，统一开工作台面板
        event.preventDefault()
        event.stopPropagation()
        setFindOpen(true)
        return
      }
      if (key !== 's' && event.key !== '/') return
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
          {activeDoc?.isDirty === true ? '未保存 · ' : ''}
          {status}
        </span>
        <button type="button" data-testid="mode-toggle" onClick={toggleMode}>
          编辑模式：{mode === 'wysiwyg' ? '所见即所得' : '源码'}
        </button>
      </header>
      <nav className="tabbar">
        {docs.map((doc) => (
          <div
            key={doc.id}
            className="tab"
            data-testid="tab"
            data-active={doc.id === activeDocId ? 'true' : undefined}
            data-dirty={doc.isDirty || undefined}
          >
            <button type="button" className="tab-title" onClick={() => setActiveDoc(doc.id)}>
              {tabTitle(doc.path)}
            </button>
            <button
              type="button"
              className="tab-close"
              aria-label={`关闭 ${tabTitle(doc.path)}`}
              data-testid="tab-close"
              onClick={() => closeTab(doc)}
            >
              ×
            </button>
          </div>
        ))}
      </nav>
      {findOpen && activeDoc !== null ? (
        <FindReplacePanel
          text={activeDoc.text}
          onClose={() => setFindOpen(false)}
          onNavigate={navigateToOffset}
          onReplace={replaceRange}
          onReplaceAll={replaceRange}
        />
      ) : null}
      <p data-testid="app-info">
        {info === null ? '加载中…' : `md-editor ${info.version} · Electron ${info.electron}`}
      </p>
      {externalNotice !== null ? <p className="notice">{externalNotice}</p> : null}
      <div className="main-row">
        <aside className="sidebar">
          {workspaceNodes === null ? (
            <p className="sidebar-empty">打开文件夹以浏览 Markdown 文件</p>
          ) : (
            <FileTree nodes={workspaceNodes} onOpenFile={(path) => void openFile(path)} />
          )}
        </aside>
        <section className="editor-host" data-editor-ready={editorReady ? 'true' : undefined}>
          {activeDoc === null ? (
            <p className="placeholder">正在等待文件…</p>
          ) : mode === 'wysiwyg' ? (
            <EditorHost
              key={`${activeDoc.id}-${reloadToken}`}
              docId={activeDoc.id}
              initialMarkdown={activeDoc.text}
              onMarkdownChange={(markdown) => {
                activeDoc.applyEditorMarkdown(markdown)
                bumpDirtyTick((tick) => tick + 1)
              }}
              initialSelection={pendingSelection.current}
              onSelectionApplied={() => {
                pendingSelection.current = null
              }}
              onReady={(handle) => {
                editorHandle.current = handle
                setEditorReady(true)
              }}
              onPasteAsset={onPasteAsset}
              getBufferText={() => activeDoc.text}
              onCursorChange={onCursorChange}
            />
          ) : (
            <SourceEditor
              key={`${activeDoc.id}-${reloadToken}`}
              initialMarkdown={activeDoc.text}
              initialScrollRatio={pendingScrollRatio.current}
              onMarkdownChange={(markdown) => {
                activeDoc.applyEditorMarkdown(markdown)
                bumpDirtyTick((tick) => tick + 1)
              }}
              getBufferText={() => activeDoc.text}
              onCursorChange={onCursorChange}
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
        <aside className="sidebar outline-sidebar" data-testid="outline-panel">
          <OutlinePanel
            markdown={activeDoc?.text ?? ''}
            cursorOffset={cursorOffset}
            onJump={jumpToOutlineItem}
          />
        </aside>
      </div>
      {pendingClose !== null ? (
        <Modal
          message={
            pendingClose.kind === 'window'
              ? '有未保存的更改，确定放弃更改并关闭窗口吗？'
              : '该文档有未保存的更改，确定放弃更改并关闭吗？'
          }
          confirmLabel="放弃更改并关闭"
          cancelLabel="取消"
          onConfirm={confirmPendingClose}
          onCancel={() => setPendingClose(null)}
        />
      ) : activePendingExternalPath !== null ? (
        <Modal
          message="文件已被外部修改，请选择重载外部内容或保留我的修改"
          confirmLabel="重载外部内容"
          cancelLabel="保留我的修改"
          onConfirm={confirmExternalReload}
          onCancel={cancelExternalKeep}
        />
      ) : null}
    </main>
  )
}
