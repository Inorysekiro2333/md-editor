import { useEffect, useState } from 'react'
import type { AppInfo } from './bridge'

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.mdEditor.getAppInfo().then(setInfo)
  }, [])

  return (
    <main className="workspace">
      <p data-testid="app-info">
        {info === null ? '加载中…' : `md-editor ${info.version} · Electron ${info.electron}`}
      </p>
    </main>
  )
}
