import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMotion, usePageTransition } from '../../hooks/useMotion'
import { springBouncy, springGentle } from '../../lib/motion-presets'
import { rememberableOrigins, useLyricsSourceStore } from '../../stores/lyrics-source'
import { useToastStore } from '../../stores/toast'
import { LYRIC_ORIGINS, LYRIC_PRIORITY_SOURCES, LYRIC_SOURCE_LABELS, type LyricOrigin, type RememberedLyricSource } from '../../types/lyrics-source'
import { JellyRadio, type JellyRadioItem } from '../ui/JellyRadio'
import { SpringCheck } from '../ui/SpringCheck'
import styles from './LyricsMemoryDialog.module.css'

export type MemorySort = 'recent' | 'name' | 'artist'
export interface MemoryQuery { search: string; origin: LyricOrigin | 'all'; sort: MemorySort }
export type MemoryEntry = [string, RememberedLyricSource]

const PAGE = 80
/** 列表入场逐行错开，只排前几行，长列表不拖慢。 */
const CASCADE = { step: 0.024, rows: 12 }
const rowEase = [0.22, 1, 0.36, 1] as const
const swapTransition = { duration: 0.2, ease: rowEase }
const swap = { initial: { opacity: 0, y: 10, filter: 'blur(6px)' }, animate: { opacity: 1, y: 0, filter: 'blur(0px)' }, exit: { opacity: 0, y: -8, filter: 'blur(6px)' } }
const TRACK_PLATFORM: Record<string, string> = { netease: '网易云', qq: 'QQ', apple: 'Apple Music', local: '本地' }
const collator = new Intl.Collator('zh-CN', { sensitivity: 'base', numeric: true })

/** 筛选与排序只看本地存档，不触发任何歌词查询。最近添加按存档插入顺序倒序。 */
export function queryMemory(entries: MemoryEntry[], { search, origin, sort }: MemoryQuery): MemoryEntry[] {
  const needle = search.trim().toLocaleLowerCase()
  const result = entries.filter(([, song]) => (origin === 'all' || song.origin === origin)
    && (!needle || `${song.name} ${song.artist}`.toLocaleLowerCase().includes(needle)))
  if (sort === 'recent') return result.reverse()
  const field = sort === 'name' ? 'name' : 'artist'
  return result.sort(([, a], [, b]) => collator.compare(a[field], b[field]) || collator.compare(a.name, b.name))
}

/** 数字滚动换位：增大时新数字自下而上，减小时自上而下。 */
function RollingNumber({ value }: { value: number }) {
  const page = usePageTransition()
  const last = useRef(value)
  const direction = value >= last.current ? 1 : -1
  useEffect(() => { last.current = value }, [value])
  return <span className={styles.roll}>
    <AnimatePresence mode="popLayout" initial={false} custom={direction}>
      <motion.span key={value} custom={direction}
        variants={{ enter: (d: number) => ({ y: `${d * 70}%`, opacity: 0 }), center: { y: '0%', opacity: 1 }, leave: (d: number) => ({ y: `${d * -70}%`, opacity: 0 }) }}
        initial="enter" animate="center" exit="leave" transition={page(springGentle)}>{value}</motion.span>
    </AnimatePresence>
  </span>
}

