import { useState } from 'react'
import { api } from '../../lib/api'
import { AMLL_HOST_LABELS, fastestAmllHost, formatAmllLatency, type AmllHostLatency } from '../../lib/amll-route'
import { AMLL_HOST_PREFERENCES, useSettingsStore } from '../../stores/settings'
import { useLyricsSourceStore } from '../../stores/lyrics-source'
import { useProviderStore } from '../../stores/providers'
import { useNavigationStore } from '../../stores/navigation'
import { LYRIC_SOURCE_LABELS, type LyricSourcePreference } from '../../types/lyrics-source'
import { InfoButton } from '../ui/InfoButton'
import { Switch } from '../ui/Switch'
import styles from './AmllLyricsSettings.module.css'

type ProbeState = { status: 'idle' } | { status: 'running' } | { status: 'done'; hosts: AmllHostLatency[] } | { status: 'error' }

const SOURCE_PREFERENCES: LyricSourcePreference[] = ['auto', 'origin', 'netease', 'qq', 'amll', 'kugou']

/** 歌词默认选择、按歌记忆与补全来源；保留 AMLL 线路和测速。 */
export function AmllLyricsSettings() {
  const enabled = useSettingsStore((s) => s.lyricsAmllFallback)
  const setEnabled = useSettingsStore((s) => s.setLyricsAmllFallback)
  const host = useSettingsStore((s) => s.lyricsAmllHost)
  const setHost = useSettingsStore((s) => s.setLyricsAmllHost)
  const kugouEnabled = useSettingsStore((s) => s.lyricsKugouFallback)
  const setKugouEnabled = useSettingsStore((s) => s.setLyricsKugouFallback)
  const guestSources = useSettingsStore((s) => s.lyricsGuestSources)
  const setGuestSource = useSettingsStore((s) => s.setLyricsGuestSource)
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' })
  const defaultSource = useLyricsSourceStore((s) => s.defaultSource)
  const rememberedCount = useLyricsSourceStore((s) => Object.keys(s.remembered).length)
  const [confirmClear, setConfirmClear] = useState(false)
  const preferredProvider = useProviderStore((s) => defaultSource === 'netease' || defaultSource === 'qq' ? s.byId[defaultSource] : null)
  // 网易云、QQ 未登录或停用时，开启游客查询仍可作为歌词来源。
  const preferredGuest = (defaultSource === 'netease' || defaultSource === 'qq') && guestSources[defaultSource]
  const providerIssue = !preferredProvider || preferredGuest ? null
    : preferredProvider.auth !== 'authenticated' ? '优先来源尚未登录，也未开启游客查询；登录或开启后才会参与选择。'
    : !preferredProvider.enabled ? '优先来源已停用，也未开启游客查询；启用或开启后才会参与选择。' : null

  const runProbe = async () => {
    setProbe({ status: 'running' })
    try {
      const res = await api.get<{ hosts?: AmllHostLatency[] }>('/api/amll/probe')
      setProbe({ status: 'done', hosts: Array.isArray(res.hosts) ? res.hosts : [] })
    } catch {
      setProbe({ status: 'error' })
    }
  }

  const hosts = probe.status === 'done' ? probe.hosts : []
  const fastest = fastestAmllHost(hosts)
  const latencyOf = (id: string) => probe.status === 'done' ? hosts.find((h) => h.id === id)?.ms ?? null : undefined

  return (
    <section className={styles.group}>
      <h3 className={styles.title}>
        歌词来源
        <InfoButton
          label="歌词来源"
          text="本首记住的选择优先于默认偏好，来源不可用时会临时回退。AMLL 会向所选线路（GitHub 或社区镜像）发送歌曲平台 ID；酷狗会接收歌名、歌手与时长，只接受同曲同版本的结果。来源开关始终优先于偏好。本地歌曲优先使用同目录同名 .lrc 或文件内嵌的同步歌词；都没有时，只有标题、艺人和时长标签齐全才在线匹配同一录音，不上传文件或路径。"
        />
      </h3>
      <div className={styles.row}>
        <label className={styles.label} htmlFor="lyrics-default-source">默认选择</label>
        <select id="lyrics-default-source" className={`${styles.select} no-drag`} value={defaultSource} onChange={(event) => useLyricsSourceStore.getState().setDefaultSource(event.target.value as LyricSourcePreference)}>
          {SOURCE_PREFERENCES.map((source) => <option key={source} value={source}>{source === 'auto' ? '自动选择' : `优先${LYRIC_SOURCE_LABELS[source]}`}</option>)}
        </select>
      </div>
      <p className={styles.preferenceHint}>从下一首未单独记住来源的歌曲开始生效；来源不可用时自动回退。</p>
      {((defaultSource === 'amll' && !enabled) || (defaultSource === 'kugou' && !kugouEnabled)) && <p className={styles.preferenceHint} role="status">优先来源已停用；启用后才会参与选择。</p>}
      {providerIssue && <div className={styles.preferenceHint} role="status">{providerIssue} <button type="button" className={`${styles.probe} no-drag`} onClick={() => {
        const navigation = useNavigationStore.getState()
        navigation.requestSettingsMusic()
        navigation.navigateTo('settings')
      }}>音源设置…</button></div>}
      <div className={styles.row}>
        <span className={styles.label}>已记住 {rememberedCount} 首歌曲</span>
        <button type="button" className={`${styles.probe} no-drag`} disabled={rememberedCount === 0} onClick={() => setConfirmClear(true)}>清除全部记忆…</button>
      </div>
      {confirmClear && rememberedCount > 0 && <div className={styles.clearConfirm}>
        <p>清除这 {rememberedCount} 首歌曲的来源选择？当前歌词继续播放，之后按默认规则选择。不删除歌词文件，不更改默认偏好。</p>
        <div><button type="button" className={styles.probe} onClick={() => setConfirmClear(false)}>保留</button><button type="button" className={styles.probe} onClick={() => { useLyricsSourceStore.getState().clearRemembered(); setConfirmClear(false) }}>清除记忆</button></div>
      </div>}
      <div className={styles.row}>
        <span className={styles.label}>游客查询网易云音乐歌词</span>
        <Switch checked={guestSources.netease} onChange={(value) => setGuestSource('netease', value)} aria-label="游客查询网易云音乐歌词" />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>游客查询 QQ 音乐歌词</span>
        <Switch checked={guestSources.qq} onChange={(value) => setGuestSource('qq', value)} aria-label="游客查询 QQ 音乐歌词" />
      </div>
      <p className={styles.preferenceHint}>未登录或已停用的平台以游客身份查询歌词，不使用账号，只发送歌名与歌手；不影响播放音源。</p>
      <div className={styles.row}>
        <span className={styles.label}>使用 AMLL 逐字歌词库补全</span>
        <Switch checked={enabled} onChange={setEnabled} aria-label="使用 AMLL 逐字歌词库补全" />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>使用酷狗歌词库补全</span>
        <Switch checked={kugouEnabled} onChange={setKugouEnabled} aria-label="使用酷狗歌词库补全" />
      </div>
      <details className={styles.connection}>
      <summary>AMLL 连接设置</summary>
      <fieldset className={styles.routes} disabled={!enabled}>
        <legend className={styles.label}>优先线路</legend>
        <div className={styles.options} role="radiogroup" aria-label="AMLL 优先线路">
          {AMLL_HOST_PREFERENCES.map((id) => {
            const ms = id === 'auto' ? undefined : latencyOf(id)
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={host === id}
                className={`${styles.option} no-drag${host === id ? ` ${styles.optionActive}` : ''}`}
                onClick={() => setHost(id)}
              >
                <span>{AMLL_HOST_LABELS[id]}</span>
                {ms !== undefined && (
                  <span className={`${styles.latency}${ms === null ? ` ${styles.latencyDown}` : ''}${id === fastest ? ` ${styles.latencyBest}` : ''}`}>
                    {id === fastest ? `最快 · ${formatAmllLatency(ms)}` : formatAmllLatency(ms)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div className={styles.probeRow}>
          <button type="button" className={`${styles.probe} no-drag`} onClick={() => void runProbe()} disabled={probe.status === 'running'}>
            {probe.status === 'running' ? '测速中…' : '测速'}
          </button>
          <span className={styles.hint} role="status" aria-live="polite">
            {probe.status === 'error' ? '测速失败，请稍后重试'
              : probe.status === 'done' && !fastest ? '所有线路都不可用，当前网络无法补全逐字歌词，歌词仍按行显示'
              : '自动：按 GitHub → 社区镜像依次尝试，并记住可用线路；指定线路连不上时也会回落到其他线路'}
          </span>
        </div>
      </fieldset>
      </details>
    </section>
  )
}
