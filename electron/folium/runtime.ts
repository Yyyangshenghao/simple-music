import type { ModSetting, ModSnapshot, ModTick } from '../../src/types/folium'

/** Serialized into the opaque-origin document. Keep this function closure-free. */
export function foliumRuntime(config: { id: string; client: string; session: string }): void {
  type Listener = () => void
  type TimeListener = (time: number) => void
  type RawSetting = Omit<ModSetting, 'label' | 'options'> & {
    label: Record<string, string> | string
    options?: { value: string; label: Record<string, string> | string }[]
  }
  type Definition = { id: string; label: Record<string, string>; mount: (container: HTMLElement, context: object) => unknown; settings?: RawSetting[]; hostLayers?: { subtitles?: boolean; background?: boolean } }
  const post = (type: string, payload?: unknown) => parent.postMessage({ folium: config.session, type, payload }, '*')
  const label = (value: Record<string, string> | string | undefined) => typeof value === 'string' ? value : value?.['zh-CN'] ?? value?.en ?? ''
  let snapshot: ModSnapshot | undefined
  let tick: ModTick = { time: 0, index: -1, paused: true, spectrum: new Uint8Array() }
  let definition: Definition | undefined
  let mountedKey = ''
  let disposeMount: (() => void) | undefined
  let stopped = false
  const changes = new Set<Listener>()
  const times = new Set<TimeListener>()
  const frames = new Set<TimeListener>()
  const cleanups = new Set<Listener>()
  const root = document.getElementById('stage')!
  const subtitle = document.getElementById('subtitle')!
  let schema: ModSetting[] = []
  const report = (error: unknown) => {
    if (stopped) return
    stopped = true
    disposeMount?.()
    post('error', String(error instanceof Error ? error.message : error).slice(0, 300))
  }
  window.addEventListener('error', event => report(event.error ?? event.message))
  window.addEventListener('unhandledrejection', event => report(event.reason))
  // 只有未捕获异常和挂载失败才算模组失败；模组或其依赖打印的非致命错误日志不应让样式被替换。
  const call = (listener: Listener) => { try { listener() } catch (error) { report(error) } }
  const subscribe = <T>(set: Set<T>, listener: T) => {
    set.add(listener)
    return () => { set.delete(listener) }
  }
  const getSettings = (): Record<string, unknown> => Object.fromEntries(schema.map(field => {
    const value = snapshot?.settings[field.key]
    const resolved = field.type === 'number'
      ? typeof value === 'number' && Number.isFinite(value) ? Math.max(field.min ?? -1e6, Math.min(field.max ?? 1e6, value)) : field.defaultValue
      : field.type === 'boolean' ? typeof value === 'boolean' ? value : field.defaultValue
        : field.options?.some(option => option.value === value) ? value : field.defaultValue
    return [field.key, resolved]
  }))
  const paintSubtitle = () => {
    const line = snapshot?.lines[tick.index]
    subtitle.textContent = snapshot?.subtitleMode === 'translation' ? line?.translation ?? ''
      : snapshot?.subtitleMode === 'romanization' ? line?.romanization ?? '' : ''
    subtitle.style.color = snapshot?.theme.secondaryColor ?? ''
    subtitle.hidden = definition?.hostLayers?.subtitles === false
  }
  const mount = () => {
    if (!snapshot || !definition || stopped) return
    const key = JSON.stringify([snapshot.trackKey, snapshot.lines, snapshot.motion])
    if (mountedKey === key) {
      changes.forEach(listener => call(listener))
      times.forEach(listener => call(() => listener(tick.time)))
      paintSubtitle()
      return
    }
    disposeMount?.()
    mountedKey = key
    root.replaceChildren()
    let cleanup: unknown
    const dispose = () => {
      if (typeof cleanup === 'function') call(cleanup as Listener)
      cleanups.forEach(listener => call(listener))
      cleanups.clear()
      changes.clear()
      frames.clear()
      times.clear()
      root.replaceChildren()
    }
    disposeMount = dispose
    const onChange = (listener: Listener) => subscribe(changes, listener)
    const onLyricTime = (listener: TimeListener) => subscribe(times, listener)
    const clock = { get: () => tick.time, on: (_event: string, listener: TimeListener) => onLyricTime(listener) }
    const band = (start: number, end: number) => {
      const values = tick.spectrum.slice(start, end)
      return values.length ? values.reduce((sum, value) => sum + value / 255, 0) / values.length : 0
    }
    const audio = {
      getPower: () => band(0, 24),
      getBands: () => ({ bass: band(0, 7), lowMid: band(7, 18), mid: band(18, 56), vocal: band(46, 164), treble: band(164, 512) }),
      getSpectrum: () => tick.spectrum.length ? tick.spectrum : null
    }
    const context = {
      lines: snapshot.lines, song: snapshot.song, staticMode: !snapshot.motion,
      staticLineIndex: !snapshot.motion ? Math.max(0, tick.index) : null,
      seed: snapshot.trackKey, isPreview: false, lyricTime: clock, currentTime: clock,
      getDuration: () => snapshot!.duration, getLineIndex: () => tick.index, isPaused: () => tick.paused,
      getTheme: () => snapshot!.theme, getSubtitleTheme: () => snapshot!.theme, getCoverUrl: () => null,
      getDisplay: () => ({
        showText: true, lyricsFontScale: snapshot!.fontScale, subtitleFontScale: 1, subtitleOverlayOpacity: 1,
        subtitleOverlayBackground: false, subtitleUpcomingLyricsBlur: false, showHarmonySubtitle: false,
        harmonySubtitleBackground: false, showSubtitleTranslation: snapshot!.subtitleMode !== 'none',
        hideTranslationSubtitle: false, subtitleContentMode: snapshot!.subtitleMode,
        isPlayerChromeHidden: false, isPanelOpen: false, visualizerOpacity: 1
      }),
      getSettings, getSurface: () => ({ transparent: true, hostBackground: true }), getLayout: () => null,
      audio, onChange, subscribe: onChange, onLyricTime,
      onFrame: (listener: TimeListener) => { const off = subscribe(frames, listener); call(() => listener(performance.now())); return off },
      onResize: (listener: (size: { width: number; height: number }) => void) => {
        const notify = () => call(() => listener({ width: root.clientWidth, height: root.clientHeight }))
        const observer = new ResizeObserver(notify)
        observer.observe(root)
        const off = () => observer.disconnect()
        cleanups.add(off)
        notify()
        return off
      },
      every: (ms: number, listener: Listener) => {
        const timer = setInterval(() => { if (!tick.paused) call(listener) }, Math.max(16, Math.min(2147483647, ms)))
        const off = () => clearInterval(timer)
        cleanups.add(off)
        return off
      },
      onDispose: (listener: Listener) => { cleanups.add(listener) }
    }
    try {
      cleanup = definition.mount(root, context)
      paintSubtitle()
      post('mounted')
    } catch (error) { report(error) }
  }
  const api = {
    modId: config.id,
    host: { name: 'Simple Music', folium: { major: 1, minor: 6 }, compatibility: 'lyrics-visualizers' },
    env: { context: 'main' }, log: { info: console.info, warn: console.warn, error: console.error },
    theme: {
      resolveFontStack: (theme: ModSnapshot['theme']) => theme.fontFamily || 'system-ui, sans-serif',
      resolveFontWeight: (theme: ModSnapshot['theme'], fallback = 500) => theme.fontWeight || fallback
    },
    registries: {
      visualizers: {
        register: (value: Definition) => {
          if (definition || !value || typeof value.mount !== 'function') throw new Error('不支持的歌词模组注册')
          definition = value
          schema = (value.settings ?? []).filter(field => field && typeof field.key === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(field.key)
            && ['number', 'boolean', 'select'].includes(field.type)).slice(0, 40).map(field => ({
              ...field, label: label(field.label).slice(0, 160),
              options: field.options?.slice(0, 40).map(option => ({ value: option.value, label: label(option.label).slice(0, 160) }))
            }))
          post('registered', { name: label(value.label), settings: schema })
          mount()
          return { id: config.id + ':' + value.id, unregister: () => disposeMount?.() }
        }
      }
    },
    experimental: { 'ponder.targets': { register: () => ({ unregister: () => {} }) } }
  }
  // Only accept the parent and this document's random session. There are no
  // outbound host commands: messages below only carry rendering data.
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.folium !== config.session || stopped) return
    if (event.data.type === 'snapshot') {
      snapshot = event.data.payload
      document.documentElement.style.colorScheme = snapshot!.theme.isDaylight ? 'light' : 'dark'
      root.style.fontFamily = snapshot!.theme.fontFamily
      document.body.style.color = snapshot!.theme.primaryColor
      mount()
    } else if (event.data.type === 'tick') {
      const previous = tick
      // 没带频谱的帧沿用上一份，模组读到的频谱不会在两次更新之间闪空。
      tick = { ...event.data.payload, spectrum: event.data.payload?.spectrum ?? previous.spectrum }
      if (previous.index !== tick.index || previous.paused !== tick.paused) changes.forEach(listener => call(listener))
      times.forEach(listener => call(() => listener(tick.time)))
      frames.forEach(listener => call(() => listener(performance.now())))
      // Static-mode mods draw one line per mount. Recreate them only on line
      // changes when motion is disabled, so reading still follows playback.
      if (!snapshot?.motion && tick.index !== previous.index) { mountedKey = ''; mount() }
      paintSubtitle()
    }
  })
  window.addEventListener('pagehide', () => { stopped = true; disposeMount?.() })
  post('ready')
  void import(config.client).then(module => {
    if (typeof module.default !== 'function') throw new Error('模组入口无效')
    return module.default(api)
  }).then(() => { if (!definition) throw new Error('模组未提供歌词样式') }).catch(report)
}
