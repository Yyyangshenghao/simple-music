import { useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import { normalizeLyricsSourceOrder, useLyricsSourceStore } from '../../stores/lyrics-source'
import { useSettingsStore } from '../../stores/settings'
import { useProviderStore } from '../../stores/providers'
import { useMotion } from '../../hooks/useMotion'
import { LYRIC_SOURCE_LABELS, LYRICS_TEST_SONGS, type LyricPrioritySource } from '../../types/lyrics-source'
import { InfoButton } from '../ui/InfoButton'
import { Switch } from '../ui/Switch'
import { LyricsMemoryDialog } from './LyricsMemoryDialog'
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
  const guestSources = useSettingsStore(s => s.lyricsGuestSources)
  const setGuestSource = useSettingsStore(s => s.setLyricsGuestSource)
  const platformSources = useSettingsStore(s => s.lyricsPlatformSources)
  const setPlatformSource = useSettingsStore(s => s.setLyricsPlatformSource)
  const providers = useProviderStore(s => s.byId)
  const reduced = !useMotion('dragMotion')
  const [sample, setSample] = useState('sunny')
  const [managing, setManaging] = useState(false)
  const closeManaging = useCallback(() => setManaging(false), [])
  const order = normalizeLyricsSourceOrder(sourceOrder)
  const entries = Object.keys(remembered)
  const move = (index: number, direction: number) => {
    const next = [...order]
    const other = index + direction
    if (other < 0 || other >= next.length) return
    const previous = next[index]
    next[index] = next[other]
    next[other] = previous
    useLyricsSourceStore.getState().setSourceOrder(next)
  }
  const isOn = (source: LyricPrioritySource) => source === 'amll' ? enabled : source === 'kugou' ? kugouEnabled : platformSources[source]
  const toggle = (source: LyricPrioritySource, value: boolean) => {
    if (source === 'amll') setEnabled(value)
    else if (source === 'kugou') setKugouEnabled(value)
    else {
      setPlatformSource(source, value)
      // 游客查询不再单独设开关：重新启用平台时一并恢复，未登录也能直接用。
      if (value && !guestSources[source]) setGuestSource(source, true)
    }
  }
  const test = (source: LyricPrioritySource) => {
    void useLyricsSourceStore.getState().testSource(source, sample).catch(() => {})
  }

  return <section className={styles.group}>
    <h3 className={styles.title}>歌词来源<InfoButton label="歌词来源" text="已记住的歌曲选择优先，其余按下方顺序查找，不可用时继续下一项。Apple Music 先读取曲目自带歌词，网易云、QQ 未登录或已停用播放时，以游客身份查询歌词，不使用账号，只发送歌名与歌手。不想用的来源直接关闭，关闭后不再向它查询歌词，也不影响播放音源。本地歌曲优先使用同目录同名 .lrc 或文件内嵌的同步歌词；都没有时，只有标题、艺人和时长标签齐全才在线匹配同一录音，不上传文件或路径。在线匹配会向对应歌词服务发送歌曲标识或歌名、歌手与时长。调整顺序从下一首歌曲生效。连续连接失败会暂停本次运行的自动访问，测试成功后恢复；测试不会切歌或替换正在显示的歌词。" /></h3>
    <div data-setting-row className={styles.sampleRow}>
      <label htmlFor="lyrics-test-song">测试歌曲</label>
      <select id="lyrics-test-song" className={`${styles.select} no-drag`} value={sample} onChange={event => setSample(event.target.value)}>
        {LYRICS_TEST_SONGS.map(song => <option key={song.key} value={song.key}>{song.name} · {song.artist}</option>)}
      </select>
    </div>
    <ol className={styles.priorityList} aria-label="歌词来源优先级">
      {order.map((source, index) => {
        const probe = probes[source]
        const suspended = health[source]?.suspended
        const on = isOn(source)
        const account = source !== 'amll' && source !== 'kugou' && providers[source]?.enabled && providers[source]?.auth === 'authenticated'
        const status = !on ? '已关闭'
          : probe?.status === 'loading' ? '正在获取测试歌词…'
          : suspended ? probe?.status === 'empty' || probe?.status === 'mismatch' ? '测试曲未收录，仍暂停访问' : '连接异常，稍后自动重试'
          : probe?.status === 'ready' ? `已获取歌词 · ${probe.ms} ms`
          : probe?.status === 'empty' || probe?.status === 'mismatch' ? '测试曲未收录，可换一首再试'
          : probe?.status === 'error' ? '暂时连接失败，可重新测试'
          : probe?.message ?? (source === 'amll' || source === 'kugou' || account ? '' : '未登录，以游客身份查询')
        return <motion.li data-setting-row key={source} layout={!reduced} transition={{ duration: reduced ? 0 : 0.2 }} className={styles.sourceRow} data-off={!on || undefined}>
          <span className={styles.rank} aria-label={`第 ${index + 1} 优先级`}>{index + 1}</span>
          <div className={styles.sourceName}><strong data-setting-label>{LYRIC_SOURCE_LABELS[source]}</strong><span role="status" className={on && suspended ? styles.statusIssue : ''}>{status}</span></div>
          <button type="button" className={`${styles.probe} no-drag`} disabled={!on || probe?.status === 'loading'} onClick={() => test(source)}>
            {probe?.status === 'loading' ? '测试中…' : suspended ? '测试恢复' : '测试'}
          </button>
          <Switch checked={on} onChange={value => toggle(source, value)} aria-label={`使用${LYRIC_SOURCE_LABELS[source]}`} />
          <div className={styles.reorder}>
            <button type="button" aria-label={`提高${LYRIC_SOURCE_LABELS[source]}优先级`} disabled={index === 0} onClick={() => move(index, -1)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 10 4-4 4 4" /></svg></button>
            <button type="button" aria-label={`降低${LYRIC_SOURCE_LABELS[source]}优先级`} disabled={index === order.length - 1} onClick={() => move(index, 1)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 6 4 4 4-4" /></svg></button>
          </div>
        </motion.li>
      })}
    </ol>
    <div data-setting-row className={styles.memoryRow}>
      <div className={styles.sourceName}>
        <strong data-setting-label>歌曲来源记忆</strong>
        <span>{entries.length ? `${entries.length} 首歌曲使用指定来源` : '在歌词页选择来源并记住后，可在这里管理'}</span>
      </div>
      <button type="button" className={`${styles.probe} no-drag`} disabled={!entries.length} onClick={() => setManaging(true)}>管理…</button>
    </div>
    {managing && <LyricsMemoryDialog onClose={closeManaging} />}
  </section>
}
