import { Select } from '../ui/Select'
import { useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import { normalizeLyricsSourceOrder, useLyricsSourceStore } from '../../stores/lyrics-source'
import { useSettingsStore } from '../../stores/settings'
import { useProviderStore } from '../../stores/providers'
import { useNavigationStore } from '../../stores/navigation'
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
  const apple = providers.apple
  const appleConnected = apple?.auth === 'authenticated' && apple.enabled
  // Apple Music 始终列出：未连接、已退出、连接断开或未启用时置灰锁定，表明这一项暂不生效。
  const visible = order
  const appleAction = apple?.auth === 'expired' ? '重新连接' : apple?.auth === 'authenticated' ? '去启用' : '去连接'
  const appleStatus = apple?.auth === 'expired' ? 'Apple Music 连接已断开，重新连接后生效'
    : apple?.auth === 'authenticated' ? 'Apple Music 未启用，启用后生效' : '未连接 Apple Music，连接后生效'
  const openAccounts = () => useNavigationStore.getState().requestSettingsMusic()
  const entries = Object.keys(remembered)
  const move = (index: number, direction: number) => {
    const other = visible[index + direction]
    if (!other) return
    const next = [...order]
    const from = next.indexOf(visible[index])
    const to = next.indexOf(other)
    next[from] = other
    next[to] = visible[index]
    useLyricsSourceStore.getState().setSourceOrder(next)
  }
  const locked = (source: LyricPrioritySource) => source === 'apple' && !appleConnected
  const isOn = (source: LyricPrioritySource) => source === 'amll' ? enabled : source === 'kugou' ? kugouEnabled : platformSources[source] && !locked(source)
  const toggle = (source: LyricPrioritySource, value: boolean) => {
    if (source === 'amll') setEnabled(value)
    else if (source === 'kugou') setKugouEnabled(value)
    else if (source === 'apple') { if (!locked(source)) setPlatformSource(source, value) }
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
    <h3 className={styles.title}>歌词来源<InfoButton label="歌词来源" text="已记住的歌曲选择优先，其余按下方顺序查找，不可用时继续下一项。Apple Music 需已连接并启用：Apple 曲目读取自带歌词，其他歌曲按歌名、歌手与时长匹配 Apple 目录中的同一录音；未连接、连接断开或未启用时这一项置灰，不参与查找。网易云、QQ 未登录或已停用播放时，以游客身份查询歌词，不使用账号，只发送歌名与歌手。不想用的来源直接关闭，关闭后不再向它查询歌词，也不影响播放音源。本地歌曲优先使用同目录同名 .lrc 或文件内嵌的同步歌词；都没有时，只有标题、艺人和时长标签齐全才在线匹配同一录音，不上传文件或路径。在线匹配会向对应歌词服务发送歌曲标识或歌名、歌手与时长。调整顺序从下一首歌曲生效。连续连接失败会暂停本次运行的自动访问，测试成功后恢复；测试不会切歌或替换正在显示的歌词。" /></h3>
    <div data-setting-row className={styles.sampleRow}>
      <label htmlFor="lyrics-test-song">测试歌曲</label>
      <Select id="lyrics-test-song" className={styles.select} aria-label="测试歌曲" value={sample} onChange={setSample}
        options={LYRICS_TEST_SONGS.map(song => ({ value: song.key, label: `${song.name} · ${song.artist}` }))} />
    </div>
    <ol className={styles.priorityList} aria-label="歌词来源优先级">
      {visible.map((source, index) => {
        const probe = probes[source]
        const suspended = health[source]?.suspended
        const on = isOn(source)
        const account = source !== 'amll' && source !== 'kugou' && providers[source]?.enabled && providers[source]?.auth === 'authenticated'
        const status = locked(source) ? appleStatus
          : !on ? '已关闭'
          : probe?.status === 'loading' ? '正在获取测试歌词…'
          : suspended ? probe?.status === 'empty' || probe?.status === 'mismatch' ? '测试曲未收录，仍暂停访问' : '连接异常，稍后自动重试'
          : probe?.status === 'ready' ? `已获取歌词 · ${probe.ms} ms`
          : probe?.status === 'empty' || probe?.status === 'mismatch' ? '测试曲未收录，可换一首再试'
          : probe?.status === 'error' ? '暂时连接失败，可重新测试'
          : probe?.message ?? (source === 'amll' || source === 'kugou' || account ? '' : '未登录，以游客身份查询')
        return <motion.li data-setting-row key={source} layout={!reduced} transition={{ duration: reduced ? 0 : 0.2 }} className={styles.sourceRow} data-off={!on || undefined} data-locked={locked(source) || undefined}>
          <span className={styles.rank} aria-label={`第 ${index + 1} 优先级`}>{index + 1}</span>
          <div className={styles.sourceName}><strong data-setting-label>{LYRIC_SOURCE_LABELS[source]}</strong><span role="status" className={on && suspended ? styles.statusIssue : ''}>{status}</span></div>
          {locked(source)
            ? <button type="button" className={`${styles.probe} no-drag`} onClick={openAccounts}>{appleAction}</button>
            : <button type="button" className={`${styles.probe} no-drag`} disabled={!on || probe?.status === 'loading'} onClick={() => test(source)}>
              {probe?.status === 'loading' ? '测试中…' : suspended ? '测试恢复' : '测试'}
            </button>}
          <Switch checked={on} disabled={locked(source)} onChange={value => toggle(source, value)} aria-label={`使用${LYRIC_SOURCE_LABELS[source]}`} />
          <div className={styles.reorder}>
            <button type="button" aria-label={`提高${LYRIC_SOURCE_LABELS[source]}优先级`} disabled={index === 0 || locked(source)} onClick={() => move(index, -1)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 10 4-4 4 4" /></svg></button>
            <button type="button" aria-label={`降低${LYRIC_SOURCE_LABELS[source]}优先级`} disabled={index === visible.length - 1 || locked(source)} onClick={() => move(index, 1)}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 6 4 4 4-4" /></svg></button>
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
