import { useEffect, useMemo, useState } from 'react'
import { useKaraokeStore } from '../stores/karaoke'
import { useKaraokeModelsStore } from '../stores/karaoke-models'
import { usePlaylistStore } from '../stores/playlist'
import { usePlayerStore } from '../stores/player'
import { useNavigationStore } from '../stores/navigation'
import { useToastStore } from '../stores/toast'
import { accompanimentTrack } from '../lib/karaoke-library'
import { karaokeTrackKey, type KaraokeJobPhase } from '../lib/karaoke/queue'
import type { Accompaniment } from '../types/karaoke'
import styles from './AccompanimentsLibrary.module.css'

const PHASE: Record<KaraokeJobPhase, string> = {
  queued: '等待生成', 'waiting-memory': '等待内存释放', resolving: '正在读取歌曲', model: '正在下载模型',
  preparing: '正在准备模型', decoding: '正在解码音频', separating: '正在生成伴奏', saving: '正在保存', failed: '生成失败',
}

/** 我的伴奏：我的库「应用歌单 · 伴奏」的主体，含统计与操作、生成队列、已生成列表；各处伴奏入口都跳到这里。 */
export function AccompanimentsLibrary() {
  const { items, jobs, paused, loaded, error, load, cancel, retry, setPaused, remove, directory } = useKaraokeStore()
  const { models, load: loadModels } = useKaraokeModelsStore()
  const [query, setQuery] = useState('')
  const [versions, setVersions] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<string | null>(null)
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
  const manage = () => { const navigation = useNavigationStore.getState(); navigation.requestSettingsKaraoke(); navigation.navigateTo('settings') }
  const notify = (error: unknown) => useToastStore.getState().show(error instanceof Error ? error.message : '操作失败，请重试')
  async function deleteVersion(item: Accompaniment) {
    if (!window.confirm(`删除「${item.track.name}」的 ${modelName(item.model)} 伴奏文件？其他模型版本和原曲会保留。`)) return
    setDeleting(item.id)
    try { await remove(item.id) } catch (error) { notify(error) }
    finally { setDeleting(null) }
  }
  return <div className={styles.scope}>
      <div className={styles.summary}>
        <p>已生成 {new Set(items.map(item => karaokeTrackKey(item.track))).size} 首 · {items.length} 个版本</p>
        <div className={styles.actions}>
          <button className={styles.primary} disabled={!tracks.length} onClick={() => usePlaylistStore.getState().setQueue(tracks, 0)}>播放全部</button>
          <button onClick={manage}>保存位置与模型</button>
          <button disabled={!loaded} onClick={() => void load().catch(notify)}>刷新</button>
        </div>
      </div>
      {error && <div className={styles.notice} role="alert">{error}</div>}
      {!!jobs.length && <section className={styles.queue} aria-label="伴奏生成队列">
        <div className={styles.sectionHead}><h2>生成队列 <span>{jobs.length}</span></h2>
          <button onClick={() => setPaused(!paused)}>{paused ? '继续队列' : '暂停后续任务'}</button>
        </div>
        {paused && <p className={styles.hint}>队列已暂停，正在生成的任务会继续完成。</p>}
        <ul className={styles.jobs}>{jobs.map((job, index) => <li key={job.id}>
          <span className={styles.number}>{index + 1}</span>
          <div className={styles.jobInfo}><strong title={job.track.name}>{job.track.name}</strong><span>{job.track.artist} · {modelName(job.model)}</span>
            <span className={job.phase === 'failed' ? styles.error : styles.hint}>{job.error ?? PHASE[job.phase]}{['model', 'separating'].includes(job.phase) ? ` ${Math.round(job.progress * 100)}%` : ''}</span>
            {['model', 'separating'].includes(job.phase) && <progress aria-label={`${job.track.name}生成进度`} max="1" value={job.progress} />}
          </div>
          <div className={styles.actions}>{job.phase === 'failed' && <button onClick={() => retry(job.id)}>重试</button>}
            <button disabled={job.phase === 'saving'} onClick={() => cancel(job.id)}>{job.phase === 'failed' ? '移出队列' : '取消'}</button>
          </div>
        </li>)}</ul>
      </section>}
      <div className={styles.sectionHead}><h2>已生成的伴奏</h2>
        <input type="search" aria-label="搜索伴奏" placeholder="搜索歌曲或艺人" value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      {!loaded ? <div className={styles.empty} role="status">正在读取伴奏…</div>
        : !groups.length ? <div className={styles.empty}><h3>{query ? '没有匹配的伴奏' : '还没有生成伴奏'}</h3>
          {!query && <p>播放歌曲后，在播放栏的“更多”中选择“为这首歌生成伴奏”。</p>}
        </div>
        : <ul className={styles.library}>{groups.map(([key, entries], index) => {
          const item = visible[index]
          return <li key={key} data-playing={currentId === `karaoke:${item.id}`}>
            <button className={styles.song} disabled={!item.available} aria-label={`播放伴奏：${item.track.name}`} onClick={() => {
              const position = tracks.findIndex(track => String(track.id) === `karaoke:${item.id}`)
              if (position >= 0) usePlaylistStore.getState().setQueue(tracks, position)
            }}>
              <span className={styles.artwork}>{item.track.cover ? <img src={accompanimentTrack(item).cover} alt="" loading="lazy" /> : <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M9 18V5l11-2v13M9 9l11-2" /><ellipse cx="6" cy="18" rx="3" ry="2" /><ellipse cx="17" cy="16" rx="3" ry="2" /></svg>}</span>
              <span className={styles.songInfo}><strong title={item.track.name}>{item.track.name}</strong><span title={item.track.artist}>{item.track.artist}{!item.available ? ' · 文件已丢失' : ''}</span></span>
            </button>
            {entries.length > 1 ? <select aria-label={`${item.track.name}的伴奏模型版本`} value={item.id} onChange={event => setVersions(current => ({ ...current, [key]: event.target.value }))}>
              {entries.map(entry => <option key={entry.id} value={entry.id}>{modelName(entry.model)}{!entry.available ? '（文件丢失）' : ''}</option>)}
            </select> : <span className={styles.model}>{modelName(item.model)}</span>}
            <div className={styles.actions}>
              <button title={item.directory} onClick={() => void window.desktop?.openDirectory(item.directory).then(result => { if (!result.ok) notify(new Error(result.error ?? '文件夹打开失败')) }).catch(notify)}>打开文件夹</button>
              {!item.available && <button onClick={() => void useKaraokeStore.getState().enqueue(item.track, item.model).catch(notify)}>重新生成</button>}
              <button className={styles.delete} disabled={deleting !== null} onClick={() => void deleteVersion(item)}>{deleting === item.id ? '删除中…' : '删除'}</button>
            </div>
          </li>
        })}</ul>}
      {directory && <p className={styles.path} title={directory}>新伴奏保存到 {directory}</p>}
    </div>
}
