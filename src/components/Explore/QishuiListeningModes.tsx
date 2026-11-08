import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { BROWSE_CACHE_MAX_AGE_MS, getCachedProviderData, requestProviderData } from '../../lib/provider-request-cache'
import { getQishuiListeningModes, getQishuiListeningTracks, type QishuiListeningMode } from '../../lib/qishui-music-service'
import { isProviderParticipating, useProviderStore } from '../../stores/providers'
import { usePlaylistStore } from '../../stores/playlist'
import { ActionButton } from '../ui/ActionButton'
import { TrackRow } from './TrackRow'
import styles from './PersonalListeningSection.module.css'
import modeStyles from './QishuiListeningModes.module.css'

function useListeningData<T>(scope: string, load: () => Promise<T>) {
  const [data, setData] = useState(() => getCachedProviderData<T>('qishui', scope))
  const [busy, setBusy] = useState(data === undefined)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const isCurrent = () => !cancelled && isProviderParticipating('qishui')
    void requestProviderData('qishui', scope, load, { force: attempt > 0, maxAgeMs: BROWSE_CACHE_MAX_AGE_MS })
      .then(items => { if (isCurrent()) setData(items) })
      .catch(() => { if (isCurrent()) setFailed(true) })
      .finally(() => { if (isCurrent()) setBusy(false) })
    return () => { cancelled = true }
  }, [scope, load, attempt])

  function refresh() {
    if (busy || !isProviderParticipating('qishui')) return
    setFailed(false)
    setBusy(true)
    setAttempt(value => value + 1)
  }

  return { data, busy, failed, refresh }
}

function ModeTracks({ mode }: { mode: string }) {
  const load = useCallback(() => getQishuiListeningTracks(mode), [mode])
  const { data: tracks, busy, failed, refresh } = useListeningData(`explore:listening-tracks:${mode}`, load)

  function play(index: number) {
    if (tracks?.length && isProviderParticipating('qishui')) usePlaylistStore.getState().setQueue(tracks, index)
  }

  return <>
    {tracks && tracks.length > 0 && <>
      <div className={modeStyles.actions}>
        <ActionButton label="播放全部" icon="play" primary compact onClick={() => play(0)} />
        <ActionButton label={failed ? '重试' : '换一批'} icon="refresh" compact busy={busy} onClick={refresh} />
      </div>
      <div className={styles.tracks}>
        {tracks.slice(0, 5).map((track, index) => <TrackRow key={String(track.id)} track={track} index={index} hideSource
          statusLabel={track.vipOnly ? '汽水试听' : undefined} statusColumn onPlay={() => play(index)} />)}
      </div>
    </>}
    {busy && !tracks?.length && <p className={styles.status} role="status">正在选曲…</p>}
    {!busy && (failed || !tracks?.length) && <div className={styles.error} role="status">
      <span>{failed ? '选曲暂时失败' : '汽水暂时没有返回歌曲'}</span>
      {!tracks?.length && <ActionButton label={failed ? '重试' : '换一批'} compact onClick={refresh} />}
    </div>}
  </>
}

const preferenceIds = new Set(['default', 'familiar', 'fresh'])
const modeGlyphs: Record<string, string> = {
  default: 'M3 12h3l2-5 3 10 3-12 3 7h4',
  familiar: 'M3 11a9 9 0 1 1 2.6 7.4M3 6v5h5m4-4v5l3 2',
  fresh: 'M12 3l2.1 6.9L21 12l-6.9 2.1L12 21l-2.1-6.9L3 12l6.9-2.1L12 3Z',
  scenes: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  music: 'M10 17V6l10-2v11M10 17c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2Zm10-2c0 1.1-1.3 2-3 2s-3-.9-3-2 1.3-2 3-2 3 .9 3 2Z',
}

