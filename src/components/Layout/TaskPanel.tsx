import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useOfflineCacheStore, type OfflineSaveJob } from '../../stores/offline-cache'
import { useKaraokeStore } from '../../stores/karaoke'
import { useKaraokeModelsStore } from '../../stores/karaoke-models'
import { useTaskCenterStore, type TaskTab } from '../../stores/task-center'
import { usePlaylistStore } from '../../stores/playlist'
import { openAccompanimentsLibrary, openOfflineLibrary } from '../../stores/navigation'
import { offlineTrackKey } from '../../lib/offline-cache'
import { accompanimentTrack } from '../../lib/karaoke-library'
import { api } from '../../lib/api'
import { sizedImage } from '../../lib/image-size'
import { useMotion } from '../../hooks/useMotion'
import { useSystemReducedMotion } from '../../hooks/useSystemReducedMotion'
import { springGentle, taskPopoverMotion } from '../../lib/motion-presets'
import type { KaraokeJob, KaraokeJobPhase, RecentKaraokeJob } from '../../lib/karaoke/queue'
import type { Track } from '../../types/domain'
import { ActionButton } from '../ui/ActionButton'
import type { ActionIconName } from '../ui/ActionIcon'
import { HoverTips } from '../ui/HoverTips'
import { SourceName } from '../ui/SourceName'
import styles from './TaskPanel.module.css'

