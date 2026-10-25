import { useEffect, useMemo, useRef, useState } from 'react'
import { rememberableOrigins, useLyricsSourceStore } from '../../stores/lyrics-source'
import { useToastStore } from '../../stores/toast'
import { LYRIC_ORIGINS, LYRIC_PRIORITY_SOURCES, LYRIC_SOURCE_LABELS, type LyricOrigin, type RememberedLyricSource } from '../../types/lyrics-source'
import styles from './LyricsMemoryDialog.module.css'

export type MemorySort = 'recent' | 'name' | 'artist'
export interface MemoryQuery { search: string; origin: LyricOrigin | 'all'; sort: MemorySort }
export type MemoryEntry = [string, RememberedLyricSource]

const PAGE = 80
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

export function LyricsMemoryDialog({ onClose }: { onClose(): void }) {
  const remembered = useLyricsSourceStore(s => s.remembered)
  const dialog = useRef<HTMLDialogElement>(null)
  const [search, setSearch] = useState('')
  const [origin, setOrigin] = useState<LyricOrigin | 'all'>('all')
  const [sort, setSort] = useState<MemorySort>('recent')
  const [limit, setLimit] = useState(PAGE)
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [confirm, setConfirm] = useState<'selected' | 'all' | null>(null)
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

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { if (element?.open) element.close() }
  }, [])
  useEffect(() => { if (!entries.length) onClose() }, [entries.length, onClose])

  const reset = () => { setLimit(PAGE); setConfirm(null) }
  const toggle = (key: string) => setPicked(current => {
    const next = new Set(current)
    if (!next.delete(key)) next.add(key)
    return next
  })
  // 主窗口的动作经播放宿主执行并返回 Promise；保存失败由宿主提示，这里只在成功后反馈。
  const update = (keys: string[], next: LyricOrigin | null, done: () => void) => {
    if (!keys.length) return
    void Promise.resolve(useLyricsSourceStore.getState().updateRemembered(keys, next)).then(saved => { if (saved) done() }, () => {})
  }
  const change = (keys: string[], next: LyricOrigin) => update(keys, next, () => {
    if (keys.length > 1) useToastStore.getState().show(`已将 ${keys.length} 首歌曲改为${LYRIC_SOURCE_LABELS[next]}`)
  })
  const forget = (keys: string[]) => update(keys, null, () => {
    setPicked(new Set())
    setConfirm(null)
    if (keys.length > 1) useToastStore.getState().show(`已忘记 ${keys.length} 首歌曲的来源选择`)
  })
  const clearAll = () => {
    useLyricsSourceStore.getState().clearRemembered()
    setConfirm(null)
  }

  return <dialog ref={dialog} className={`${styles.dialog} no-drag`} aria-labelledby="lyrics-memory-title"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <h2 id="lyrics-memory-title">歌曲歌词来源</h2>
        <p>{entries.length} 首歌曲使用指定来源，改动从下次播放该歌曲时生效</p>
      </div>
      <button type="button" className={styles.close} aria-label="关闭歌曲歌词来源" onClick={onClose}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <div className={styles.toolbar}>
      <input className={styles.search} type="search" aria-label="查找歌曲" placeholder="搜索歌名或歌手" value={search}
        onChange={event => { setSearch(event.target.value); reset() }} />
      <select className={styles.select} aria-label="排序" value={sort} onChange={event => { setSort(event.target.value as MemorySort); reset() }}>
        <option value="recent">最近添加</option>
        <option value="name">按歌名</option>
        <option value="artist">按歌手</option>
      </select>
    </div>
    <div className={styles.filters} role="radiogroup" aria-label="按来源筛选">
      <button type="button" role="radio" aria-checked={activeOrigin === 'all'} onClick={() => { setOrigin('all'); reset() }}>全部<span>{entries.length}</span></button>
      {LYRIC_ORIGINS.filter(item => counts[item]).map(item => <button key={item} type="button" role="radio" aria-checked={activeOrigin === item}
        onClick={() => { setOrigin(item); reset() }}>{LYRIC_SOURCE_LABELS[item]}<span>{counts[item]}</span></button>)}
    </div>
    <div className={styles.listHead}>
      <label className={styles.check}>
        <input type="checkbox" checked={allSelected} disabled={!visible.length}
          ref={element => { if (element) element.indeterminate = selected.length > 0 && !allSelected }}
          onChange={() => setPicked(allSelected ? new Set() : new Set(visible.map(([key]) => key)))} aria-label="全选当前列表" />
        <span>歌曲</span>
      </label>
      <span>歌词来源</span>
    </div>
    <ul className={styles.list} aria-label="已指定来源的歌曲" onScroll={event => {
      const element = event.currentTarget
      if (limit < visible.length && element.scrollTop + element.clientHeight > element.scrollHeight - 240) setLimit(value => value + PAGE)
    }}>
      {visible.slice(0, limit).map(([key, song]) => <li key={key} data-selected={picked.has(key)}>
        <label className={styles.check}>
          <input type="checkbox" checked={picked.has(key)} onChange={() => toggle(key)} aria-label={`选择${song.name}`} />
          <span className={styles.song}>
            <strong title={song.name}>{song.name}</strong>
            <small title={song.artist}>{song.artist || '未知歌手'}<em>{TRACK_PLATFORM[key.slice(0, key.indexOf(':'))]}</em></small>
          </span>
        </label>
        <select className={styles.select} aria-label={`${song.name}的歌词来源`} value={song.origin}
          onChange={event => change([key], event.target.value as LyricOrigin)}>
          {rememberableOrigins(key).map(item => <option key={item} value={item}>{LYRIC_SOURCE_LABELS[item]}</option>)}
        </select>
        <button type="button" className={styles.forget} aria-label={`忘记${song.name}的歌词来源`} title="忘记选择，改回按来源顺序查找" onClick={() => forget([key])}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
        </button>
      </li>)}
      {!visible.length && <li className={styles.empty}>没有匹配的歌曲</li>}
    </ul>
    <footer className={styles.footer}>
      {confirm ? <div className={styles.confirm} role="alert">
        <p>{confirm === 'all' ? `清除全部 ${entries.length} 首歌曲的来源选择？` : `忘记所选 ${selected.length} 首歌曲的来源选择？`}当前歌词继续显示，之后按来源顺序查找。</p>
        <div>
          <button type="button" className={styles.action} onClick={() => setConfirm(null)}>保留</button>
          <button type="button" className={`${styles.action} ${styles.danger}`} onClick={() => confirm === 'all' ? clearAll() : forget(selected)}>{confirm === 'all' ? '清除全部' : '忘记所选'}</button>
        </div>
      </div> : selected.length ? <div className={styles.batch}>
        <span>已选 {selected.length} 首</span>
        <select className={styles.select} aria-label="将所选歌曲改为" value="" onChange={event => change(selected, event.target.value as LyricOrigin)}>
          <option value="" disabled>改为…</option>
          {LYRIC_PRIORITY_SOURCES.map(item => <option key={item} value={item}>{LYRIC_SOURCE_LABELS[item]}</option>)}
        </select>
        <button type="button" className={styles.action} onClick={() => selected.length > 1 ? setConfirm('selected') : forget(selected)}>忘记所选</button>
        <button type="button" className={styles.link} onClick={() => setPicked(new Set())}>取消选择</button>
      </div> : <div className={styles.batch}>
        <span className={styles.muted}>勾选歌曲可批量修改或忘记</span>
        <button type="button" className={styles.link} onClick={() => setConfirm('all')}>清除全部记忆…</button>
      </div>}
    </footer>
  </dialog>
}