function ModeIcon({ mode }: { mode: QishuiListeningMode }) {
  const [failedIcon, setFailedIcon] = useState<string>()
  return <span className={modeStyles.icon} aria-hidden="true">
    {mode.icon && mode.icon !== failedIcon
      ? <img src={mode.icon} alt="" loading="lazy" onError={() => setFailedIcon(mode.icon)} />
      : <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round"><path d={modeGlyphs[mode.id] ?? modeGlyphs.music} /></svg>}
  </span>
}

function ListeningModePicker({ modes, mode, onChange }: {
  modes: QishuiListeningMode[]
  mode: string
  onChange(mode: string): void
}) {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const scenePanelId = useId()
  const sceneTrigger = useRef<HTMLButtonElement>(null)
  const preferences = modes.filter(item => preferenceIds.has(item.id))
  const scenes = modes.filter(item => !preferenceIds.has(item.id))
  const selectedScene = scenes.find(item => item.id === mode)
  const more = selectedScene ?? { id: 'scenes', label: '更多场景' }
  const keyword = query.trim().toLowerCase()
  const visibleScenes = scenes.filter(item => item.label.toLowerCase().includes(keyword))

  function closeScenes(restoreFocus = false) {
    setExpanded(false)
    setQuery('')
    if (restoreFocus) sceneTrigger.current?.focus()
  }

  function selectMode(id: string, scene = false) {
    onChange(id)
    closeScenes(scene)
  }

  return <div className={modeStyles.picker} onKeyDown={event => {
    if (expanded && event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      event.stopPropagation()
      closeScenes(true)
    }
  }}>
    <div className={modeStyles.shortcuts} role="group" aria-label="听歌模式">
      {preferences.map(item => <button key={item.id} type="button" className={`${modeStyles.choice} no-drag`}
        aria-pressed={mode === item.id} onClick={() => selectMode(item.id)}>
        <ModeIcon mode={item} /><span>{item.label}</span>
      </button>)}
      {scenes.length > 0 && <button ref={sceneTrigger} type="button" className={`${modeStyles.choice} ${modeStyles.more} no-drag`}
        aria-label={selectedScene ? `更多场景，当前${selectedScene.label}` : more.label}
        aria-expanded={expanded} aria-controls={scenePanelId} data-selected={!!selectedScene || undefined}
        onClick={() => expanded ? closeScenes() : setExpanded(true)}>
        <ModeIcon mode={more} /><span>{more.label}</span>
        <svg className={modeStyles.chevron} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>}
    </div>
    {scenes.length > 0 && <div id={scenePanelId} hidden={!expanded}>
      {expanded && <section className={modeStyles.scenePanel} aria-label="场景音乐">
        <div className={modeStyles.sceneHeader}>
          <h4>场景音乐</h4>
          <input className={`${modeStyles.search} no-drag`} type="search" aria-label="搜索场景" placeholder="搜索场景"
            value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        {visibleScenes.length > 0 ? <div className={modeStyles.scenes}>
          {visibleScenes.map(item => <button key={item.id} type="button" className={`${modeStyles.choice} no-drag`}
            aria-pressed={mode === item.id} onClick={() => selectMode(item.id, true)}>
            <ModeIcon mode={item} /><span>{item.label}</span>
          </button>)}
        </div> : <p className={styles.status} role="status">未找到匹配的场景</p>}
      </section>}
    </div>}
  </div>
}

function ListeningModesContent() {
  const { data: modes, busy, failed, refresh } = useListeningData('explore:listening-modes', getQishuiListeningModes)
  const [mode, setMode] = useState('default')

  return <section className={styles.section} aria-label="汽水听歌模式">
    <header className={styles.header}>
      <div><h3>听歌模式</h3><p className={styles.caption}>汽水游客推荐</p></div>
    </header>
    {modes && <ListeningModePicker modes={modes} mode={mode} onChange={setMode} />}
    {busy && !modes && <p className={styles.status} role="status">正在读取听歌模式…</p>}
    {failed && <div className={styles.error} role="status">
      <span>听歌模式暂时无法加载</span>
      <ActionButton label="重试" compact onClick={refresh} />
    </div>}
    {modes && <ModeTracks key={mode} mode={mode} />}
  </section>
}

export function QishuiListeningModes() {
  const enabled = useProviderStore(() => isProviderParticipating('qishui'))
  return enabled ? <ListeningModesContent /> : null
}
