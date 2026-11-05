import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { useSleepTimerStore } from '../../stores/sleep-timer'
import { useProviderStore } from '../../stores/providers'
import { isFallbackOnlyProvider, isProviderId } from '../../providers/types'
import { SOURCE_BRAND } from '../../lib/source-brand'
import { loadTrackQualities, peekTrackQualities, type TrackQualityOption } from '../../lib/track-qualities'
import { tapScale, springSnappy, springGentle } from '../../lib/motion-presets'
import type { AudioQuality } from '../../types/domain'
import { SourceBadge } from '../ui/SourceBadge'
import { SourceName } from '../ui/SourceName'
import { SwitchIndicator } from '../ui/Switch'
import { offlineTrackKey } from '../../lib/offline-cache'
import { useOfflineCacheStore } from '../../stores/offline-cache'
import { useToastStore } from '../../stores/toast'
import { useLyricsSourceDialogStore } from '../../stores/lyrics-source-dialog'
import { useLyricsSourceLabel } from '../../hooks/useLyricsSourceLabel'
import { useMotion } from '../../hooks/useMotion'
import { useKaraokeModelsStore } from '../../stores/karaoke-models'
import { useSettingsStore } from '../../stores/settings'
import { supportsSongComments } from '../../lib/song-comments'
import { openAccompanimentsLibrary, useNavigationStore } from '../../stores/navigation'
import type { KaraokeModelId } from '../../types/karaoke'
import { useTaskCenterStore } from '../../stores/task-center'
import { useKaraokeStore } from '../../stores/karaoke'
import { karaokeTrackKey } from '../../lib/karaoke/queue'
import { accompanimentId, accompanimentOriginal } from '../../lib/karaoke-library'
import styles from './MoreMenu.module.css'

const QUALITY_LABELS: Record<AudioQuality, string> = {
  standard: '标准',
  higher: '较高',
  exhigh: '极高',
  lossless: '无损',
  hires: '臻音',
  jyeffect: '鲸云音效',
  sky: '沉浸环绕声',
  jymaster: '超清母带',
  aac: 'AAC',
  max: '最高'
}

const PANEL_GAP = 14
const PANEL_EDGE = 12
/** 为滚动条向右伸展时，面板右缘离窗口边至少留这么多。 */
const PANEL_SCROLL_EDGE = 4
const RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2]
const SLEEP_PRESETS = [15, 30, 60, 90]

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

interface SegmentItem<T extends string> { value: T; label: ReactNode; title?: string; ariaLabel?: string; disabled?: boolean }

/** 浅槽分段：参数类互斥选项，选中项只抬起一层浅底，与伴奏浮层的模型选择同款；columns 给出时按网格换行。 */
function Segmented<T extends string>({ items, value, onChange, ariaLabel, columns }: {
  items: SegmentItem<T>[]
  value: T | null
  onChange(value: T): void
  ariaLabel: string
  columns?: number
}) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={ariaLabel} data-grid={columns ? true : undefined} style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="radio"
          className={styles.segment}
          aria-checked={item.value === value}
          aria-label={item.ariaLabel}
          title={item.title}
          disabled={item.disabled}
          onClick={() => { if (item.value !== value) onChange(item.value) }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/** 内容归属与实际出声平台分开呈现，并提供仅对当前曲目生效的软优先入口。 */
function PlaybackSourceSection() {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const actualSource = usePlayerStore((s) => s.actualSource)
  const loading = usePlayerStore((s) => s.status === 'loading')
  const transport = usePlayerStore((s) => s.playbackTransport)
  const preferSourceOnce = usePlayerStore((s) => s.preferSourceOnce)
  const byId = useProviderStore((s) => s.byId)
  const playbackOrder = useProviderStore((s) => s.playbackOrder)
  const participants = playbackOrder.filter((source) => {
    const state = byId[source]
    return state.enabled && state.auth === 'authenticated' && (currentTrack?.source === 'apple' ? source === 'apple' : source !== 'apple')
  })
  const originVisible = !isProviderId(currentTrack?.source)
    || participants.includes(currentTrack.source)
  if (!currentTrack) return null
  // 内容来源与实际出声一致时只在标题右侧写一次；跨平台兜底或尚未确定时才分两行说明
  const same = originVisible && actualSource === currentTrack.source
  const status = loading ? '正在加载…' : transport === 'offline' ? '离线播放' : null

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>播放来源</span>
        {same ? (
          <span className={styles.headValue}>
            <SourceBadge source={currentTrack.source} compact reveal />
            <SourceName source={currentTrack.source} />
            {status && <span className={styles.sectionStatus}>· {status}</span>}
          </span>
        ) : status && <span className={styles.sectionStatus}>{status}</span>}
      </div>
      {!same && <div className={styles.sourceFacts}>
        <span className={styles.factName}>内容来自</span>
        <span className={styles.sourceFactValue}>
          {originVisible ? (
            <>
              <SourceBadge source={currentTrack.source} compact reveal />
              <SourceName source={currentTrack.source} />
            </>
          ) : '当前不可用'}
        </span>
        <span className={styles.factName}>实际播放</span>
        <span className={styles.sourceFactValue}>
          {actualSource ? (
            <>
              <SourceBadge source={actualSource} compact reveal />
              <SourceName source={actualSource} />
            </>
          ) : '尚未确定'}
        </span>
      </div>}
      {/* 只有一个可用平台时没有可选项，不摆单选 */}
      {isProviderId(currentTrack.source) && currentTrack.source !== 'apple' && participants.length > 1 && (
        <div className={styles.sourcePreference}>
          <span className={styles.fieldName}>本次优先</span>
          <Segmented
            ariaLabel="本次优先使用的平台"
            value={participants.find((source) => source === actualSource) ?? null}
            onChange={preferSourceOnce}
            items={participants.map((source) => ({
              value: source,
              label: <><SourceBadge source={source} compact reveal /><SourceName source={source} /></>,
              ariaLabel: `本次优先使用${SOURCE_BRAND[source].label}`,
              title: `当前曲目优先使用${SOURCE_BRAND[source].label}，失败后仍按设置降级`,
            }))}
          />
        </div>
      )}
    </section>
  )
}

