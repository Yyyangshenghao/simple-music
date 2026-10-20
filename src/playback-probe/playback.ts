import type { AudioEngine, AudioEngineCallbacks } from '../lib/audio-engine'
import type { ProbeCommand, ProbeItem, ProbeSnapshot } from '../types/playback-probe'

type ProbeEngine = Pick<AudioEngine, 'load' | 'play' | 'pause' | 'clearSource' | 'seek' | 'setVolume' | 'setPlaybackRate' | 'destroy' | 'hasSource'>

/** 单引擎的生命周期验证器，不实现正式播放解析、收藏或存储迁移。 */
export function createProbePlayback(sessionId: string, createEngine: (callbacks: AudioEngineCallbacks) => ProbeEngine, publish: (snapshot: ProbeSnapshot, progressOnly: boolean) => void) {
  let items: ProbeItem[] = []
  let disposed = false
  let intent = 0
  let autoplay = false
  let activeLoad = 0
  let sleepTimer: ReturnType<typeof setTimeout> | undefined
  let state: ProbeSnapshot = {
    sessionId, revision: 0, status: 'idle', current: null, queueIndex: -1, queueLength: 0,
    position: 0, duration: 0, volume: 0.2, rate: 1, loadCount: 0, endedCount: 0, deviceChanges: 0, sleepAt: null, error: '',
  }
  function snapshot(): ProbeSnapshot { return { ...state, current: state.current ? { ...state.current } : null } }
  function update(patch: Partial<ProbeSnapshot>, progressOnly = false) {
    if (disposed) return
    state = { ...state, ...patch, revision: state.revision + 1 }
    publish(snapshot(), progressOnly)
  }
  const engine = createEngine({
    onPosition: position => { if (engine.hasSource) update({ position }, true) },
    onDuration: duration => { if (engine.hasSource) update({ duration }) },
    onStatus: status => {
      if (disposed || !engine.hasSource) return
      if (!autoplay && status === 'playing') { engine.pause(); return }
      update({ status: !autoplay && status === 'loading' ? 'paused' : status })
    },
    onError: (reason, loadId) => {
      if (disposed || loadId !== activeLoad) return
      autoplay = false
      ++intent
      engine.pause()
      update({ status: 'paused', error: reason || 'MEDIA_LOAD_ERROR' })
    },
    onOutputDeviceChange: () => update({ deviceChanges: state.deviceChanges + 1 }),
    onEnded: () => {
      if (disposed || !autoplay) return
      update({ endedCount: state.endedCount + 1 })
      if (state.queueIndex + 1 < items.length) select(state.queueIndex + 1)
      else { autoplay = false; update({ status: 'paused', position: state.duration }) }
    },
  })
  engine.setVolume(state.volume)

  function play() {
    if (disposed || !items.length) return
    autoplay = true
    const revision = ++intent
    if (!engine.hasSource) {
      update({ loadCount: state.loadCount + 1, status: 'loading', error: '' })
      activeLoad = engine.load(items[state.queueIndex].url, state.position)
    }
    void engine.play().catch(() => {
      if (disposed || revision !== intent || !autoplay) return
      autoplay = false
      update({ status: 'paused', error: 'PLAY_FAILED' })
    })
  }
  function pause() {
    ++intent
    autoplay = false
    engine.pause()
    update({ status: 'paused' })
  }
  function stop() {
    ++intent
    autoplay = false
    activeLoad = -1
    engine.clearSource()
    update({ status: 'idle', position: 0, error: '' })
  }
  function select(index: number) {
    if (disposed || !items[index]) return
    stop()
    const { url: _url, ...current } = items[index]
    update({ current, queueIndex: index, position: 0, duration: 0, error: '' })
    play()
  }
  function cancelSleep() { clearTimeout(sleepTimer); sleepTimer = undefined }

  return {
    snapshot,
    replace(next: ProbeItem[]) {
      if (disposed) return
      stop()
      items = next.map(item => ({ ...item }))
      const { url: _url, ...current } = items[0] ?? {}
      update({ current: items.length ? current as Omit<ProbeItem, 'url'> : null, queueLength: items.length, queueIndex: items.length ? 0 : -1, position: 0, duration: 0, error: '' })
    },
    command(command: ProbeCommand) {
      if (disposed) return
      switch (command.type) {
        case 'play': play(); break
        case 'pause': pause(); break
        case 'stop': stop(); break
        case 'next': select((state.queueIndex + 1) % items.length); break
        case 'previous': select((state.queueIndex - 1 + items.length) % items.length); break
        case 'seek': {
          const position = Math.min(Math.max(0, command.value), state.duration || command.value)
          if (engine.hasSource) engine.seek(position)
          update({ position })
          break
        }
        case 'volume': engine.setVolume(command.value); update({ volume: command.value }); break
        case 'rate': engine.setPlaybackRate(command.value); update({ rate: command.value }); break
        case 'sleep':
          cancelSleep()
          update({ sleepAt: command.value ? Date.now() + command.value * 1000 : null })
          if (command.value) sleepTimer = setTimeout(() => { stop(); update({ sleepAt: null }) }, command.value * 1000)
          break
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      ++intent
      autoplay = false
      cancelSleep()
      engine.destroy()
    },
  }
}
