import { AudioEngine } from '../lib/audio-engine'
import { createProbePlayback } from './playback'
import type { ProbeSnapshot } from '../types/playback-probe'

const bridge = window.playbackProbe
if (bridge.role !== 'host') throw new Error('Invalid probe host')
const api = bridge
let observing = true
let lastPublish = 0
let lastMediaPosition = 0
let lastMediaTrack = ''
const core = createProbePlayback(api.sessionId, callbacks => new AudioEngine(callbacks), (state, progressOnly) => {
  syncMediaSession(state, progressOnly)
  if (progressOnly && (!observing || performance.now() - lastPublish < 1000)) return
  lastPublish = performance.now()
  api.publish(state)
})

function syncMediaSession(state: ProbeSnapshot, progressOnly: boolean) {
  if (!('mediaSession' in navigator)) return
  if (state.current?.id !== lastMediaTrack) {
    lastMediaTrack = state.current?.id ?? ''
    navigator.mediaSession.metadata = state.current ? new MediaMetadata({ title: state.current.label, artist: 'Simple Music 音频宿主验证' }) : null
  }
  navigator.mediaSession.playbackState = state.status === 'playing' || state.status === 'loading' ? 'playing' : state.current ? 'paused' : 'none'
  if (progressOnly && performance.now() - lastMediaPosition < 1000) return
  lastMediaPosition = performance.now()
  try {
    if (state.duration > 0) navigator.mediaSession.setPositionState({ duration: state.duration, position: Math.min(state.position, state.duration), playbackRate: state.rate })
    else navigator.mediaSession.setPositionState()
  } catch { /* 不支持位置状态的平台仍可播放。 */ }
}

if ('mediaSession' in navigator) {
  for (const [action, type] of [['play', 'play'], ['pause', 'pause'], ['stop', 'stop'], ['nexttrack', 'next'], ['previoustrack', 'previous']] as const) {
    try { navigator.mediaSession.setActionHandler(action, () => core.command({ type })) } catch { /* 平台能力待实测。 */ }
  }
  try { navigator.mediaSession.setActionHandler('seekto', details => {
    if (typeof details.seekTime === 'number' && Number.isFinite(details.seekTime)) core.command({ type: 'seek', value: Math.max(0, details.seekTime) })
  }) } catch { /* unsupported action */ }
}

const unsubscribe = api.onCommand(({ id, command }) => {
  if (command.type === 'replace') core.replace(command.items)
  else if (command.type === 'observe') observing = command.enabled
  else if (command.type !== 'snapshot') core.command(command)
  api.reply(id, core.snapshot())
})
window.addEventListener('unload', () => {
  unsubscribe()
  core.dispose()
  if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none' }
})
api.publish(core.snapshot())
api.ready()