function OfflineSection({ open }: { open: boolean }) {
  const track = usePlayerStore((state) => state.currentTrack)
  const cacheStatus = useOfflineCacheStore((state) => track ? state.byKey[offlineTrackKey(track)] : undefined)
  useEffect(() => {
    if (open && track && track.source !== 'local') void useOfflineCacheStore.getState().ensure(track)
  }, [open, track, cacheStatus])
  if (!track || track.source === 'local' || track.source === 'apple') return null
  // 只说「已下载」与否；自动缓存由播放器自己管理，不在这里出现。
  const downloaded = cacheStatus?.state === 'downloaded'
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>下载</span>
        {/* 下载与删除都是标题行图标按钮，同一位置切换，不另起一行 */}
        <span className={styles.headActions}>
          {downloaded && <span className={styles.sectionStatus} title="歌曲文件在下载目录中，可在我的库「已下载」找到">已下载</span>}
          {downloaded ? (
            <button
              type="button"
              className={styles.iconAction}
              data-danger
              title="删除下载，歌曲文件移到废纸篓"
              aria-label="删除下载"
              onClick={() => {
                if (window.confirm(`删除「${track.name}」的下载？歌曲文件会移到废纸篓。`)) void useOfflineCacheStore.getState().removeDownload(track)
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
              </svg>
            </button>
          ) : (
            <button type="button" className={styles.iconAction} onClick={() => void useOfflineCacheStore.getState().save(track)} title="下载歌曲文件到下载目录" aria-label="下载歌曲">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
              </svg>
            </button>
          )}
        </span>
      </div>
    </section>
  )
}

/** 音质分区:面板打开时探测当前曲目真实可得的档位,选中即切偏好并热重载。 */
function QualitySection({ open }: { open: boolean }) {
  const quality = usePlayerStore((s) => s.quality)
  const setQuality = usePlayerStore((s) => s.setQuality)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const resolvedTrack = usePlayerStore((s) => s.resolvedTrack)
  const currentQuality = usePlayerStore((s) => s.currentQuality)
  const qualityTrack = resolvedTrack ?? currentTrack
  const currentSourceParticipating = useProviderStore((state) => {
    if (!qualityTrack || !isProviderId(qualityTrack.source)) return true
    const source = state.byId[qualityTrack.source]
    return source.enabled && (source.auth === 'authenticated' || isFallbackOnlyProvider(qualityTrack.source))
  })
  // null = 检测中;[] = 无可选档(本地音乐/探测失败)。换曲时已预取过的直接用缓存
  const [options, setOptions] = useState<TrackQualityOption[] | null>(() => qualityTrack ? peekTrackQualities(qualityTrack) ?? null : null)
  const fetchSession = useRef(0)

  const trackKey = qualityTrack ? `${qualityTrack.source}:${String(qualityTrack.mid ?? qualityTrack.id ?? '')}` : ''

  // 打开或换曲时探测;晚到的过期响应丢弃
  useEffect(() => {
    if (!open) return
    const session = ++fetchSession.current
    const player = usePlayerStore.getState()
    const track = player.resolvedTrack ?? player.currentTrack
    if (!track || !currentSourceParticipating) {
      setOptions([])
      return
    }
    setOptions(peekTrackQualities(track) ?? null)
    loadTrackQualities(track)
      .then((list) => {
        if (session === fetchSession.current) setOptions(list)
      })
      .catch(() => {
        if (session === fetchSession.current) setOptions([])
      })
  }, [currentSourceParticipating, open, trackKey])

  if (qualityTrack?.source === 'apple') return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>音质</span>
      </div>
      <span className={styles.note}>当前音源暂无可选音质</span>
    </section>
  )

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>音质</span>
        {/* 选中档已在分段里高亮；只有实际拿到的档位不同（如「最高」落到具体档、或降级）才写出来 */}
        {currentQuality && currentQuality !== quality && <span className={styles.sectionStatus}>
          实际 · {QUALITY_LABELS[currentQuality as AudioQuality] ?? currentQuality}
        </span>}
      </div>
      {options && options.length > 0 ? (
        <Segmented
          ariaLabel="音质"
          columns={3}
          value={quality}
          onChange={setQuality}
          items={[
            { value: 'max' as AudioQuality, label: '最高', title: '自动取本曲最高保真档：超清母带、高清臻音或无损，不含环绕声和鲸云音效' },
            ...options.map((opt) => ({ value: opt.level as AudioQuality, label: opt.label, title: opt.br ? `${Math.round(opt.br / 1000)} kbps` : opt.label })),
          ]}
        />
      ) : (
        <div className={styles.segmented} data-grid style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }} role="radiogroup" aria-label="音质">
          <button type="button" role="radio" className={styles.segment} aria-checked={quality === 'max'} onClick={() => setQuality('max')}
            title="自动取本曲最高保真档：超清母带、高清臻音或无损，不含环绕声和鲸云音效">最高</button>
          <span className={styles.segmentNote}>{options == null ? '检测中…' : '本曲无可选档位'}</span>
        </div>
      )}
    </section>
  )
}