const sizeText = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`
const downloadLabels = { queued: '等待下载', resolving: '寻找音源…', saving: '下载中…', exporting: '写入歌曲文件…', done: '下载完成', failed: '下载失败' }
const karaokeLabels: Record<KaraokeJobPhase, string> = { queued: '等待生成', 'waiting-memory': '等待内存释放', resolving: '正在读取歌曲', model: '正在下载模型', preparing: '正在准备模型', decoding: '正在解码音频', separating: '正在生成伴奏', saving: '正在保存', failed: '生成失败' }
const modelNames = { hq3: 'HQ3 标准', 'hq3-fp16': 'HQ3 省显存', kara2: 'Kara2 保留和声' }
const groups = ['running', 'waiting', 'failed', 'done'] as const
const groupName = { running: '进行中', waiting: '等待', failed: '失败', done: '已完成' }
type Group = typeof groups[number]
interface Row {
  key: string
  group: Group
  track: Track
  label: string
  model?: string
  progress?: number | null
  primary?: { label: string; icon: ActionIconName; title?: string; disabled?: boolean; action(): unknown }
  dismiss?: () => unknown
}

export function TaskPanel() {
  const tab = useTaskCenterStore(state => state.tab)
  const summary = useTaskCenterStore(state => state.summary)
  const seenResults = useTaskCenterStore(state => state.seenResults)
  const focusRequest = useTaskCenterStore(state => state.focusRequest)
  const downloads = useOfflineCacheStore()
  const karaoke = useKaraokeStore()
  const models = useKaraokeModelsStore(state => state.models)
  const indicator = useMotion('indicatorMotion')
  const pageMotion = useMotion('pageTransitionMotion')
  const reduceMotion = useSystemReducedMotion()
  const present = useIsPresent()
  const rowMotion = pageMotion && !reduceMotion
  const [more, setMore] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<TaskTab, string>>>({})
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const pending = useRef(new Set<string>())
  const mounted = useRef(true)
  const list = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const positions = useRef<Record<TaskTab, number>>({ download: 0, karaoke: 0 })
  const [height, setHeight] = useState<number | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const paused = tab === 'download' ? downloads.paused : karaoke.paused
  const directory = tab === 'download' ? downloads.downloadDir : karaoke.directory
  const directoryError = tab === 'download' ? downloads.directoryError : ''
  const getDownloads = useOfflineCacheStore.getState
  const getKaraoke = useKaraokeStore.getState

  async function run(key: string, action: () => unknown) {
    if (pending.current.has(key)) return
    const targetTab = tab
    pending.current.add(key)
    setBusy(new Set(pending.current))
    setErrors(current => ({ ...current, [targetTab]: '' }))
    try { await action() }
    catch (error) {
      if (mounted.current) setErrors(current => ({ ...current, [targetTab]: error instanceof Error ? error.message : '操作失败，请重试' }))
    } finally {
      pending.current.delete(key)
      if (mounted.current) setBusy(new Set(pending.current))
    }
  }
  useEffect(() => {
    mounted.current = true
    void getDownloads().loadDownloadDir().catch(() => {})
    void getKaraoke().load().catch(() => {})
    void useKaraokeModelsStore.getState().load()
    return () => { mounted.current = false }
  }, [])
  useEffect(() => { setMore(false) }, [tab])
  useEffect(() => {
    if (!more) return
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setMore(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setMore(false) } }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true) }
  }, [more])
  useLayoutEffect(() => {
    if (!list.current || !content.current) return
    const element = content.current
    list.current.scrollTop = positions.current[tab]
    const measure = () => setHeight(Math.max(110, element.offsetHeight + 12))
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [tab])
  useLayoutEffect(() => {
    if (!focusRequest || !list.current) { setHighlight(null); return }
    const element = [...list.current.querySelectorAll<HTMLElement>('[data-task-id]')].find(item => item.dataset.taskId === focusRequest.id)
    if (!element) return
    const viewport = list.current
    // 用布局坐标定位，不读取 FLIP 动画中的临时位移；面板展开时直接呈现目标。
    viewport.scrollTo({ top: Math.max(0, element.offsetTop - (viewport.clientHeight - element.offsetHeight) / 2), behavior: 'instant' })
    setHighlight(focusRequest.id)
    const timer = setTimeout(() => setHighlight(null), 1400)
    return () => clearTimeout(timer)
  }, [focusRequest, tab])

  async function changeDirectory() {
    const result = await window.desktop?.selectDirectory({ title: tab === 'download' ? '选择歌曲下载目录' : '选择伴奏保存目录', defaultPath: directory || undefined })
    if (result?.ok && result.filePath) {
      if (tab === 'download') await getDownloads().setDownloadDir(result.filePath)
      else await getKaraoke().setDirectory(result.filePath)
    } else if (result && !result.canceled) throw new Error('无法选择保存目录，请重试')
  }
  async function openDirectory(path: string) {
    const result = await window.desktop?.openDirectory(path)
    if (!result?.ok) throw new Error('无法打开文件夹，请确认目录存在')
  }
  function downloadRow(job: OfflineSaveJob): Row {
    const key = offlineTrackKey(job.track)
    const group = job.status === 'done' ? 'done' : job.status === 'failed' ? 'failed' : job.status === 'queued' ? 'waiting' : 'running'
    const progress = job.status === 'saving' && job.totalBytes ? Math.max(0, Math.min(1, (job.receivedBytes ?? 0) / job.totalBytes)) : null
    return { key: `d:${key}`, group, track: job.track,
      label: job.error || (job.status === 'done' ? job.filePath?.split(/[/\\]/).pop() || downloadLabels.done
        : job.status === 'queued' && downloads.paused ? '已暂停' : downloadLabels[job.status])
        + (progress !== null ? ` ${Math.floor(progress * 100)}% · ${sizeText(job.receivedBytes ?? 0)}/${sizeText(job.totalBytes!)}` : ''),
      progress: group === 'running' ? progress : undefined,
      primary: group === 'failed' ? { label: '重试', icon: 'refresh', action: () => getDownloads().saveMany([job.track]) }
        : group === 'done' ? { label: '文件夹', icon: 'folder', title: `打开所在文件夹：${job.directory}`, action: () => openDirectory(job.directory) } : undefined,
      dismiss: () => group === 'done' || group === 'failed' ? getDownloads().dismissJob(key) : getDownloads().cancelSave(key),
    }
  }
  function karaokeRow(job: KaraokeJob): Row {
    const group = job.phase === 'failed' ? 'failed' : ['queued', 'waiting-memory'].includes(job.phase) ? 'waiting' : 'running'
    const measured = job.phase === 'model' || job.phase === 'separating'
    return { key: `k:${job.id}`, group, track: job.track, model: models.find(model => model.id === job.model)?.name ?? modelNames[job.model],
      label: (job.phase === 'waiting-memory' ? karaokeLabels[job.phase] : job.error) || (job.phase === 'queued' && karaoke.paused ? '已暂停' : karaokeLabels[job.phase])
        + (measured ? ` ${Math.round(job.progress * 100)}%` : ''),
      progress: group === 'running' ? measured ? Math.max(0, Math.min(1, job.progress)) : null : undefined,
      primary: group === 'failed' ? { label: '重试', icon: 'refresh', action: () => getKaraoke().retry(job.id) } : undefined,
      dismiss: job.phase === 'saving' ? undefined : () => getKaraoke().cancel(job.id),
    }
  }
  function completedRow(item: RecentKaraokeJob): Row {
    const saved = karaoke.items.find(entry => entry.id === item.accompanimentId)
    return { key: `k:${item.jobId}`, group: 'done', track: item.track, label: '已加入伴奏库', model: models.find(model => model.id === item.model)?.name ?? modelNames[item.model],
      primary: { label: '播放', icon: 'play', disabled: !saved?.available, title: !saved?.available ? '文件不可用，请在伴奏库中检查' : `播放伴奏：${item.track.name}`,
        action: () => saved && usePlaylistStore.getState().setQueue([accompanimentTrack(saved)], 0) } }
  }
  const rows = tab === 'download' ? downloads.jobs.map(downloadRow) : [...karaoke.jobs.map(karaokeRow), ...karaoke.recent.map(completedRow)]
  const estimatedHeight = Math.max(110, 12 + groups.reduce((sum, group) => {
    const count = rows.filter(row => row.group === group).length
    return sum + (count ? 44 + count * 78 : 0)
  }, 0))
  const running = rows.filter(row => row.group === 'running').length
  const waiting = rows.filter(row => row.group === 'waiting').length
  const failed = rows.filter(row => row.group === 'failed').length
  const status = paused ? running ? '已暂停 · 当前任务完成后暂停后续任务' : '已暂停 · 继续后开始等待任务'
    : running ? `${running} 首${tab === 'download' ? '正在下载' : '正在生成'}${waiting ? ` · ${waiting} 首等待` : ''}`
    : waiting ? `${waiting} 首等待${tab === 'download' ? '下载' : '生成'}`
    : failed ? `${failed} 首失败，可重试或移除` : rows.length ? '任务已完成' : ''
  const error = errors[tab] || (tab === 'download' ? downloads.recoveryError : karaoke.error)
  const retryAll = () => run(`${tab}:retry`, async () => {
    if (tab === 'download') await getDownloads().saveMany(downloads.jobs.filter(job => job.status === 'failed').map(job => job.track))
    else for (const job of karaoke.jobs.filter(job => job.phase === 'failed')) await getKaraoke().retry(job.id)
  })
  const clearCompleted = () => run(`${tab}:clear`, async () => {
    if (tab === 'download') for (const job of downloads.jobs.filter(job => job.status === 'done')) await getDownloads().dismissJob(offlineTrackKey(job.track))
    else await getKaraoke().clearRecent()
  })
  const cancelWaiting = () => {
    setMore(false)
    void run(`${tab}:waiting`, () => tab === 'download' ? getDownloads().cancelWaiting() : getKaraoke().cancelWaiting())
  }
  const contents: ReactNode[] = []
  for (const group of groups) {
    const items = rows.filter(row => row.group === group)
    if (!items.length) continue
    contents.push(<motion.div key={`${tab}:head:${group}`} className={styles.groupHead} role="heading" aria-level={3} aria-label={groupName[group]} layout={rowMotion ? 'position' : false}>
      <span>{groupName[group]} <span>{items.length}</span></span>
      {group === 'failed' && <ActionButton compact label="全部重试" busy={busy.has(`${tab}:retry`)} onClick={() => void retryAll()} />}
      {group === 'done' && <ActionButton compact label="清除" title="仅清除完成记录，已保存的文件会保留" busy={busy.has(`${tab}:clear`)} onClick={() => void clearCompleted()} />}
    </motion.div>)
    for (const row of items) contents.push(<motion.div key={row.key} className={styles.task} data-task-id={row.key} data-highlight={highlight === row.key}
      layout={rowMotion ? 'position' : false} initial={rowMotion ? { opacity: 0, y: 5 } : false} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: rowMotion ? 8 : 0 }} transition={rowMotion ? taskPopoverMotion.row : { duration: 0 }}>
      <span className={styles.cover}>{row.track.cover ? <img src={api.coverImage(sizedImage(row.track.cover, 80))} alt="" loading="lazy" />
        : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M9 18V5l11-2v13M9 9l11-2" /><ellipse cx="6" cy="18" rx="3" ry="2" /><ellipse cx="17" cy="16" rx="3" ry="2" /></svg>}</span>
      <div className={styles.info}>
        <strong title={row.track.name}>{row.track.name}</strong>
        <div className={styles.metadata}><span title={row.track.artist}>{row.track.artist}</span><SourceName source={row.track.source} />{row.model && <span title={row.model}>{row.model}</span>}</div>
        <span className={group === 'failed' ? styles.failure : styles.status} title={row.label}>{row.label}</span>
        {row.progress !== undefined && <progress aria-label={`${row.track.name}任务进度`} max="1" value={row.progress ?? undefined} />}
      </div>
      <div className={styles.taskActions}>{row.primary && <ActionButton compact icon={row.primary.icon} iconOnly label={`${row.primary.label}：${row.track.name}`} title={row.primary.title ?? `${row.primary.label}：${row.track.name}`} disabled={row.primary.disabled || busy.has(`${tab}:retry`)} busy={busy.has(row.key)} onClick={() => void run(row.key, row.primary!.action)} />}
        {row.dismiss && <ActionButton compact icon="close" iconOnly disabled={busy.has(row.key) || (group === 'failed' && busy.has(`${tab}:retry`))}
          title={group === 'done' || group === 'failed' ? '移除记录，已保存的文件保留' : '取消任务'} label={`${group === 'done' || group === 'failed' ? '移除记录' : '取消任务'}：${row.track.name}`} onClick={() => void run(row.key, row.dismiss!)} />}</div>
    </motion.div>)
  }
  return <section id="task-center-panel" role="region" aria-label="任务队列" className={styles.panel} style={{ pointerEvents: present ? 'auto' : 'none' }}>
    <HoverTips match="[data-icon-action], [data-tip-help]" />
    <header className={styles.header}>
      <div className={styles.tabs} role="tablist" aria-label="任务类型">
        {(['download', 'karaoke'] as TaskTab[]).map(id => {
          const failureCount = id === 'download' ? downloads.jobs.filter(job => job.status === 'failed').length : karaoke.jobs.filter(job => job.phase === 'failed').length
          const unread = summary.results.some(key => key.startsWith(id === 'download' ? 'd:' : 'k:') && !seenResults.includes(key))
          return <button type="button" key={id} role="tab" id={`task-tab-${id}`} aria-selected={tab === id} aria-controls="task-center-list" onClick={() => useTaskCenterStore.getState().select(id)}>
            {tab === id && <motion.span className={styles.indicator} layoutId={indicator && !reduceMotion ? 'task-tab-indicator' : undefined} transition={springGentle} />}
            <span>{id === 'download' ? '下载' : '伴奏生成'} {!!(summary[id] + failureCount) && <span className={styles.count}>{summary[id] + failureCount}</span>}
              {(failureCount > 0 || unread) && <i className={styles.tabDot} data-failed={failureCount > 0} title={failureCount ? `${failureCount} 首失败` : '有新的完成结果'} />}</span>
          </button>
        })}
      </div>
      <ActionButton compact iconOnly icon={paused ? 'play' : 'pause'} label={paused ? '继续当前队列' : '暂停当前队列'} title={paused ? '继续队列' : '暂停后续任务，当前任务会完成'} busy={busy.has(`${tab}:pause`)} disabled={!running && !waiting && !paused}
        onClick={() => void run(`${tab}:pause`, () => tab === 'download' ? getDownloads().setPaused(!paused) : getKaraoke().setPaused(!paused))} />
      <div className={styles.moreWrap} ref={menu}>
        <ActionButton compact iconOnly icon="more" label="更多队列操作" aria-expanded={more} onClick={() => setMore(!more)} />
        <AnimatePresence>{more && <motion.div data-task-menu className={styles.menu} initial={{ opacity: 0, y: reduceMotion ? 0 : -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .12 }}>
          <button type="button" disabled={!waiting || busy.has(`${tab}:waiting`)} title="仅取消等待任务，正在处理的任务会继续" onClick={cancelWaiting}>取消全部等待</button>
          <button type="button" disabled={!directory || !window.desktop?.openDirectory} onClick={() => { setMore(false); void run(`${tab}:directory`, () => openDirectory(directory)) }}>打开保存目录</button>
        </motion.div>}</AnimatePresence>
      </div>
      <ActionButton compact iconOnly icon="close" label="关闭任务队列" onClick={() => useTaskCenterStore.getState().close()} />
    </header>
    <div className={styles.queueStatus}>
      <span role="status">{status || '暂无任务'}</span>
      <button type="button" className={styles.libraryLink} aria-label={tab === 'karaoke' ? '前往伴奏库' : '前往离线音乐'} onClick={() => {
        useTaskCenterStore.getState().close()
        if (tab === 'karaoke') openAccompanimentsLibrary()
        else openOfflineLibrary()
      }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4v16M8 4v16M12 6l5-2 4 14-5 2z" /></svg>
        <span>{tab === 'karaoke' ? '伴奏库' : '离线音乐'}</span>
        <svg className={styles.libraryArrow} width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
      </button>
    </div>
    {error && <p className={styles.error} role="alert" title={error}>{error}</p>}
    <div className={styles.list} ref={list} style={{ height: height ?? estimatedHeight }} id="task-center-list" role="tabpanel" aria-labelledby={`task-tab-${tab}`} onScroll={event => { positions.current[tab] = event.currentTarget.scrollTop }}>
      <motion.div key={tab} ref={content} className={styles.listContent} initial={rowMotion ? { opacity: .4 } : false} animate={{ opacity: 1 }} transition={{ duration: .12 }}>
        {!rows.length ? <div className={styles.empty}><strong>{tab === 'download' ? '还没有下载任务' : '还没有生成任务'}</strong><p>{tab === 'download' ? '在歌曲、专辑或歌单的更多菜单中选择下载' : '在播放页的麦克风按钮生成伴奏'}</p></div>
          : <AnimatePresence initial={false} mode="popLayout">{contents}</AnimatePresence>}
      </motion.div>
    </div>
    <footer className={styles.footer}>
      {directoryError ? <><span className={styles.failure} role="alert">{directoryError}</span><ActionButton compact label="重试" busy={busy.has(`${tab}:directory`)} onClick={() => void run(`${tab}:directory`, () => getDownloads().loadDownloadDir())} /></>
        : <><span title={`保存到 ${directory}`}>{directory || '正在读取保存目录…'}</span><ActionButton compact icon="settings" iconOnly label="更改目录" disabled={!window.desktop?.selectDirectory} busy={busy.has(`${tab}:directory`)} title="更改保存目录 · 只影响之后加入的任务，已有文件保留" onClick={() => void run(`${tab}:directory`, changeDirectory)} /></>}
    </footer>
    {tab === 'karaoke' && karaoke.directoryNotice && <p className={styles.directoryNotice}>{karaoke.directoryNotice}</p>}
  </section>
}
