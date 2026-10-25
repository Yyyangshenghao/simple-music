import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { apiBase } from '../../lib/api'
import { logBandsFrom } from '../../lib/audio-energy'
import { useBackgroundInactive } from '../../hooks/useBackgroundInactive'
import { usePlayerStore } from '../../stores/player'
import { wallpaperEngineSceneUrl } from '../../lib/wallpaper-engine'
import type { WallpaperSceneSettings } from '../../stores/background'
import styles from './AmbientBackground.module.css'

const SPECTRUM_INTERVAL_MS = 50
/** 遥控页自身会在 45s 后报错；这里只兜底「整页根本没起来」的情况。 */
const READY_TIMEOUT_MS = 60_000

interface SceneWallpaperProps {
  id: string
  token: string
  /** 节能档：暂停渲染，保留最后一帧。 */
  paused: boolean
  /** 窗口失焦时停帧；关闭后切到其他窗口仍继续渲染。最小化/隐藏始终停。 */
  pauseOnBlur: boolean
  /** 帧率、画质、脚本、频谱与鼠标交互选项。 */
  scene: WallpaperSceneSettings
  previewUrl: string | null
  /** 与图片/视频背景共用模糊与提亮滤镜。 */
  style?: CSSProperties
}

/**
 * 场景型 Wallpaper Engine 壁纸。真正的解析与 WebGL 渲染在 /we-scene 的遥控页里，
 * 那是 127.0.0.1 上的独立源：壁纸自带的 SceneScript 即使有恶意也拿不到主界面的
 * preload/DOM。主界面只发暂停、帧率、指针与音乐频谱，并接收 ready/error。
 *
 * 缩略图垫在 iframe 下面：加载期间不会露出空白，失败时也自然停在封面上。
 */
export function SceneWallpaper({ id, token, paused, pauseOnBlur, scene, previewUrl, style }: SceneWallpaperProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  // 在隐藏/失焦期间挂载超时的，恢复后再重挂一次；这不是壁纸本身的问题。
  const [retryKey, setRetryKey] = useState(0)
  // 画质与脚本在挂载时读取；改这两项就换 key 重挂遥控页。
  const frameKey = `${id}|${scene.quality}|${scene.scripts ? '1' : '0'}|${retryKey}`
  // 窗口失焦（可关）或最小化时停帧；与视频背景的省电口径一致。
  const inactive = useBackgroundInactive(pauseOnBlur)
  const stopped = paused || inactive
  const inactiveRef = useRef(inactive)
  const failedWhileInactive = useRef(false)

  useEffect(() => { inactiveRef.current = inactive }, [inactive])

  const post = useCallback((type: string, payload?: Record<string, unknown>) => {
    try {
      frame.current?.contentWindow?.postMessage({ source: 'sm-we-scene-host', type, ...payload }, '*')
    } catch { /* iframe 还没加载完成时忽略 */ }
  }, [])

  useEffect(() => {
    failedWhileInactive.current = false
    setReady(false)
    setFailed(false)
  }, [frameKey])

  useEffect(() => {
    const expected = apiBase()
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      // 纯前端调试没有固定源；Electron 下遥控页必须来自本地 API server。
      if (expected && event.origin !== expected) return
      const data = event.data as { source?: string; type?: string } | null
      if (data?.source !== 'sm-we-scene') return
      if (data.type === 'ready') setReady(true)
      else if (data.type === 'error') {
        failedWhileInactive.current = inactiveRef.current
        setFailed(true)
        setReady(false)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (ready || failed) return
    const timer = window.setTimeout(() => {
      failedWhileInactive.current = inactiveRef.current
      setFailed(true)
    }, READY_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [ready, failed, frameKey])

  // 隐藏期间 rAF 被节流，遥控页可能等不到首帧而超时；回到前台后自动重挂一次。
  useEffect(() => {
    if (inactive || !failed || !failedWhileInactive.current) return
    failedWhileInactive.current = false
    setFailed(false)
    setRetryKey(value => value + 1)
  }, [inactive, failed])

  useEffect(() => {
    if (!ready) return
    post(stopped ? 'pause' : 'resume')
  }, [ready, stopped, post])

  // 帧率可以热调；初始值由遥控页的默认 30 帧起步，就绪后再对齐用户选择。
  useEffect(() => {
    if (ready) post('fps', { fps: scene.fps })
  }, [ready, scene.fps, post])

  // 场景壁纸的频谱接口只有 64 段，直接把 FFT bin 发过去会全挤在低频。
  // 着色器与 SceneScript 都会消费频谱，因此音频响应不依赖脚本开关。
  useEffect(() => {
    if (!ready) return
    if (stopped || !scene.audio) {
      post('spectrum', { left: new Float32Array(64), right: new Float32Array(64) })
      return
    }
    const timer = window.setInterval(() => {
      const bands = logBandsFrom(usePlayerStore.getState()._frequencyData())
      post('spectrum', { left: bands, right: bands })
    }, SPECTRUM_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [ready, stopped, scene.audio, post])

  // 鼠标视差/点击交互：背景在 UI 下方收不到事件，这里把归一化坐标推进遥控页。
  useEffect(() => {
    if (!ready) return
    // 关闭交互后把指针归中，避免壁纸停在最后一次的偏移上。
    if (!scene.pointer) {
      post('pointer', { u: 0.5, v: 0.5, buttons: 0 })
      return
    }
    if (stopped) return
    let pending: [number, number, number] | null = null
    let frameId = 0
    const flush = () => {
      frameId = 0
      if (!pending) return
      const [u, v, buttons] = pending
      pending = null
      post('pointer', { u, v, buttons })
    }
    const onPointer = (event: PointerEvent) => {
      pending = [event.clientX / window.innerWidth, event.clientY / window.innerHeight, event.buttons]
      if (!frameId) frameId = requestAnimationFrame(flush)
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    window.addEventListener('pointerdown', onPointer, { passive: true })
    window.addEventListener('pointerup', onPointer, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('pointerup', onPointer)
      if (frameId) cancelAnimationFrame(frameId)
    }
  }, [ready, stopped, scene.pointer, post])

  return (
    <>
      {previewUrl
        ? <img className={styles.media} style={style} src={previewUrl} alt="" aria-hidden="true" draggable={false} />
        : <div className={styles.auroraFallback} aria-hidden="true" />}
      {!failed && <iframe
        key={frameKey}
        ref={frame}
        className={styles.sceneFrame}
        style={style}
        src={wallpaperEngineSceneUrl(id, token, scene)}
        title=""
        aria-hidden="true"
        tabIndex={-1}
        sandbox="allow-scripts allow-same-origin"
      />}
    </>
  )
}