/** 倍速分区:整档切换,保留音高。 */
function RateSection() {
  const rate = usePlayerStore((s) => s.rate)
  const setRate = usePlayerStore((s) => s.setRate)
  return (
    <div className={styles.subSection}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>倍速</span>
      </div>
      <Segmented
        ariaLabel="倍速"
        value={String(rate)}
        onChange={(v) => setRate(Number(v))}
        items={RATE_OPTIONS.map((r) => ({ value: String(r), label: `${r}x` }))}
      />
    </div>
  )
}

const KARAOKE_MODEL_SHORT: Record<KaraokeModelId, string> = { hq3: 'HQ3', 'hq3-fp16': 'HQ3 FP16', kara2: 'Karaoke 2' }

function KaraokeSection({ apple, onManage, onLibrary, onQueue }: { apple: boolean; onManage(): void; onLibrary(): void; onQueue(id: string): void }) {
  const track = usePlayerStore(s => s.currentTrack)
  const accompaniment = usePlayerStore(s => s.accompaniment)
  const { items, jobs, load, enqueue } = useKaraokeStore()
  const { models, f16, load: loadModels } = useKaraokeModelsStore()
  const selected = useSettingsStore(s => s.karaokeModel)
  const setKaraokeModel = useSettingsStore(s => s.setKaraokeModel)
  const [adding, setAdding] = useState(false)
  useEffect(() => { void loadModels(); void load().catch(() => {}) }, [loadModels, load])
  const playingStem = !!accompaniment || !!(track && accompanimentId(track))
  const original = track ? accompanimentOriginal(track) ?? track : null
  const key = original ? karaokeTrackKey(original) : ''
  const saved = items.find(item => item.available && karaokeTrackKey(item.track) === key && item.model === selected)
  const job = jobs.find(item => karaokeTrackKey(item.track) === key && item.model === selected)
  const current = models.find(model => model.id === selected)
  const options = models.filter(model => model.state === 'ready' || model.id === selected)
  const unsupported = current?.requiresF16 && f16 === false
  async function generate() {
    if (!original) return
    setAdding(true)
    try { await enqueue(original, selected) }
    catch (error) { useToastStore.getState().show(error instanceof Error ? error.message : '添加任务失败') }
    finally { setAdding(false) }
  }
  return <section className={styles.section}>
    <div className={styles.sectionHead}>
      <span className={styles.sectionTitle}>歌曲伴奏</span>
      <span className={styles.headActions}>
        <button type="button" className={styles.iconAction} onClick={onLibrary} title="伴奏库" aria-label="前往伴奏库">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4v16M8 4v16M12 6l5-2 4 14-5 2z" /></svg>
        </button>
        {!apple && <button type="button" className={styles.iconAction} onClick={onManage} title={`生成模型与保存位置${current ? `（${current.name}）` : ''}`} aria-label="生成模型与保存位置">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>}
      </span>
    </div>
    {playingStem ? <button type="button" className={styles.generateButton} disabled={!original} onClick={() => void usePlayerStore.getState().toggleAccompaniment()}>切回原曲</button>
      : <>
        {options.length > 1 && <Segmented ariaLabel="伴奏生成模型" value={selected} onChange={setKaraokeModel}
          items={options.map(model => ({ value: model.id, label: KARAOKE_MODEL_SHORT[model.id], disabled: model.requiresF16 && f16 === false }))} />}
        <button type="button" className={styles.generateButton} data-primary={!job} disabled={apple || !track || adding || (!job && !!unsupported)}
          onClick={() => job ? onQueue(job.id) : saved ? void usePlayerStore.getState().toggleAccompaniment() : void generate()}>
          {adding ? '正在加入…' : job ? job.phase === 'failed' ? '生成失败，查看队列' : '查看生成任务' : saved ? '播放伴奏' : '为这首歌生成伴奏'}
        </button>
        <span className={`${styles.note} ${styles.status}`} aria-live="polite">{apple ? 'Apple Music 受版权保护，无法生成伴奏'
          : unsupported ? '当前显卡不支持此模型，请更换模型'
          : job ? '进度、暂停与重试可在任务队列中管理。'
          : saved ? '已保存在伴奏库，可直接播放'
          : `生成时会临时占用较多内存${current && current.state !== 'ready' ? `；首次需下载约 ${Math.round(current.bytes / 1024 / 1024)} MB 模型` : ''}`}</span>
      </>}
  </section>
}