export function LyricsMemoryDialog({ onClose }: { onClose(): void }) {
  const remembered = useLyricsSourceStore(s => s.remembered)
  const dialog = useRef<HTMLDialogElement>(null)
  const page = usePageTransition()
  const pageMotion = useMotion('pageTransitionMotion')
  const [search, setSearch] = useState('')
  const [origin, setOrigin] = useState<LyricOrigin | 'all'>('all')
  const [sort, setSort] = useState<MemorySort>('recent')
  const [limit, setLimit] = useState(PAGE)
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [confirm, setConfirm] = useState<'selected' | 'all' | null>(null)
  const [saved, setSaved] = useState<Readonly<Record<string, number>>>({})
  const [closing, setClosing] = useState(false)
  const entries = useMemo(() => Object.entries(remembered), [remembered])
  const counts = useMemo(() => entries.reduce<Partial<Record<LyricOrigin, number>>>((all, [, song]) => {
    all[song.origin] = (all[song.origin] ?? 0) + 1
    return all
  }, {}), [entries])
  const activeOrigin = origin !== 'all' && counts[origin] ? origin : 'all'
  const visible = useMemo(() => queryMemory(entries, { search, origin: activeOrigin, sort }), [entries, search, activeOrigin, sort])
  // 已被忘记的歌曲自动退出选择，批量操作只作用于仍在列表中的歌曲。
  const selected = visible.filter(([key]) => picked.has(key)).map(([key]) => key)
  const allSelected = visible.length > 0 && selected.length === visible.length
  const filters: JellyRadioItem<LyricOrigin | 'all'>[] = [
    { value: 'all', label: <>全部<span className={styles.count}>{entries.length}</span></>, ariaLabel: `全部 ${entries.length} 首` },
    ...LYRIC_ORIGINS.filter(item => counts[item]).map(item => ({
      value: item, label: <>{LYRIC_SOURCE_LABELS[item]}<span className={styles.count}>{counts[item]}</span></>, ariaLabel: `${LYRIC_SOURCE_LABELS[item]} ${counts[item]} 首`,
    })),
  ]

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { if (element?.open) element.close() }
  }, [])
  // 退场动画播完再卸载；页面转场关闭时立即关闭。
  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(onClose, 180)
    return () => clearTimeout(timer)
  }, [closing, onClose])
  const close = () => { if (pageMotion) setClosing(true); else onClose() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!entries.length) close() }, [entries.length])
  // 保存成功的行短暂亮起对勾，之后自动收起。
  useEffect(() => {
    const keys = Object.keys(saved)
    if (!keys.length) return
    const timer = setTimeout(() => setSaved({}), 1400)
    return () => clearTimeout(timer)
  }, [saved])

  const reset = () => { setLimit(PAGE); setConfirm(null) }
  const toggle = (key: string) => setPicked(current => {
    const next = new Set(current)
    if (!next.delete(key)) next.add(key)
    return next
  })
  // 主窗口的动作经播放宿主执行并返回 Promise；保存失败由宿主提示，这里只在成功后反馈。
  const update = (keys: string[], next: LyricOrigin | null, done: () => void) => {
    if (!keys.length) return
    void Promise.resolve(useLyricsSourceStore.getState().updateRemembered(keys, next)).then(ok => { if (ok) done() }, () => {})
  }
  const change = (keys: string[], next: LyricOrigin) => update(keys, next, () => {
    const at = Date.now()
    setSaved(Object.fromEntries(keys.map(key => [key, at])))
    if (keys.length > 1) useToastStore.getState().show(`已将 ${keys.length} 首歌曲改为${LYRIC_SOURCE_LABELS[next]}`)
  })
  const forget = (keys: string[]) => update(keys, null, () => {
    setPicked(current => new Set([...current].filter(key => !keys.includes(key))))
    setConfirm(null)
    if (keys.length > 1) useToastStore.getState().show(`已忘记 ${keys.length} 首歌曲的来源选择`)
  })
  const clearAll = () => {
    useLyricsSourceStore.getState().clearRemembered()
    setConfirm(null)
  }
  const footer = confirm ? 'confirm' : selected.length ? 'batch' : 'idle'

  return <dialog ref={dialog} className={`${styles.dialog} no-drag`} data-closing={closing || undefined} aria-labelledby="lyrics-memory-title"
    onCancel={event => { event.preventDefault(); close() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
    }}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <h2 id="lyrics-memory-title">歌曲歌词来源</h2>
        <p><RollingNumber value={entries.length} /> 首歌曲使用指定来源，改动从下次播放该歌曲时生效</p>
      </div>
      <button type="button" className={styles.close} aria-label="关闭歌曲歌词来源" onClick={close}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <div className={styles.toolbar}>
      <label className={styles.searchBox}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
        <input className={styles.search} type="search" aria-label="查找歌曲" placeholder="搜索歌名或歌手" value={search}
          onChange={event => { setSearch(event.target.value); reset() }} />
      </label>
      <select className={styles.select} aria-label="排序" value={sort} onChange={event => { setSort(event.target.value as MemorySort); reset() }}>
        <option value="recent">最近添加</option>
        <option value="name">按歌名</option>
        <option value="artist">按歌手</option>
      </select>
    </div>
    <div className={styles.filters}>
      <JellyRadio<LyricOrigin | 'all'> items={filters} value={activeOrigin} size="sm" ariaLabel="按来源筛选" className={styles.jelly}
        onChange={value => { setOrigin(value); reset() }} />
    </div>
    <div className={styles.listHead}>
      <label className={styles.check}>
        <SpringCheck checked={allSelected} indeterminate={selected.length > 0} disabled={!visible.length} aria-label="全选当前列表"
          onChange={() => setPicked(allSelected ? new Set() : new Set(visible.map(([key]) => key)))} />
        <span>歌曲</span>
      </label>
      <span>歌词来源</span>
    </div>
    {/* 换筛选或排序时整表重排入场；搜索只增删行，其余行平滑补位。 */}
    <ul key={`${activeOrigin}|${sort}`} className={styles.list} aria-label="已指定来源的歌曲" onScroll={event => {
      const element = event.currentTarget
      if (limit < visible.length && element.scrollTop + element.clientHeight > element.scrollHeight - 240) setLimit(value => value + PAGE)
    }}>
      <AnimatePresence mode="popLayout">
        {visible.slice(0, limit).map(([key, song], index) => <motion.li key={key} layout="position" data-selected={picked.has(key)}
          initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, x: -32, filter: 'blur(4px)', transition: page({ duration: 0.2, ease: [0.4, 0, 1, 1] }) }}
          transition={page({ duration: 0.32, ease: rowEase, delay: Math.min(index % PAGE, CASCADE.rows) * CASCADE.step, layout: springGentle })}>
          <label className={styles.check}>
            <SpringCheck checked={picked.has(key)} onChange={() => toggle(key)} aria-label={`选择${song.name}`} />
            <span className={styles.song}>
              <strong title={song.name}>{song.name}</strong>
              <small title={song.artist}>{song.artist || '未知歌手'}<em>{TRACK_PLATFORM[key.slice(0, key.indexOf(':'))]}</em></small>
            </span>
          </label>
          <span className={styles.pick}>
            {saved[key] && <span key={saved[key]} className={styles.glow} aria-hidden="true" />}
            <AnimatePresence>
              {saved[key] && <motion.span className={styles.savedMark} aria-hidden="true"
                initial={{ scale: 0, opacity: 0, rotate: -30 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.6, opacity: 0 }}
                transition={page(springBouncy)}>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 8 3 3 6-6" /></svg>
              </motion.span>}
            </AnimatePresence>
            <select className={styles.select} aria-label={`${song.name}的歌词来源`} value={song.origin}
              onChange={event => change([key], event.target.value as LyricOrigin)}>
              {rememberableOrigins(key).map(item => <option key={item} value={item}>{LYRIC_SOURCE_LABELS[item]}</option>)}
            </select>
          </span>
          <button type="button" className={styles.forget} aria-label={`忘记${song.name}的歌词来源`} title="忘记选择，改回按来源顺序查找" onClick={() => forget([key])}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
          </button>
        </motion.li>)}
        {!visible.length && <motion.li key="empty" className={styles.empty} {...swap} transition={page(swapTransition)}>没有匹配的歌曲</motion.li>}
      </AnimatePresence>
    </ul>
    <footer className={styles.footer}>
      <AnimatePresence mode="wait" initial={false}>
        {footer === 'confirm' ? <motion.div key="confirm" className={styles.confirm} role="alert" {...swap} transition={page(swapTransition)}>
          <p>{confirm === 'all' ? `清除全部 ${entries.length} 首歌曲的来源选择？` : `忘记所选 ${selected.length} 首歌曲的来源选择？`}当前歌词继续显示，之后按来源顺序查找。</p>
          <div>
            <button type="button" className={styles.action} onClick={() => setConfirm(null)}>保留</button>
            <button type="button" className={`${styles.action} ${styles.danger}`} onClick={() => confirm === 'all' ? clearAll() : forget(selected)}>{confirm === 'all' ? '清除全部' : '忘记所选'}</button>
          </div>
        </motion.div> : footer === 'batch' ? <motion.div key="batch" className={styles.batch} {...swap} transition={page(swapTransition)}>
          <span aria-label={`已选 ${selected.length} 首`}>已选 <RollingNumber value={selected.length} /> 首</span>
          <select className={styles.select} aria-label="将所选歌曲改为" value="" onChange={event => change(selected, event.target.value as LyricOrigin)}>
            <option value="" disabled>改为…</option>
            {LYRIC_PRIORITY_SOURCES.map(item => <option key={item} value={item}>{LYRIC_SOURCE_LABELS[item]}</option>)}
          </select>
          <button type="button" className={styles.action} onClick={() => selected.length > 1 ? setConfirm('selected') : forget(selected)}>忘记所选</button>
          <button type="button" className={styles.link} onClick={() => setPicked(new Set())}>取消选择</button>
        </motion.div> : <motion.div key="idle" className={styles.batch} {...swap} transition={page(swapTransition)}>
          <span className={styles.muted}>勾选歌曲可批量修改或忘记</span>
          <button type="button" className={styles.link} onClick={() => setConfirm('all')}>清除全部记忆…</button>
        </motion.div>}
      </AnimatePresence>
    </footer>
  </dialog>
}
