import {
  clearHistory,
  EditorHost,
  SourceEditor,
  type EditorHandle,
  type OutlineItem,
  type SourceEditorHandle,
} from '@md-editor/editor'
import { useCallback, useEffect, useRef, useState } from 'react'
import { applyTheme, themeCss } from '@md-editor/theming'
import { buildStandaloneHtml } from '@md-editor/export'
import { MdDocument } from './document/MdDocument'
import { hasInlineDataUriImages, toInlineDataUri } from './document/dataUri'
import { ipc } from './ipc'
import { useAppStore } from './state/appStore'
import { FileTree, insertIntoTree } from './ui/FileTree'
import { OutlinePanel } from './ui/OutlinePanel'
import { Modal } from './ui/Modal'
import { FindReplacePanel } from './ui/FindReplacePanel'
import { useCaptureKeydown } from './ui/useCaptureKeydown'
import { SettingsPanel } from './ui/SettingsPanel'
import { AboutDialog } from './ui/AboutDialog'
import { FormatToolbar } from './ui/FormatToolbar'
import { SidebarToggle } from './ui/SidebarToggle'
import { StatusBar } from './ui/StatusBar'
import { t } from './i18n'
import type { FormatCommandArgs, FormatCommandName } from '@md-editor/editor'
import { isAssetExt } from '../../../electron/shared/asset'
import type { AppSettings, ThemeId } from '../../../electron/shared/settings'
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
  if (path === null) return t('unnamed')
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 1] ?? path
}

const PDF_SAVE_FILTERS = [{ name: 'PDF', extensions: ['pdf'] }]

function pdfExportName(path: string | null): string {
  return `${tabTitle(path).replace(/\.(md|markdown)$/i, '')}.pdf`
}

const HTML_SAVE_FILTERS = [{ name: 'HTML', extensions: ['html'] }]

function htmlExportName(path: string | null): string {
  return `${tabTitle(path).replace(/\.(md|markdown)$/i, '')}.html`
}

function exportTitle(path: string | null): string {
  return tabTitle(path).replace(/\.(md|markdown)$/i, '')
}

/**
 * 文档相对路径图片 -> data URI（缺失/越权/非图片返回 null）。
 * 导出 HTML 内联与 WYSIWYG 编辑器显示共用同一实现。
 */
