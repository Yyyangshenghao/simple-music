import { useEffect, useState } from 'react'

/** 最小化/隐藏始终算停帧；失焦是否算，由用户的「失焦时暂停」决定。 */
function resolveInactive(pauseOnBlur: boolean): boolean {
  if (typeof document === 'undefined') return false
  return document.hidden || (pauseOnBlur && !document.hasFocus())
}

/**
 * 背景是否应因窗口状态停帧。关闭暂停后，切换到其他窗口（背景仍在副屏可见）时继续播放；
 * 最小化或隐藏窗口时依旧停帧，此时画面不可见，继续渲染只会白耗 GPU。
 */
export function useBackgroundInactive(pauseOnBlur: boolean): boolean {
  const [inactive, setInactive] = useState(() => resolveInactive(pauseOnBlur))
  useEffect(() => {
    const sync = () => setInactive(resolveInactive(pauseOnBlur))
    // 切换开关时立即按当前窗口状态对齐，不必等下一次焦点事件。
    sync()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
    }
  }, [pauseOnBlur])
  return inactive
}