/** 定时关闭分区:预设时长倒计时到点停播,可选播完当前曲再停。 */
function SleepSection() {
  const phase = useSleepTimerStore((s) => s.phase)
  const remainingSec = useSleepTimerStore((s) => s.remainingSec)
  const finishTrack = useSleepTimerStore((s) => s.finishTrack)
  const minutes = useSleepTimerStore((s) => s.minutes)

  const statusText =
    phase === 'counting'
      ? `${formatCountdown(remainingSec)} 后停止`
      : phase === 'finishing-track'
        ? '播完当前曲后停止'
        : '未开启'

  return (
    <div className={styles.subSection}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>定时关闭</span>
        <span className={styles.sectionStatus}>{statusText}</span>
      </div>
      <Segmented
        ariaLabel="定时关闭时长"
        value={phase === 'idle' ? 'off' : String(minutes)}
        onChange={(v) => {
          if (v === 'off') useSleepTimerStore.getState().cancel()
          else useSleepTimerStore.getState().start(Number(v))
        }}
        items={[{ value: 'off', label: '关' }, ...SLEEP_PRESETS.map((m) => ({ value: String(m), label: `${m} 分` }))]}
      />
      <button
        type="button"
        className={`${styles.optionRow} ${styles.subRow}`}
        role="switch"
        aria-checked={finishTrack}
        data-on={finishTrack}
        onClick={() => useSleepTimerStore.getState().setFinishTrack(!finishTrack)}
      >
        <span>到点后播完当前曲</span>
        <SwitchIndicator checked={finishTrack} />
      </button>
    </div>
  )
}

/** 换曲后延迟预取实际播放源的音质档位，打开「更多」时直接显示；快速切歌时只取最后停下的那首。 */
const QUALITY_PREFETCH_DELAY_MS = 1200

