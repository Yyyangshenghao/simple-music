import { useCallback, useEffect, useState } from 'react'
import { BROWSE_CACHE_MAX_AGE_MS, getCachedProviderData, requestProviderData } from '../../lib/provider-request-cache'
import { getQishuiListeningModes, getQishuiListeningTracks } from '../../lib/qishui-music-service'
import { isProviderParticipating, useProviderStore } from '../../stores/providers'
import { usePlaylistStore } from '../../stores/playlist'
import { ActionButton } from '../ui/ActionButton'
import { Select } from '../ui/Select'
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

function ListeningModesContent() {
  const { data: modes, busy, failed, refresh } = useListeningData('explore:listening-modes', getQishuiListeningModes)
  const [mode, setMode] = useState('default')

  return <section className={styles.section} aria-label="汽水听歌模式">
    <header className={styles.header}>
      <div><h3>听歌模式</h3><p className={styles.caption}>汽水游客推荐</p></div>
      {modes && <Select aria-label="选择听歌模式" className={modeStyles.select}
        value={mode} onChange={setMode} options={modes.map(item => ({ value: item.id, label: item.label }))} />}
    </header>
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
