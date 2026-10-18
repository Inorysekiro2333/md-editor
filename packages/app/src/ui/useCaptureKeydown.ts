import { useEffect, useRef } from 'react'

/**
 * window 捕获阶段 keydown 监听：注册一次、经 ref 派发最新 handler。
 * add/remove 必须使用同一 capture 标志，否则监听器永远移除不掉
 * （StrictMode 双挂载 / 依赖重跑时会累积成多个监听器，一次按键触发多次 save）。
 */
export function useCaptureKeydown(handler: (event: KeyboardEvent) => void): void {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      handlerRef.current(event)
    }
    window.addEventListener('keydown', listener, true)
    return () => {
      window.removeEventListener('keydown', listener, true)
    }
  }, [])
}
