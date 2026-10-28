import { Select } from '../components/ui/Select'
import { useEffect, useMemo, useState } from 'react'
import { useKaraokeStore } from '../stores/karaoke'
import { useKaraokeModelsStore } from '../stores/karaoke-models'
import { usePlaylistStore } from '../stores/playlist'
import { usePlayerStore } from '../stores/player'
import { useNavigationStore } from '../stores/navigation'
import { useToastStore } from '../stores/toast'
import { accompanimentTrack } from '../lib/karaoke-library'
import { useTaskCenterStore } from '../stores/task-center'
import { karaokeTrackKey } from '../lib/karaoke/queue'
import type { Accompaniment } from '../types/karaoke'
import { LibraryToolbar } from '../components/ui/LibraryToolbar'
import { ActionButton } from '../components/ui/ActionButton'
import { HoverTips } from '../components/ui/HoverTips'
import { ActionIcon } from '../components/ui/ActionIcon'
import styles from './AccompanimentsLibrary.module.css'

/** 我的伴奏：我的库「应用歌单 · 伴奏」的主体，含统计与操作、队列入口、已生成列表；各处伴奏入口都跳到这里。 */
export function AccompanimentsLibrary() {
  const { items, loaded, error, load, remove, directory } = useKaraokeStore()
  const { models, load: loadModels } = useKaraokeModelsStore()
  const [query, setQuery] = useState('')
  const [versions, setVersions] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const currentId = usePlayerStore(state => String(state.currentTrack?.id ?? ''))
  useEffect(() => { void load().catch(() => {}); void loadModels() }, [load, loadModels])
  const modelName = (id: string) => models.find(model => model.id === id)?.name ?? id
  const groups = useMemo(() => {
    const grouped = new Map<string, Accompaniment[]>()
    for (const item of items) {
      const key = karaokeTrackKey(item.track)
      grouped.set(key, [...grouped.get(key) ?? [], item])
    }
    const keyword = query.trim().toLocaleLowerCase()
    return [...grouped.entries()].filter(([, entries]) => `${entries[0].track.name} ${entries[0].track.artist}`.toLocaleLowerCase().includes(keyword))
  }, [items, query])
  const visible = groups.map(([key, entries]) => entries.find(item => item.id === versions[key]) ?? entries.find(item => item.available) ?? entries[0])
  const tracks = visible.filter(item => item.available).map(accompanimentTrack)
  const total = new Set(items.map(item => karaokeTrackKey(item.track))).size
  const manage = () => { const navigation = useNavigationStore.getState(); navigation.requestSettingsKaraoke(); navigation.navigateTo('settings') }
  const notify = (error: unknown) => useToastStore.getState().show(error instanceof Error ? error.message : '操作失败，请重试')
  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    try { await load() } catch (error) { notify(error) }
    finally { setRefreshing(false) }
  }
  async function deleteVersion(item: Accompaniment) {
    if (!window.confirm(`删除「${item.track.name}」的 ${modelName(item.model)} 伴奏文件？其他模型版本和原曲会保留。`)) return
    setDeleting(item.id)
    try { await remove(item.id) } catch (error) { notify(error) }
    finally { setDeleting(null) }
  }
  return <div className={styles.scope}>
      <HoverTips match="[data-icon-action], [data-tip-help]" exclude="[data-library-toolbar]" />
      <LibraryToolbar summary={query.trim() ? `${groups.length} / ${total} 首` : `${total} 首 · ${items.length} 个版本`}
        primary={<ActionButton label="播放全部" icon="play" primary disabled={!tracks.length} onClick={() => usePlaylistStore.getState().setQueue(tracks, 0)} />}
        value={query} onChange={setQuery} searchLabel="搜索伴奏">
        <ActionButton label="任务队列" icon="queue" iconOnly onClick={() => useTaskCenterStore.getState().show('karaoke')} />
        <ActionButton label="刷新伴奏" icon="refresh" iconOnly disabled={!loaded} busy={refreshing} onClick={() => void refresh()} />
        <ActionButton label="打开伴奏文件夹" title={`打开文件夹：${directory}`} icon="folder" iconOnly
          disabled={!directory || typeof window === 'undefined' || !window.desktop?.openDirectory} onClick={() => void window.desktop?.openDirectory(directory).then(result => { if (!result.ok) notify(new Error(result.error ?? '文件夹打开失败')) }).catch(notify)} />
        <ActionButton label="伴奏设置" title="伴奏设置 · 保存位置与模型" icon="settings" iconOnly onClick={manage} />
      </LibraryToolbar>
      {error && <div className={styles.notice} role="alert"><span>{error}</span>
        <ActionButton label="重新读取" icon="refresh" busy={refreshing} onClick={() => void refresh()} /></div>}
      {!loaded ? <div className={styles.empty} role="status">正在读取伴奏…</div>
        : error && !items.length ? null
        : !groups.length ? <div className={styles.empty}><h3>{query ? '没有匹配的伴奏' : '还没有生成伴奏'}</h3>
          {!query && <p>播放歌曲后，点击播放栏的麦克风，生成这首歌的伴奏。</p>}
        </div>
        : <ul className={styles.library}>{groups.map(([key, entries], index) => {
          const item = visible[index]
          return <li key={key} data-playing={currentId === `karaoke:${item.id}`}>
            <button className={styles.song} disabled={!item.available} aria-label={`播放伴奏：${item.track.name}`} onClick={() => {
              const position = tracks.findIndex(track => String(track.id) === `karaoke:${item.id}`)
              if (position >= 0) usePlaylistStore.getState().setQueue(tracks, position)
            }}>
              <span className={styles.artwork}><span className={styles.playOverlay}><ActionIcon name="play" /></span>{item.track.cover ? <img src={accompanimentTrack(item).cover} alt="" loading="lazy" /> : <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M9 18V5l11-2v13M9 9l11-2" /><ellipse cx="6" cy="18" rx="3" ry="2" /><ellipse cx="17" cy="16" rx="3" ry="2" /></svg>}</span>
              <span className={styles.songInfo}><strong title={item.track.name}>{item.track.name}</strong><span title={item.track.artist}>{item.track.artist}{!item.available ? ' · 文件已丢失' : ''}</span></span>
            </button>
            {entries.length > 1 ? <Select aria-label={`${item.track.name}的伴奏模型版本`} className={styles.version} value={item.id}
              onChange={value => setVersions(current => ({ ...current, [key]: value }))}
              options={entries.map(entry => ({ value: entry.id, label: `${modelName(entry.model)}${!entry.available ? '（文件丢失）' : ''}` }))} /> : <span className={styles.model} title={modelName(item.model)}>{modelName(item.model)}</span>}
            <div className={styles.actions}>
              {!item.available && <ActionButton label="重新生成" icon="refresh" onClick={() => void useKaraokeStore.getState().enqueue(item.track, item.model).catch(notify)} />}
              <ActionButton label={`删除伴奏：${item.track.name}（${modelName(item.model)}）`} title="删除此版本的伴奏文件，原曲与其他版本保留" icon="delete" iconOnly danger
                disabled={deleting !== null} busy={deleting === item.id} onClick={() => void deleteVersion(item)} />
            </div>
          </li>
        })}</ul>}
      {directory && <p className={styles.path} title={`新伴奏保存到 ${directory}`}><ActionIcon name="folder" size={14} /><span>{directory}</span></p>}
    </div>
}
