import { useState } from 'react'
import { api } from '../../lib/api'
import { AMLL_HOST_LABELS, fastestAmllHost, formatAmllLatency, type AmllHostLatency } from '../../lib/amll-route'
import { AMLL_HOST_PREFERENCES, useSettingsStore } from '../../stores/settings'
import { InfoButton } from '../ui/InfoButton'
import { Switch } from '../ui/Switch'
import styles from './AmllLyricsSettings.module.css'

type ProbeState = { status: 'idle' } | { status: 'running' } | { status: 'done'; hosts: AmllHostLatency[] } | { status: 'error' }

/** 逐字歌词补全：AMLL TTML DB 开关、线路选择与测速。 */
export function AmllLyricsSettings() {
  const enabled = useSettingsStore((s) => s.lyricsAmllFallback)
  const setEnabled = useSettingsStore((s) => s.setLyricsAmllFallback)
  const host = useSettingsStore((s) => s.lyricsAmllHost)
  const estimate = useSettingsStore((s) => s.lyricsEstimateWords)
  const setEstimate = useSettingsStore((s) => s.setLyricsEstimateWords)
  const setHost = useSettingsStore((s) => s.setLyricsAmllHost)
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' })

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
        逐字歌词
        <InfoButton
          label="逐字歌词"
          text="网易云或 QQ 音乐没有逐字时序时，按歌曲 ID 从社区逐字歌词库 AMLL TTML DB 补全：歌词先按行显示，补到后再换成逐字。开启后会向所选线路（GitHub 或社区镜像）发送当前歌曲的平台 ID，结果在本机缓存。"
        />
      </h3>
      <div className={styles.row}>
        <span className={styles.label}>使用 AMLL 逐字歌词库补全</span>
        <Switch checked={enabled} onChange={setEnabled} aria-label="使用 AMLL 逐字歌词库补全" />
      </div>
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
      <div className={`${styles.row} ${styles.rowTop}`}>
        <span className={styles.labelStack}>
          <span className={styles.label}>没有逐字时序时估算逐字</span>
          <span className={styles.hint}>按字数平均分配每个字的时长，让普通歌词页和 3D 也能逐字扫光；拖长音、停顿处可能对不上，歌词页会标注「估算逐字」。</span>
        </span>
        <Switch checked={estimate} onChange={setEstimate} aria-label="没有逐字时序时估算逐字" />
      </div>
    </section>
  )
}
