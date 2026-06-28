import type { ReactNode } from 'react'
import { useWindowStore } from '../../stores/window'
import styles from './WindowChrome.module.css'

interface WindowChromeProps {
  children: ReactNode
}

/**
 * 窗口外壳容器：包裹整窗内容，提供沉浸式深色玻璃边框与圆角。
 * - 普通 / 最大化窗口：圆角 + 边框 + 阴影。
 * - 全屏（isFullScreen）：去掉圆角、边框与留白，铺满整屏。
 */
export function WindowChrome({ children }: WindowChromeProps) {
  const isFullScreen = useWindowStore((s) => s.isFullScreen)
  const isFocused = useWindowStore((s) => s.isFocused)

  const className = [
    styles.chrome,
    isFullScreen ? styles.fullScreen : '',
    isFocused ? styles.focused : ''
  ]
    .filter(Boolean)
    .join(' ')

  return <div className={className}>{children}</div>
}
