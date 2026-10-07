import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useOfflineCacheStore, type OfflineSaveJob } from '../../stores/offline-cache'
import { offlineTrackKey } from '../../lib/offline-cache'
import { fadeRise, springSnappy } from '../../lib/motion-presets'
import { SourceName } from '../ui/SourceName'
import styles from './DownloadQueue.module.css'

function active(job: OfflineSaveJob): boolean {
  return job.status !== 'done' && job.status !== 'failed'
}

function sizeText(bytes: number): string {
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function DownloadQueue() {
  const jobs = useOfflineCacheStore((state) => state.jobs)
  const open = useOfflineCacheStore((state) => state.queueOpen)
  const paused = useOfflineCacheStore((state) => state.paused)
  const directory = useOfflineCacheStore((state) => state.downloadDir)
  const directoryError = useOfflineCacheStore((state) => state.directoryError)
  const [filter, setFilter] = useState<'all' | 'active' | 'done' | 'failed'>('all')
  const [pathBusy, setPathBusy] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const running = jobs.filter((job) => active(job) && job.status !== 'queued').length
  const queued = jobs.filter((job) => job.status === 'queued').length
  const failed = jobs.filter((job) => job.status === 'failed').length
  const completed = jobs.filter((job) => job.status === 'done').length
  const visible = jobs.filter((job) => filter === 'all' || (filter === 'active' ? active(job) : job.status === filter))
  const store = useOfflineCacheStore.getState
  const labels = { queued: paused ? '队列已暂停' : '等待下载', resolving: '寻找音源…', saving: '下载中…', exporting: '写入歌曲文件…', done: '下载完成', failed: '下载失败' }

  useEffect(() => { void store().loadDownloadDir().catch(() => {}) }, [])
  useEffect(() => {
    if (!open) return
    setFilter('all')
    function close(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      store().setQueueOpen(false)
      if (root.current?.contains(document.activeElement)) toggle.current?.focus()
    }
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) store().setQueueOpen(false)
    }
    window.addEventListener('keydown', close)
    window.addEventListener('pointerdown', outside)
    return () => {
      window.removeEventListener('keydown', close)
      window.removeEventListener('pointerdown', outside)
    }
  }, [open])

  async function changeDirectory() {
    if (pathBusy) return
    setPathBusy(true)
    setError('')
    try {
      const result = await window.desktop?.selectDirectory({ title: '选择歌曲下载目录', defaultPath: directory || undefined })
      if (result?.ok && result.filePath) await store().setDownloadDir(result.filePath)
      else if (result && !result.canceled) setError('无法选择下载目录，请重试')
    } catch { setError('下载目录不可写，请选择其他文件夹') }
    finally { setPathBusy(false) }
  }

  async function openDirectory(path: string) {
    setError('')
    try {
      const result = await window.desktop?.openDirectory(path)
      if (!result?.ok) setError('无法打开文件夹，请确认目录存在')
    } catch { setError('无法打开下载文件夹') }
  }

  return (
    <div className={`${styles.root} no-drag`} ref={root}>
      <motion.button ref={toggle} type="button" className={styles.toggle} aria-label="下载队列" title="下载队列" aria-expanded={open} aria-controls="song-download-queue" data-active={open} onClick={() => store().setQueueOpen(!open)}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></svg>
        {!!(running + queued) && <span className={styles.badge}>{running + queued}</span>}
        {!running && !queued && failed > 0 && <span className={styles.failureDot} />}
      </motion.button>
      <AnimatePresence>
        {open && <motion.section id="song-download-queue" className={styles.panel} role="region" aria-label="歌曲下载队列" variants={fadeRise} initial="hidden" animate="visible" exit="hidden" transition={springSnappy}>
          <header className={styles.header}>
            <div><h2>下载队列</h2><p role="status">{running} 首进行中 · {queued} 首等待 · {completed} 首完成{failed ? ` · ${failed} 首失败` : ''}</p></div>
            <button type="button" aria-label="关闭下载队列" onClick={() => store().setQueueOpen(false)}>×</button>
          </header>
          <div className={styles.directory}>
            <span>歌曲下载目录</span><strong title={directory}>{directory || '正在读取…'}</strong>
            <div><button type="button" disabled={pathBusy || !window.desktop?.selectDirectory} onClick={() => void changeDirectory()}>{pathBusy ? '选择中…' : '选择目录'}</button><button type="button" disabled={!directory || !window.desktop?.openDirectory} onClick={() => void openDirectory(directory)}>打开目录</button></div>
            <small>更改目录仅用于之后加入的任务，已有文件保留。</small>
          </div>
          <div className={styles.controls}>
            <button type="button" disabled={!paused && !running && !queued} onClick={() => store().setPaused(!paused)}>{paused ? '继续队列' : '暂停队列'}</button>
            <button type="button" disabled={!running && !queued && !!directory} onClick={() => store().cancelSave()}>取消等待及下载</button>
            <button type="button" disabled={!failed} onClick={() => void store().saveMany(jobs.filter((job) => job.status === 'failed').map((job) => job.track)).catch(() => setError('无法重试，请检查下载目录'))}>重试失败</button>
            <button type="button" disabled={!completed} onClick={() => jobs.filter((job) => job.status === 'done').forEach((job) => store().dismissJob(offlineTrackKey(job.track)))}>清除完成记录</button>
          </div>
          {paused && <p className={styles.hint}>新任务暂停开始，正在下载的歌曲会继续完成。</p>}
          <nav className={styles.filters} aria-label="筛选下载任务">
            {([['all', '全部'], ['active', '下载中'], ['done', '已完成'], ['failed', '失败']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
          </nav>
          <div className={styles.list}>
            {!visible.length && <div className={styles.empty}>{!jobs.length ? '在歌曲、专辑或歌单中选择下载，任务会显示在这里。' : '暂无此类任务'}</div>}
            {visible.map((job) => {
              const key = offlineTrackKey(job.track)
              const progress = job.totalBytes ? Math.min(100, Math.floor((job.receivedBytes || 0) / job.totalBytes * 100)) : null
              return <div className={styles.task} key={key}>
                <div className={styles.info}>
                  <strong title={job.track.name}>{job.track.pending ? '正在获取歌曲详情…' : job.track.name}</strong>
                  <span>{job.track.artist} <SourceName source={job.track.source} /></span>
                  <span className={job.status === 'failed' ? styles.error : ''} title={job.error || job.filePath || job.directory}>{job.error || labels[job.status]}{job.status === 'saving' && progress !== null ? ` ${progress}% · ${sizeText(job.receivedBytes || 0)} / ${sizeText(job.totalBytes!)}` : ''}</span>
                  {job.status === 'saving' && <progress aria-label={`${job.track.name}下载进度`} max={100} value={progress ?? undefined} />}
                  {job.status === 'done' && <small title={job.filePath}>{job.filePath}</small>}
                </div>
                <div className={styles.taskActions}>
                  {job.status === 'failed' && <button type="button" onClick={() => void store().save(job.track)}>重试</button>}
                  {job.status === 'done' && <button type="button" onClick={() => void openDirectory(job.directory)}>文件夹</button>}
                  <button type="button" aria-label={`${active(job) ? '取消下载' : '移除记录'}：${job.track.name}`} onClick={() => active(job) ? store().cancelSave(key) : store().dismissJob(key)}>{active(job) ? '取消' : '移除'}</button>
                </div>
              </div>
            })}
          </div>
          {(error || directoryError) && <p className={styles.error} role="alert">{error || directoryError}{directoryError && <button type="button" onClick={() => void store().loadDownloadDir().catch(() => {})}>重试</button>}</p>}
        </motion.section>}
      </AnimatePresence>
    </div>
  )
}
