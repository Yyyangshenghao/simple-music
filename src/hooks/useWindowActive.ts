import { useEffect, useState } from 'react'

/**
 * 窗口是否"活跃"(页面可见且窗口聚焦)。
 * 本项目全局关闭了 Chromium backgroundThrottling,窗口最小化/被遮挡/失焦后
 * rAF 仍以满刷新率触发,重渲染循环(WebGL 场景等)需要据此自行暂停,
 * 与 LiquidEther 内置的 blur/visibility 暂停策略保持一致。
 */
export function useWindowActive(): boolean {
  const [active, setActive] = useState(
    () => !document.hidden && document.hasFocus()
  )

  useEffect(() => {
    const update = () => setActive(!document.hidden && document.hasFocus())
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  return active
}
