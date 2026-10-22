import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlayerStore } from '../../stores/player'
import { useLyricsStore } from '../../stores/lyrics'
import { useSettingsStore } from '../../stores/settings'
import { useAmbientStore } from '../../stores/ambient'
import { useLyricModsStore } from '../../stores/lyric-mods'
import { useLightTheme } from '../../hooks/useLightTheme'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { lyricPlaybackPosition } from '../../lib/lyric-playback-position'
import { subscribeLyricFrames } from '../../lib/lyric-frame-clock'
import { foliumLyrics, foliumLineIndex, sanitizeModSettings } from '../../lib/folium-lyrics'
import type { ModSnapshot, ModSetting } from '../../types/folium'
import { PopLyrics } from './PopLyrics'
import styles from './ModLyrics.module.css'

export function ModLyrics({ id, active, sidePanelOpen }: { id: string; active: boolean; sidePanelOpen: boolean }) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [session, setSession] = useState(() => crypto.randomUUID())
  const [failure, setFailure] = useState('')
  const [mounted, setMounted] = useState(false)
  const track = usePlayerStore(state => state.currentTrack)
  const duration = usePlayerStore(state => state.duration)
  const lines = useLyricsStore(state => state.lines)
  const words = useLyricsStore(state => state.wordLines)
  const translations = useLyricsStore(state => state.translation)
  const romanizations = useLyricsStore(state => state.romaji)
  const lyricTrack = useLyricsStore(state => state.trackKey)
  const fontScale = useSettingsStore(state => state.lyricsFontScale)
  const translation = useSettingsStore(state => state.lyricsShowTranslation)
  const roma = useSettingsStore(state => state.lyricsShowRoma)
  const wordMotion = useSettingsStore(state => state.performance.lyricsWordMotion)
  const values = useLyricModsStore(state => state.values[id])
  const accent = useAmbientStore(state => state.palette[1])
  const light = useLightTheme()
  const reduced = useReducedMotion()
  const trackKey = track ? track.source + ':' + String(track.id) : ''
  const projected = useMemo(() => foliumLyrics(lyricTrack === trackKey ? lines : [], words, translations, romanizations, duration), [lyricTrack, trackKey, lines, words, translations, romanizations, duration])
  const latest = useRef<ModSnapshot>()
  latest.current = {
    trackKey, lines: projected,
    song: track ? { id: String(track.id), title: track.name, artist: track.artists.map(artist => artist.name).join(' / '), album: track.album ?? '' } : null,
    theme: { name: 'Simple Music', isDaylight: light, backgroundColor: light ? '#f0f0f0' : '#0c0c0c',
      primaryColor: light ? '#191919' : '#f4f4f4', secondaryColor: light ? '#565656' : '#b9b9b9',
      accentColor: accent, fontStyle: 'sans', fontFamily: '', fontWeight: 700, animationIntensity: reduced ? 'calm' : 'normal' },
    duration, fontScale, subtitleMode: translation ? 'translation' : roma ? 'romanization' : 'none',
    settings: values ?? {}, motion: wordMotion && !reduced
  }
  const sendSnapshot = useRef<() => void>(() => {})
  useEffect(() => {
    if (!active || failure) return
    let ready = false
    let disposed = false
    const post = (type: string, payload: unknown) => iframe.current?.contentWindow?.postMessage({ folium: session, type, payload }, '*')
    // 时钟逐帧推送；频谱本身约 33ms 更新一次，按这个节奏附带，省掉每帧的拷贝与跨进程传输。
    let spectrumAt = -Infinity
    const postTick = (time: number, paused: boolean) => {
      const now = performance.now()
      const withSpectrum = paused || now - spectrumAt >= 32
      if (withSpectrum && !paused) spectrumAt = now
      post('tick', { time, index: foliumLineIndex(latest.current?.lines ?? [], time), paused,
        ...(withSpectrum ? { spectrum: paused ? new Uint8Array() : usePlayerStore.getState()._frequencyData() } : {}) })
    }
    const tick = () => {
      const player = usePlayerStore.getState()
      postTick(lyricPlaybackPosition(player) + useLyricsStore.getState().offsetSec, player.status !== 'playing' || document.hidden)
    }
    const send = () => {
      if (!ready || disposed || !latest.current) return
      latest.current.theme.fontFamily = root.current ? getComputedStyle(root.current).fontFamily : 'system-ui, sans-serif'
      // Clock first: a newly mounted scene starts at the actual position.
      tick()
      post('snapshot', latest.current)
    }
    sendSnapshot.current = send
    const timer = setTimeout(() => { if (!disposed) setFailure('模组启动超时') }, 12000)
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.data?.folium !== session) return
      if (event.data.type === 'ready') { ready = true; send() }
      if (event.data.type === 'mounted') { clearTimeout(timer); setMounted(true) }
      if (event.data.type === 'registered') useLyricModsStore.getState().setSchema(id, sanitizeModSettings(event.data.payload?.settings))
      if (event.data.type === 'error') {
        clearTimeout(timer)
        setFailure('模组暂时无法显示')
      }
    }
    window.addEventListener('message', receive)
    // 共用帧时钟逐帧推送（不再按 32ms 节流）：只在收到时钟时重画的模组才能跑满屏幕刷新率。
    const stopFrames = subscribeLyricFrames(frame => { if (ready && !disposed) postTick(frame.time, !frame.running) })
    return () => {
      disposed = true
      clearTimeout(timer)
      stopFrames()
      window.removeEventListener('message', receive)
      sendSnapshot.current = () => {}
    }
  }, [active, failure, id, session])
  useEffect(() => { sendSnapshot.current() }, [projected, track, duration, fontScale, translation, roma, wordMotion, values, accent, light, reduced])

  return <>{failure && <PopLyrics />}<div ref={root} className={styles.root + (sidePanelOpen ? ' ' + styles.withSidebar : '')} data-lyric-mod={id}>
    {failure ? <>
      <div className={styles.notice} role="status">{failure}，已显示内置跃字
        <button onClick={() => { setFailure(''); setMounted(false); setSession(crypto.randomUUID()) }}>重试</button>
      </div>
    </> : <>
      {active && <iframe ref={iframe} key={session} title="模组歌词舞台" sandbox="allow-scripts"
        referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
        src={'simplemusic-mod://' + id + '/__host.html?session=' + session} className={styles.frame} />}
      {!mounted && <div className={styles.loading} role="status">正在打开歌词样式…</div>}
    </>}
  </div></>
}
