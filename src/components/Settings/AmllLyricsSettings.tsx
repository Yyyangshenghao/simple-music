import { useState } from 'react'
import { motion } from 'framer-motion'
import { normalizeLyricsSourceOrder, useLyricsSourceStore } from '../../stores/lyrics-source'
import { useSettingsStore } from '../../stores/settings'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { LYRIC_SOURCE_LABELS, LYRICS_TEST_SONGS, type LyricPrioritySource } from '../../types/lyrics-source'
import { InfoButton } from '../ui/InfoButton'
import styles from './AmllLyricsSettings.module.css'

export function AmllLyricsSettings() {
  const sourceOrder = useLyricsSourceStore(s => s.sourceOrder)
  const remembered = useLyricsSourceStore(s => s.remembered)
  const health = useLyricsSourceStore(s => s.health)
  const probes = useLyricsSourceStore(s => s.probes)
  const enabled = useSettingsStore(s => s.lyricsAmllFallback)
  const setEnabled = useSettingsStore(s => s.setLyricsAmllFallback)
  const kugouEnabled = useSettingsStore(s => s.lyricsKugouFallback)
  const setKugouEnabled = useSettingsStore(s => s.setLyricsKugouFallback)
  const reduced = useReducedMotion()
  const [sample, setSample] = useState('sunny')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(20)
  const [confirmClear, setConfirmClear] = useState(false)
  const order = normalizeLyricsSourceOrder(sourceOrder)
  const entries = Object.entries(remembered)
  const filtered = entries.filter(([, song]) => `${song.name} ${song.artist} ${LYRIC_SOURCE_LABELS[song.origin]}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const move = (index: number, direction: number) => {
    const next = [...order]
    const other = index + direction
    if (other < 0 || other >= next.length) return
    const previous = next[index]
    next[index] = next[other]
    next[other] = previous
    useLyricsSourceStore.getState().setSourceOrder(next)
  }
  const test = (source: LyricPrioritySource) => {
    if (source === 'amll' && !enabled) setEnabled(true)
    if (source === 'kugou' && !kugouEnabled) setKugouEnabled(true)
    void useLyricsSourceStore.getState().testSource(source, sample).catch(() => {})
  }

  return <section className={styles.group}>
    <h3 className={styles.title}>歌词来源<InfoButton label="歌词来源" text="已记住的歌曲选择优先，其余按下方顺序查找，不可用时继续下一项。Apple Music 先读取曲目自带歌词，本地歌曲只读取同目录同名歌词。在线匹配会向对应歌词服务发送歌曲标识或歌名、歌手与时长。调整顺序从下一首歌曲生效。连续连接失败会暂停本次运行的自动访问，测试成功后恢复；测试不会切歌或替换正在显示的歌词。" /></h3>
    <div className={styles.sampleRow}>
      <label htmlFor="lyrics-test-song">测试歌曲</label>
      <select id="lyrics-test-song" className={`${styles.select} no-drag`} value={sample} onChange={event => setSample(event.target.value)}>
        {LYRICS_TEST_SONGS.map(song => <option key={song.key} value={song.key}>{song.name} · {song.artist}</option>)}
      </select>
    </div>
    <ol className={styles.priorityList} aria-label="歌词来源优先级">
      {order.map((source, index) => {
        const probe = probes[source]
        const suspended = health[source]?.suspended
        const disabled = source === 'amll' ? !enabled : source === 'kugou' ? !kugouEnabled : false
        const status = probe?.status === 'loading' ? '正在获取测试歌词…'
          : suspended ? probe?.status === 'empty' || probe?.status === 'mismatch' ? '测试曲未收录，仍暂停访问' : '连接异常，稍后自动重试'
          : disabled ? '已停用'
          : probe?.status === 'ready' ? `已获取歌词 · ${probe.ms} ms`
          : probe?.status === 'empty' || probe?.status === 'mismatch' ? '测试曲未收录，可换一首再试'
          : probe?.status === 'error' ? '暂时连接失败，可重新测试'
          : probe?.message ?? ''
        return <motion.li key={source} layout={!reduced} transition={{ duration: reduced ? 0 : 0.2 }} className={styles.sourceRow}>
          <span className={styles.rank} aria-label={`第 ${index + 1} 优先级`}>{index + 1}</span>
          <div className={styles.sourceName}><strong>{LYRIC_SOURCE_LABELS[source]}</strong><span role="status" className={suspended ? styles.statusIssue : ''}>{status}</span></div>
          <button type="button" className={`${styles.probe} no-drag`} disabled={probe?.status === 'loading'} onClick={() => test(source)}>
            {probe?.status === 'loading' ? '测试中…' : disabled && (source === 'amll' || source === 'kugou') ? '启用并测试' : suspended ? '测试恢复' : '测试'}
          </button>
          <div className={styles.reorder}>
            <button type="button" aria-label={`提高${LYRIC_SOURCE_LABELS[source]}优先级`} disabled={index === 0} onClick={() => move(index, -1)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 10 4-4 4 4" /></svg></button>
            <button type="button" aria-label={`降低${LYRIC_SOURCE_LABELS[source]}优先级`} disabled={index === order.length - 1} onClick={() => move(index, 1)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 6 4 4 4-4" /></svg></button>
          </div>
        </motion.li>
      })}
    </ol>
    <details className={styles.remembered}>
      <summary>歌曲来源记忆 <span>{entries.length} 首</span></summary>
      <div className={styles.memoryBody}>
        {entries.length ? <>
          <input className={styles.search} type="search" aria-label="查找已记住来源的歌曲" placeholder="搜索歌曲、歌手或来源" value={search} onChange={event => { setSearch(event.target.value); setLimit(20) }} />
          <ul className={styles.memoryList}>
            {filtered.slice(0, limit).map(([key, song]) => <li key={key}>
              <div><strong title={`${song.name} · ${song.artist}`}>{song.name}</strong><span>{song.artist} · {LYRIC_SOURCE_LABELS[song.origin]}</span></div>
              <button type="button" className={styles.probe} onClick={() => useLyricsSourceStore.getState().forgetTrack(key)} aria-label={`忘记${song.name}的歌词来源`}>忘记选择</button>
            </li>)}
          </ul>
          {!filtered.length && <p className={styles.hint}>没有匹配的歌曲</p>}
          {filtered.length > limit && <button type="button" className={styles.probe} onClick={() => setLimit(value => value + 20)}>显示更多</button>}
          {confirmClear ? <div className={styles.clearConfirm}>
            <p>清除这 {entries.length} 首歌曲的来源选择？当前歌词继续显示，之后按来源顺序查找。</p>
            <div><button type="button" className={styles.probe} onClick={() => setConfirmClear(false)}>保留</button><button type="button" className={styles.probe} onClick={() => { useLyricsSourceStore.getState().clearRemembered(); setConfirmClear(false) }}>清除记忆</button></div>
          </div> : <button type="button" className={styles.clearAll} onClick={() => setConfirmClear(true)}>清除全部记忆…</button>}
        </> : <p className={styles.hint}>在歌词页选择来源并记住后，可在这里查看和管理。</p>}
      </div>
    </details>
  </section>
}
