import type { AppUpdater } from 'electron-updater'
import { app, dialog } from 'electron'

export interface UpdaterDeps {
  autoUpdater: AppUpdater
  setTimeoutFn: typeof setTimeout
  logger: (msg: string) => void
}

const CHECK_DELAY_MS = 10_000

const UPDATE_READY_DIALOG_OPTIONS = {
  type: 'info' as const,
  title: '更新已就绪',
  message: '新版本已下载完成，是否重启并安装？',
  buttons: ['重启安装', '稍后'],
  defaultId: 0,
  cancelId: 1,
}

/**
 * 主进程内闭环的自动更新：渲染进程零新 IPC，v1 更新交互只走原生 dialog。
 * dev（未打包）或 MD_EDITOR_DISABLE_UPDATER=1 时不注册监听、不联网。
 */
export function initUpdater(
  getWindow: () => Electron.BrowserWindow | null,
  deps?: Partial<UpdaterDeps>,
): void {
  if (!app.isPackaged || process.env.MD_EDITOR_DISABLE_UPDATER === '1') {
    deps?.logger?.('updater disabled: dev mode or MD_EDITOR_DISABLE_UPDATER=1')
    return
  }
  const logger = deps?.logger ?? (() => {})
  if (!deps?.autoUpdater) {
    throw new Error('initUpdater requires autoUpdater dep when packaged')
  }
  const autoUpdater = deps.autoUpdater

  autoUpdater.on('update-downloaded', () => {
    const win = getWindow()
    const dialogPromise =
      win === null
        ? dialog.showMessageBox(UPDATE_READY_DIALOG_OPTIONS)
        : dialog.showMessageBox(win, UPDATE_READY_DIALOG_OPTIONS)
    void dialogPromise
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
      .catch((err: unknown) => logger(`updater dialog failed: ${String(err)}`))
  })

  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout
  setTimeoutFn(() => {
    void autoUpdater
      .checkForUpdates()
      .catch((err: unknown) => logger(`checkForUpdates failed: ${String(err)}`))
  }, CHECK_DELAY_MS)
}