function useQualityPrefetch() {
  const track = usePlayerStore((s) => s.resolvedTrack ?? s.currentTrack)
  const participating = useProviderStore((state) => {
    if (!track || !isProviderId(track.source)) return false
    const source = state.byId[track.source]
    return source.enabled && source.auth === 'authenticated'
  })
  useEffect(() => {
    if (!track || !participating || (track.source !== 'netease' && track.source !== 'qq') || peekTrackQualities(track)) return
    const timer = window.setTimeout(() => { void loadTrackQualities(track).catch(() => {}) }, QUALITY_PREFETCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [track, participating])
}

/** 低频的倍速与定时关闭：默认收起放在最底部，收起时标题旁概括当前生效的设置。 */
function ExtrasSection({ expanded, onToggle, showRate }: { expanded: boolean; onToggle(): void; showRate: boolean }) {
  const rate = usePlayerStore((s) => s.rate)
  const phase = useSleepTimerStore((s) => s.phase)
  const remainingSec = useSleepTimerStore((s) => s.remainingSec)
  const summary = [
    showRate && rate !== 1 ? `${rate}x` : null,
    phase === 'counting' ? `${formatCountdown(remainingSec)} 后停止` : phase === 'finishing-track' ? '播完当前曲后停止' : null,
  ].filter(Boolean).join(' · ')
  const reducedMotion = !useMotion('pageTransitionMotion')
  // 展开时面板可能已到最大高度：高度每长一帧就同步把滚动区推到底，新内容边长边露出，不等动画结束再补滑
  const bodyRef = useRef<HTMLDivElement>(null)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  // 收起时浏览器会在第一帧把滚动位置直接夹回 0，列表跳一下再停顿；改为按已收起的高度逐帧回退滚动，连续地收回去
  const collapseFrom = useRef<{ scrollTop: number; height: number } | null>(null)
  const followGrowth = () => {
    const body = bodyRef.current
    const scroller = body?.closest<HTMLElement>('[data-more-scroll]')
    if (!body || !scroller) return
    if (expandedRef.current) {
      scroller.scrollTop = scroller.scrollHeight
      return
    }
    const from = collapseFrom.current
    if (from) scroller.scrollTop = Math.max(0, from.scrollTop - (from.height - body.offsetHeight))
  }
  const toggle = () => {
    const body = bodyRef.current
    const scroller = body?.closest<HTMLElement>('[data-more-scroll]')
    collapseFrom.current = expanded && body && scroller ? { scrollTop: scroller.scrollTop, height: body.offsetHeight } : null
    onToggle()
  }
  return (
    <section className={`${styles.section} ${styles.rowSection}`}>
      <button type="button" className={`${styles.optionRow} ${styles.linkRow}`} aria-expanded={expanded} onClick={toggle}>
        <span className={styles.rowTitle}>{showRate ? '倍速与定时关闭' : '定时关闭'}</span>
        <span className={styles.extrasSummary}>
          {!expanded && summary && <span className={styles.sectionStatus}>{summary}</span>}
          <svg className={styles.chevron} data-open={expanded} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className={styles.extrasBody}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reducedMotion ? { duration: 0 } : springGentle}
            onUpdate={followGrowth}
            onAnimationComplete={followGrowth}
            ref={bodyRef}
          >
            {showRate && <RateSection />}
            <SleepSection />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/** 「更多」菜单:整合播放设置，给播放栏右侧腾出空间。游戏模式入口在托盘菜单与全局快捷键。 */
export function MoreMenu() {
  const [open, setOpen] = useState(false)
  // 低频项默认收起；本次运行内记住展开状态
  const [extrasOpen, setExtrasOpen] = useState(false)
  useQualityPrefetch()
  const rate = usePlayerStore((s) => s.rate)
  const generating = useKaraokeStore(s => s.jobs.some(job => job.phase !== 'failed'))
  const track = usePlayerStore(state => state.currentTrack)
  const apple = usePlayerStore((s) => s.currentTrack?.source === 'apple')
  const trackKey = usePlayerStore((s) => s.currentTrack ? `${s.currentTrack.source}:${String(s.currentTrack.id)}` : null)
  const lyricsSourceLabel = useLyricsSourceLabel()
  const lyricsSourceOpen = useLyricsSourceDialogStore((s) => s.open)
  const sleepPhase = useSleepTimerStore((s) => s.phase)
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const contentInnerRef = useRef<HTMLDivElement>(null)
  // 内容超出出现滚动条时，面板加宽滚动条的宽度，内容区保持原宽不被挤窄
  const [scrollExtra, setScrollExtra] = useState(0)

  const panelMotion = useMotion('popoverSproutMotion')
  const hasActive = rate !== 1 || generating || sleepPhase !== 'idle'

  useEffect(() => { if (lyricsSourceOpen) setOpen(false) }, [lyricsSourceOpen])

  function closeMenu() {
    setOpen(false)
    toggleRef.current?.focus()
  }

  // Esc 关闭 + 点击弹层/按钮之外关闭(与 QueuePanel 同款交互)
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeMenu()
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    // Esc 走捕获阶段：全局快捷键层会拦下冒泡的按键
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  // 面板挂在 body 上以取得真实的玻璃模糊（嵌在播放栏玻璃里取不到页面内容），位置跟随按钮：右缘对齐、底部留出间距。
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = toggleRef.current?.getBoundingClientRect()
      const el = panelRef.current
      if (!anchor || !el) return
      const right = Math.max(PANEL_EDGE, window.innerWidth - anchor.right)
      // 左缘不动，右缘向外让出滚动条；贴近窗口边放不下时，剩余部分才向左
      el.style.right = `${Math.max(PANEL_SCROLL_EDGE, right - scrollExtra)}px`
      el.style.bottom = `${window.innerHeight - anchor.top + PANEL_GAP}px`
      el.style.setProperty('--panel-max', `${Math.max(240, anchor.top - PANEL_GAP - PANEL_EDGE)}px`)
      el.style.setProperty('--panel-scroll-extra', `${scrollExtra}px`)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, scrollExtra])

  // 展开倍速与定时关闭等让内容变高时检测是否出现滚动条；滚动条宽度取实测值（系统浮动滚动条为 0）。
  useLayoutEffect(() => {
    if (!open) { setScrollExtra(0); return }
    const content = contentRef.current
    const inner = contentInnerRef.current
    if (!content || !inner) return
    const measure = () => {
      const overflowing = content.scrollHeight > content.clientHeight + 1
      const bar = content.offsetWidth - content.clientWidth
      setScrollExtra(current => overflowing ? (bar > 0 ? bar : current) : 0)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [open])

  return (
    <div className={styles.root} ref={rootRef}>
      <motion.button
        ref={toggleRef}
        type="button"
        className={`${styles.toggleBtn} no-drag`}
        data-active={open || hasActive}
        onClick={() => setOpen((v) => !v)}
        data-tip="更多：音质、倍速、定时关闭等"
        aria-label="更多"
        aria-expanded={open}
        whileTap={tapScale}
        transition={springSnappy}
      >
        <MoreIcon />
        {hasActive && <span className={styles.activeDot} aria-hidden="true" />}
      </motion.button>

      {typeof document !== 'undefined' && createPortal(<AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            className={`${styles.panel} no-drag`}
            role="dialog"
            aria-label="播放设置"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={panelMotion ? springGentle : { duration: 0 }}
          >
            <div className={styles.panelHead}>
              <span className={styles.panelTitle}>播放设置</span>
              <button type="button" className={styles.closeBtn} onClick={closeMenu} aria-label="关闭播放设置">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className={styles.content} ref={contentRef} data-more-scroll>
              <div className={styles.contentInner} ref={contentInnerRef}>
              <QualitySection open={open} />
              <PlaybackSourceSection />
              {trackKey && <section className={styles.section}>
                <button type="button" className={`${styles.sectionHead} ${styles.headLink}`} onClick={() => { setOpen(false); useLyricsSourceDialogStore.getState().show() }}>
                  <span className={styles.sectionTitle}>歌词来源</span>
                  <span className={styles.textAction} title={lyricsSourceLabel}>{lyricsSourceLabel}<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></span>
                </button>
              </section>}
              {track && supportsSongComments(track) && <section className={styles.section}>
                <button type="button" className={`${styles.sectionHead} ${styles.headLink}`} onClick={() => {
                  setOpen(false)
                  useNavigationStore.getState().navigateTo({ type: 'song-comments', track })
                }}>
                  <span className={styles.sectionTitle}>歌曲评论</span>
                  <span className={styles.textAction}><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></span>
                </button>
              </section>}
              <OfflineSection open={open} />
              <KaraokeSection apple={apple} onQueue={id => { setOpen(false); useTaskCenterStore.getState().show('karaoke', `k:${id}`) }} onLibrary={() => {
                setOpen(false)
                openAccompanimentsLibrary()
              }} onManage={() => {
                setOpen(false)
                const navigation = useNavigationStore.getState()
                navigation.requestSettingsKaraoke()
                navigation.navigateTo('settings')
              }} />
              <ExtrasSection expanded={extrasOpen} onToggle={() => setExtrasOpen((v) => !v)} showRate={!apple} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  )
}
