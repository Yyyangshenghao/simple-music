import { useEffect, useRef, useState } from 'react'
import type { DevMetricsSnapshot } from '../../types/dev-metrics'
import styles from './DevMetricsHud.module.css'

// 仅开发模式挂载（App.tsx 按 import.meta.env.DEV 懒加载），打包产物不含本组件。

const STORAGE_KEY = 'simplemusic-dev-hud'
const INTERVAL = 1000
const HISTORY = 60

interface HudPrefs { hidden: boolean; expanded: boolean; fps: boolean }

function readPrefs(): HudPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<HudPrefs>
    return { hidden: !!parsed.hidden, expanded: !!parsed.expanded, fps: !!parsed.fps }
  } catch { return { hidden: false, expanded: false, fps: false } }
}

function writePrefs(prefs: HudPrefs): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)) } catch { /* 无存储时只在本次生效 */ }
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 1024 ** 3 ? 0 : 1)} MB`
}

function kbToMb(kb: number): string {
  return mb(kb * 1024)
}

function pct(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

function Sparkline({ values, max }: { values: number[]; max: number }) {
  if (values.length < 2) return <svg className={styles.spark} />
  const top = Math.max(max, ...values, 1)
  const points = values.map((v, i) => `${(i / (HISTORY - 1)) * 100},${30 - (v / top) * 28}`).join(' ')
  return (
    <svg className={styles.spark} viewBox="0 0 100 30" preserveAspectRatio="none">
      <polyline points={points} />
    </svg>
  )
}

/** 帧率需要持续 rAF，会让空闲页面也保持出帧，所以默认关闭、手动开启。 */
function useFps(enabled: boolean): number | null {
  const [fps, setFps] = useState<number | null>(null)
  useEffect(() => {
    if (!enabled) { setFps(null); return }
    let frames = 0
    let last = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      frames += 1
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)))
        frames = 0
        last = now
      }
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [enabled])
  return fps
}

function jsHeap(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return memory ? memory.usedJSHeapSize : null
}

export default function DevMetricsHud() {
  const [prefs, setPrefs] = useState(readPrefs)
  const [snapshot, setSnapshot] = useState<DevMetricsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [heap, setHeap] = useState<number | null>(null)
  const history = useRef<{ cpu: number[]; memory: number[] }>({ cpu: [], memory: [] })
  const fps = useFps(!prefs.hidden && prefs.fps)

  const update = (patch: Partial<HudPrefs>) => setPrefs((prev) => {
    const next = { ...prev, ...patch }
    writePrefs(next)
    return next
  })

  // Cmd/Ctrl+Alt+Shift+M 显示/隐藏；Alt 会改写 key，按物理键判断
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'KeyM' || !event.altKey || !event.shiftKey || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      event.stopPropagation()
      setPrefs((prev) => {
        const next = { ...prev, hidden: !prev.hidden }
        writePrefs(next)
        return next
      })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    if (prefs.hidden) return
    const getMetrics = window.desktop?.getDevMetrics
    if (typeof getMetrics !== 'function') { setError('非桌面环境'); return }
    let cancelled = false
    const tick = () => {
      if (document.hidden) return
      setHeap(jsHeap())
      getMetrics().then((next) => {
        if (cancelled) return
        const h = history.current
        h.cpu = [...h.cpu, next.totals.cpu].slice(-HISTORY)
        h.memory = [...h.memory, next.totals.memoryKb / 1024].slice(-HISTORY)
        setSnapshot(next)
        setError(null)
      }).catch((e: unknown) => { if (!cancelled) setError((e as Error)?.message || '采样失败') })
    }
    tick()
    const timer = setInterval(tick, INTERVAL)
    return () => { cancelled = true; clearInterval(timer) }
  }, [prefs.hidden])

  if (prefs.hidden) return null

  const totals = snapshot?.totals
  const summary = (
    <>
      <span>CPU {totals ? pct(totals.cpu) : '—'}</span>
      <span>内存 {totals ? kbToMb(totals.memoryKb) : '—'}</span>
      <span>GPU {pct(snapshot?.gpu.utilization ?? null)}</span>
      {prefs.fps && <span>FPS {fps ?? '—'}</span>}
    </>
  )

  if (!prefs.expanded) {
    return (
      <button type="button" className={styles.pill} onClick={() => update({ expanded: true })} title="展开资源监控（⌘/Ctrl+⌥/Alt+⇧+M 隐藏）">
        {error ? <span className={styles.error}>{error}</span> : summary}
      </button>
    )
  }

  const processes = [...(snapshot?.processes ?? [])].sort((a, b) => b.memoryKb - a.memoryKb)
  return (
    <section className={styles.panel} aria-label="开发资源监控">
      <header className={styles.header}>
        <strong>资源监控 · dev</strong>
        <label className={styles.toggle}>
          <input type="checkbox" checked={prefs.fps} onChange={(e) => update({ fps: e.target.checked })} />
          测帧率
        </label>
        <button type="button" onClick={() => update({ expanded: false })}>收起</button>
        <button type="button" onClick={() => update({ hidden: true })} title="⌘/Ctrl+⌥/Alt+⇧+M 重新显示">隐藏</button>
      </header>
      {error && <p className={styles.error}>{error}</p>}
      {snapshot && (
        <>
          <div className={styles.charts}>
            <div>
              <div className={styles.metric}><span>总 CPU</span><b>{pct(snapshot.totals.cpu)}</b></div>
              <Sparkline values={history.current.cpu} max={100} />
            </div>
            <div>
              <div className={styles.metric}><span>总内存</span><b>{kbToMb(snapshot.totals.memoryKb)}</b></div>
              <Sparkline values={history.current.memory} max={0} />
            </div>
          </div>
          <dl className={styles.facts}>
            <dt>GPU 利用率（整机）</dt><dd>{pct(snapshot.gpu.utilization)}</dd>
            <dt>GPU 在用内存（整机）</dt><dd>{snapshot.gpu.inUseMemory == null ? '—' : mb(snapshot.gpu.inUseMemory)}</dd>
            <dt>本页 JS 堆</dt><dd>{heap == null ? '—' : mb(heap)}</dd>
            <dt>主进程 V8 堆</dt><dd>{mb(snapshot.main.heapUsed)} / {mb(snapshot.main.heapTotal)}</dd>
            <dt>主进程 ArrayBuffer</dt><dd>{mb(snapshot.main.arrayBuffers)}</dd>
            {prefs.fps && <><dt>本页 FPS</dt><dd>{fps ?? '—'}</dd></>}
            <dt>系统可用内存</dt><dd>{mb(snapshot.system.freeMem)} / {mb(snapshot.system.totalMem)}</dd>
          </dl>
          {snapshot.gpu.renderer && <p className={styles.gpu} title={snapshot.gpu.renderer}>{snapshot.gpu.renderer}</p>}
          <table className={styles.table}>
            <thead>
              <tr><th>进程</th><th>类型</th><th>PID</th><th>CPU</th><th>内存</th></tr>
            </thead>
            <tbody>
              {processes.map((item) => (
                <tr key={item.pid}>
                  <td title={item.label}>{item.label}</td>
                  <td>{item.type}</td>
                  <td>{item.pid}</td>
                  <td>{pct(item.cpu)}</td>
                  <td>{kbToMb(item.memoryKb)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.note}>CPU 以单核 100% 计（{snapshot.system.cpuCount} 核）；GPU 数值为整机，进程级看「GPU 进程」行。</p>
        </>
      )}
    </section>
  )
}