async function resolveDocImage(path: string | null, src: string): Promise<string | null> {
  if (path === null) return null
  const clean = src.split(/[?#]/)[0] ?? ''
  const ext = clean.slice(clean.lastIndexOf('.') + 1).toLowerCase()
  if (!isAssetExt(ext)) return null
  try {
    const { base64 } = await ipc.readAssetFile(path, clean)
    const mime = ext === 'jpg' ? 'jpeg' : ext
    return `data:image/${mime};base64,${base64}`
  } catch {
    // 文件缺失/非图片：保留相对链接，不阻塞导出。
    return null
  }
}

/** PDF 与 HTML 共用 buildStandaloneHtml 产出（主题 CSS / 图片内联 / CSP）。 */
async function buildExportHtml(
  text: string,
  path: string | null,
  themeId: ThemeId,
): Promise<string> {
  return buildStandaloneHtml(text, {
    themeCss: themeCss(themeId),
    inlineImages: true,
    title: exportTitle(path),
    inlineImage: (src) => resolveDocImage(path, src),
  })
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
  const [status, setStatus] = useState(t('statusNoFile'))
  const [editorReady, setEditorReady] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [cursorOffset, setCursorOffset] = useState<number | null>(null)
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null)
  const [pendingExternalPaths, setPendingExternalPaths] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )
  const [findOpen, setFindOpen] = useState(false)
  const [settings, setSettingsState] = useState<AppSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  // Ruling-7：上次快照时是否存在 dirty doc；全库转干净后需删快照。
  const hadDirtyRef = useRef(false)
  // MdDocument 是可变对象，脏变化不会触发 zustand；靠 tick 重渲染读取 isDirty。
  const [, bumpDirtyTick] = useState(0)
  const [info, setInfo] = useState<{
    version: string
    electron: string
    chromium: string
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
      // 裁定问题④：未命名文档粘贴图片直接内嵌 data URI，不强制先保存；
      // Buffer 走 onMarkdownChange 标脏，保存时不自动改写（R1 铁律）。
      setStatus(t('statusImageInserted'))
      return toInlineDataUri(mime, base64)
    }
    const ext = ASSET_EXT_BY_MIME[mime]
    if (ext === undefined) {
      setStatus(t('statusUnsupportedImage'))
      throw new Error(t('statusUnsupportedImage'))
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

  // 菜单「打开...」：主进程命令 -> renderer 弹原生打开对话框 -> 复用 openFile 流程。
  const openFromMenu = useCallback(async () => {
    let chosen: string | null = null
    try {
      chosen = await ipc.showOpenDialog()
    } catch (error) {
      console.error('[app] open dialog failed', error)
      setStatus(t('statusOpenFailed'))
      return
    }
    if (chosen === null) {
      setStatus(t('statusOpenCancelled'))
      return
    }
    await openFile(chosen)
  }, [openFile])

  const newNote = useCallback(() => {
    const doc = new MdDocument({
      id: `untitled#${Date.now()}#${Math.random().toString(36).slice(2, 8)}`,
      path: null,
      text: '',
      originalBytesBase64: '',
      eol: 'lf',
      hasBom: false,
    })
    useAppStore.getState().openDoc(doc)
    setExternalNotice(null)
    setStatus(t('statusNewNote'))
  }, [setExternalNotice])

  const saveAs = useCallback(async () => {
    const state = useAppStore.getState()
    const current = state.docs.find((doc) => doc.id === state.activeDocId) ?? null
    if (current === null) return
    editorHandle.current?.flushNow()
    sourceHandle.current?.flushNow()
    let chosen: string | null
    try {
      chosen = await ipc.showSaveDialog(tabTitle(current.path))
    } catch (error) {
      console.error('[app] save dialog failed', error)
      setStatus(t('statusSaveAsFailed'))
      return
    }
    if (chosen === null) {
      setStatus(t('statusSaveAsCancelled'))
      return
    }
    // 另存为是显式落盘意图：即使零编辑（新建未命名笔记）也要写出文件。
    const bytes = current.bytesForSave() ?? current.bytesForSaveAs()
    try {
      const credential = await ipc.writeFile(chosen, bytes)
      current.markSaved(credential)
      useAppStore.getState().replaceDoc(current.withPath(chosen))
      await ipc.watchFile(chosen).catch(() => {})
      const savedText = current.text
      setStatus(
        hasInlineDataUriImages(savedText)
          ? `已另存为 ${chosen}（图片当前为内嵌 data URI，可手动保留或后续迁移到 assets）`
          : `已另存为 ${chosen}`,
      )
      void invalidateSnapshotIfClean()
    } catch (error) {
      console.error('[app] saveAs failed', error)
      setStatus(t('statusSaveFailed'))
    }
  }, [invalidateSnapshotIfClean])

  const exportPdfFromMenu = useCallback(async () => {
    const state = useAppStore.getState()
    const current = state.docs.find((doc) => doc.id === state.activeDocId) ?? null
    if (current === null) return
    editorHandle.current?.flushNow()
    sourceHandle.current?.flushNow()
    let chosen: string | null
    try {
      chosen = await ipc.showSaveDialog(
        pdfExportName(current.path),
        PDF_SAVE_FILTERS,
        t('exportPdfTitle'),
      )
    } catch (error) {
      console.error('[app] export pdf dialog failed', error)
      setStatus(t('statusExportPdfFailed'))
      return
    }
    if (chosen === null) {
      setStatus(t('statusExportPdfCancelled'))
      return
    }
    try {
      const html = await buildExportHtml(
        current.text,
        current.path,
        settings?.themeId ?? 'github-light',
      )
      await ipc.exportPdf(chosen, html)
      setStatus(`已导出 PDF ${chosen}`)
    } catch (error) {
      console.error('[app] export pdf failed', error)
      setStatus(`导出 PDF 失败：${toStatusMessage(error)}`)
    }
  }, [settings])

  const exportHtmlFromMenu = useCallback(async () => {
    const state = useAppStore.getState()
    const current = state.docs.find((doc) => doc.id === state.activeDocId) ?? null
    if (current === null) return
    editorHandle.current?.flushNow()
    sourceHandle.current?.flushNow()
    let chosen: string | null
    try {
      chosen = await ipc.showSaveDialog(
        htmlExportName(current.path),
        HTML_SAVE_FILTERS,
        t('exportHtmlTitle'),
      )
    } catch (error) {
      console.error('[app] export html dialog failed', error)
      setStatus(t('statusExportHtmlFailed'))
      return
    }
    if (chosen === null) {
      setStatus(t('statusExportHtmlCancelled'))
      return
    }
    try {
      const html = await buildExportHtml(
        current.text,
        current.path,
        settings?.themeId ?? 'github-light',
      )
      await ipc.exportHtml(chosen, html)
      setStatus(`已导出 HTML ${chosen}`)
    } catch (error) {
      console.error('[app] export html failed', error)
      setStatus(`导出 HTML 失败：${toStatusMessage(error)}`)
    }
  }, [settings])

  const save = useCallback(async () => {
    const state = useAppStore.getState()
    const current = state.docs.find((doc) => doc.id === state.activeDocId) ?? null
    if (current === null) return
    // 无路径 tab（新建未命名笔记）：Ctrl+S 自动转另存为。
    if (current.path === null) {
      await saveAs()
      return
    }
    editorHandle.current?.flushNow()
    const bytes = current.bytesForSave()
    if (bytes === null) {
      setStatus(t('statusNoChangesSkipped'))
      return
    }
    try {
      const credential = await ipc.writeFile(current.path, bytes)
      current.markSaved(credential)
      bumpDirtyTick((tick) => tick + 1)
      setStatus(t('statusSaved'))
      void invalidateSnapshotIfClean()
    } catch (error) {
      console.error('[app] save failed', error)
      setStatus(t('statusSaveFailed'))
    }
  }, [invalidateSnapshotIfClean, saveAs])

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
        // Ruling-11：放弃更改并关闭窗口前立即失效快照，避免崩溃后复活已放弃内容。
        await ipc.removeSession().catch(() => {})
        hadDirtyRef.current = false
        await ipc.confirmClose()
        return
      }
      void invalidateSnapshotIfClean()
      setPendingClose(null)
    })()
  }, [invalidateSnapshotIfClean, pendingClose, removePendingExternalPath])

  useEffect(() => {
    setEditorReady(false)
  }, [activeDocId, reloadToken])

  useEffect(() => {
    void ipc
      .getAppInfo()
      .then(setInfo)
      .catch(() => setInfo(null))
  }, [])

  // M4：启动读取 settings.themeId 应用主题，并跟随 settingsChanged 广播切换。
  useEffect(() => {
    let cancelled = false
    void ipc
      .getSettings()
      .then((settings) => {
        if (!cancelled) {
          applyTheme(settings.themeId)
          setSettingsState(settings)
          setSidebarCollapsed(settings.sidebarCollapsed)
        }
      })
      .catch(() => undefined)
    const unsubscribe = ipc.onSettingsChanged((settings) => {
      applyTheme(settings.themeId)
      setSettingsState(settings)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
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
        setStatus(t('statusSessionRestored'))
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
    // 原生菜单命令通道：new-note / open / save-as / export-pdf 接线。
    const unsubscribe = ipc.onMenuCommand((cmd) => {
      if (cmd === 'new-note') {
        newNote()
      } else if (cmd === 'open') {
        void openFromMenu()
      } else if (cmd === 'save-as') {
        void saveAs()
      } else if (cmd === 'export-pdf') {
        void exportPdfFromMenu()
      } else if (cmd === 'export-html') {
        void exportHtmlFromMenu()
      } else if (cmd === 'about') {
        setAboutOpen(true)
      }
    })
    return unsubscribe
  }, [newNote, openFromMenu, saveAs, exportPdfFromMenu, exportHtmlFromMenu])

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
            setStatus(t('statusAutoReloaded'))
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
        setStatus(t('statusAutoReloaded'))
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
    setExternalNotice(t('statusKeptMyChanges'))
    setStatus(t('statusKeptMyChanges'))
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

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      void ipc
        .getSettings()
        .then((current) => ipc.setSettings({ ...current, sidebarCollapsed: next }))
        .catch(() => undefined)
      return next
    })
  }, [])

  const changeTheme = useCallback((themeId: ThemeId) => {
    setSettingsState((prev) => {
      if (prev === null) return prev
      void ipc.setSettings({ ...prev, themeId }).then((next) => setSettingsState(next))
      return { ...prev, themeId }
    })
  }, [])

  const changePrintBackground = useCallback((printBackground: boolean) => {
    setSettingsState((prev) => {
      if (prev === null) return prev
      const next = { ...prev, export: { pdf: { printBackground } } }
      void ipc.setSettings(next).then((effective) => setSettingsState(effective))
      return next
    })
  }, [])

  // 全局快捷键只保留 renderer 单通道：F11 全屏走原生菜单 accelerator，不在 renderer 重复处理。
  // （Ctrl+/ 必须留在 renderer capture：CodeMirror 默认把 Ctrl+/ 绑定为切换注释。）
  useCaptureKeydown((event) => {
    if (event.key === 'Escape') {
      setFindOpen(false)
      return
    }
    if (!(event.ctrlKey || event.metaKey)) return
    const key = event.key.toLowerCase()
    if (key === '\\') {
      // Ctrl+\：折叠/展开侧栏（window capture 层统一快捷键语义）
      event.preventDefault()
      event.stopPropagation()
      toggleSidebar()
      return
    }
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
  })

  return (
    <main className="workspace">
      {activeDoc !== null ? (
        <FormatToolbar
          disabled={!editorReady}
          onCommand={(name: FormatCommandName, args?: FormatCommandArgs) => {
            const handle =
              mode === 'wysiwyg' ? editorHandle.current : (sourceHandle.current ?? undefined)
            handle?.runCommand(name, args)
          }}
        />
      ) : null}

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
      {externalNotice !== null ? <p className="notice">{externalNotice}</p> : null}
      <div className="main-row">
        <aside
          data-testid="file-sidebar"
          className={sidebarCollapsed ? 'sidebar collapsed' : 'sidebar'}
        >
          <div className="sidebar-header">
            <SidebarToggle collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
          </div>
          {!sidebarCollapsed ? (
            workspaceNodes === null ? (
              <button
                type="button"
                className="sidebar-empty"
                data-testid="sidebar-empty"
                onClick={() => {
                  void ipc.showOpenDirDialog().then((dir) => {
                    if (dir !== null) return ipc.openWorkspace(dir)
                  })
                }}
              >
                {t('sidebarEmpty')}
              </button>
            ) : (
              <FileTree nodes={workspaceNodes} onOpenFile={(path) => void openFile(path)} />
            )
          ) : null}
        </aside>
        <section className="editor-host" data-editor-ready={editorReady ? 'true' : undefined}>
          {activeDoc === null ? (
            <p className="placeholder">{t('editorEmpty')}</p>
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
              resolveImageSrc={(src) => resolveDocImage(activeDoc.path, src)}
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
          message={pendingClose.kind === 'window' ? t('modalDiscardWindow') : t('modalDiscardTab')}
          confirmLabel={t('discardAndClose')}
          cancelLabel={t('cancel')}
          onConfirm={confirmPendingClose}
          onCancel={() => setPendingClose(null)}
        />
      ) : activePendingExternalPath !== null ? (
        <Modal
          message={t('modalExternalModified')}
          confirmLabel={t('reloadExternal')}
          cancelLabel={t('keepMyChanges')}
          onConfirm={confirmExternalReload}
          onCancel={cancelExternalKeep}
        />
      ) : null}
      {aboutOpen && info !== null ? (
        <AboutDialog
          version={info.version}
          electron={info.electron}
          chromium={info.chromium}
          onClose={() => setAboutOpen(false)}
        />
      ) : null}
      {settingsOpen && settings !== null ? (
        <SettingsPanel
          initialTheme={settings.themeId}
          printBackground={settings.export.pdf.printBackground}
          onChangeTheme={changeTheme}
          onChangePrintBackground={changePrintBackground}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      <StatusBar
        status={status}
        dirty={activeDoc?.isDirty === true}
        mode={mode}
        onToggleMode={toggleMode}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    </main>
  )
}
