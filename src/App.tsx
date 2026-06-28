import { useEffect, useState } from 'react'
import { useDesktopBridge } from './hooks/useDesktopBridge'
import { useAudio } from './hooks/useAudio'
import { useWindowStore } from './stores/window'
import { useSettingsStore } from './stores/settings'

export default function App() {
  const [port, setPort] = useState<number | null>(null)
  const isMaximized = useWindowStore((s) => s.isMaximized)

  useDesktopBridge()
  useAudio()

  useEffect(() => {
    setPort(window.desktop?.serverPort ?? null)
    useSettingsStore.getState().loadFromLocal()
  }, [])

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12
      }}
    >
      <h1 style={{ margin: 0, fontWeight: 600, letterSpacing: 2 }}>Mineradio-Next</h1>
      <p style={{ opacity: 0.6, fontSize: 13 }}>
        渲染层基础就绪 · API 端口 {port ?? '...'} · 窗口{isMaximized ? '已最大化' : '正常'}
      </p>
      <button
        className="no-drag"
        style={{
          marginTop: 8,
          padding: '6px 16px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(255,255,255,0.06)',
          color: '#e8ecf2',
          cursor: 'pointer'
        }}
        onClick={() => window.desktop?.minimize()}
      >
        最小化（测试 IPC）
      </button>
    </div>
  )
}
