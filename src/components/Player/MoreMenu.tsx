import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { useSleepTimerStore } from '../../stores/sleep-timer'
import { useProviderStore } from '../../stores/providers'
import { isProviderId } from '../../providers/types'
import { SOURCE_BRAND } from '../../lib/source-brand'
import { loadTrackQualities, peekTrackQualities, type TrackQualityOption } from '../../lib/track-qualities'
import { tapScale, springSnappy, springGentle } from '../../lib/motion-presets'
import type { AudioQuality } from '../../types/domain'
import { SourceBadge } from '../ui/SourceBadge'
import { SourceName } from '../ui/SourceName'
import { SwitchIndicator } from '../ui/Switch'
import { JellyRadio } from '../ui/JellyRadio'
import { offlineTrackKey } from '../../lib/offline-cache'
import { useOfflineCacheStore } from '../../stores/offline-cache'
import { useToastStore } from '../../stores/toast'
import { useLyricsSourceDialogStore } from '../../stores/lyrics-source-dialog'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import styles from './MoreMenu.module.css'

const QUALITY_LABELS: Record<AudioQuality, string> = {
  standard: '标准',
  higher: '较高',
  exhigh: '极高',
  lossless: '无损',
  hires: '臻音',
  jyeffect: '鲸云',
  sky: '环绕',
  jymaster: '母带',
  aac: 'AAC',
  max: '最高'
}

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

/** 内容归属与实际出声平台分开呈现，并提供仅对当前曲目生效的软优先入口。 */
function PlaybackSourceSection() {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const actualSource = usePlayerStore((s) => s.actualSource)
  const status = usePlayerStore((s) => s.status)
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

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>播放来源</span>
        <span className={styles.sectionStatus}>{status === 'loading' ? '正在加载…' : transport === 'offline' ? '本地离线' : '本次播放'}</span>
      </div>
      <div className={styles.sourceFacts}>
        <span>内容来自</span>
        <span className={styles.sourceFactValue}>
          {originVisible ? (
            <>
              <SourceBadge source={currentTrack.source} compact reveal />
              <SourceName source={currentTrack.source} />
            </>
          ) : '当前不可用'}
        </span>
        <span>实际播放</span>
        <span className={styles.sourceFactValue}>
          {actualSource ? (
            <>
              <SourceBadge source={actualSource} compact reveal />
              <SourceName source={actualSource} />
            </>
          ) : '尚未确定'}
        </span>
      </div>
      {isProviderId(currentTrack.source) && currentTrack.source !== 'apple' && participants.length > 0 && (
        <div className={styles.sourcePreference}>
          <span className={styles.tip}>本次优先</span>
          <JellyRadio
            size="sm"
            block
            ariaLabel="本次优先使用的平台"
            value={participants.find((source) => source === actualSource) ?? null}
            onChange={preferSourceOnce}
            items={participants.map((source) => ({
              value: source,
              icon: <SourceBadge source={source} compact reveal />,
              label: <SourceName source={source} />,
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
  const label = cacheStatus?.state === 'pinned' ? '已保存' : cacheStatus?.state === 'cached' ? '已自动缓存' : '未保存'
  const run = async (action: () => Promise<void>) => {
    try {
      await action()
    } catch {
      useToastStore.getState().show('本地操作失败，请稍后重试')
    }
  }
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>离线播放</span>
        <span className={styles.sectionStatus}>{label}</span>
      </div>
      <div className={styles.chips}>
        <button type="button" className={styles.chip} onClick={() => void useOfflineCacheStore.getState().save(track)}>
          下载歌曲
        </button>
        {cacheStatus?.state === 'cached' && (
          <button type="button" className={styles.chip} onClick={() => void run(() => useOfflineCacheStore.getState().setPinned(track, true))}>
            保留此缓存
          </button>
        )}
        {cacheStatus?.state === 'pinned' && (
          <button type="button" className={styles.chip} onClick={() => void run(() => useOfflineCacheStore.getState().setPinned(track, false))}>
            改为自动缓存
          </button>
        )}
        {cacheStatus?.entryId && (
          <button
            type="button"
            className={styles.chip}
            onClick={() => {
              const shared = Number(cacheStatus.savedAliasCount) > (cacheStatus.state === 'pinned' ? 1 : 0)
              if (shared && !window.confirm('这个文件也被其他已保存歌曲共用，仍要删除吗？')) return
              void run(() => useOfflineCacheStore.getState().deleteLocal(track, shared))
            }}
          >
            删除本地文件
          </button>
        )}
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
    return source.enabled && source.auth === 'authenticated'
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
        <span className={styles.sectionStatus}>默认</span>
      </div>
      <span className={styles.tip}>当前音源暂无可选音质</span>
    </section>
  )

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>音质</span>
        <span className={styles.sectionStatus} title={currentQuality ?? QUALITY_LABELS[quality]}>
          {currentQuality ? `当前 · ${currentQuality}` : QUALITY_LABELS[quality]}
        </span>
      </div>
      <div className={styles.qualityChips}>
        <button
          type="button"
          className={styles.chip}
          data-on={quality === 'max'}
          aria-pressed={quality === 'max'}
          onClick={() => setQuality('max')}
          title="自动取本曲最高档"
        >
          最高
        </button>
        {options == null ? (
          <span className={styles.tip}>检测中…</span>
        ) : options.length === 0 ? (
          <span className={styles.tip}>本曲无可选档位</span>
        ) : (
          options.map((opt) => (
            <button
              key={opt.level}
              type="button"
              className={styles.chip}
              data-on={quality === opt.level}
              aria-pressed={quality === opt.level}
              onClick={() => setQuality(opt.level as AudioQuality)}
              title={opt.br ? `${Math.round(opt.br / 1000)} kbps` : opt.label}
            >
              {opt.label}
            </button>
          ))
        )}
      </div>
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
      <JellyRadio
        size="sm"
        block
        ariaLabel="倍速"
        value={String(rate)}
        onChange={(v) => setRate(Number(v))}
        items={RATE_OPTIONS.map((r) => ({ value: String(r), label: `${r}x` }))}
      />
    </div>
  )
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
      <JellyRadio
        size="sm"
        block
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
  const reducedMotion = useReducedMotion()
  return (
    <section className={styles.section}>
      <button type="button" className={`${styles.optionRow} ${styles.linkRow}`} aria-expanded={expanded} onClick={onToggle}>
        <span className={styles.sectionTitle}>{showRate ? '倍速与定时关闭' : '定时关闭'}</span>
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
  const apple = usePlayerStore((s) => s.currentTrack?.source === 'apple')
  const hasTrack = usePlayerStore((s) => !!s.currentTrack)
  const lyricsSourceOpen = useLyricsSourceDialogStore((s) => s.open)
  const sleepPhase = useSleepTimerStore((s) => s.phase)
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  const hasActive = rate !== 1 || sleepPhase !== 'idle'

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
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
    }
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

      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.panel}
            role="dialog"
            aria-label="播放设置"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={springGentle}
          >
            <div className={styles.panelHead}>
              <span className={styles.panelTitle}>播放设置</span>
              <button type="button" className={styles.closeBtn} onClick={closeMenu} aria-label="关闭播放设置">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className={styles.content}>
              <QualitySection open={open} />
              <PlaybackSourceSection />
              <OfflineSection open={open} />
              {hasTrack && <section className={styles.section}>
                <button type="button" className={`${styles.optionRow} ${styles.linkRow}`} onClick={() => { setOpen(false); useLyricsSourceDialogStore.getState().show() }}>
                  <span className={styles.sectionTitle}>歌词来源</span>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </button>
              </section>}
              <ExtrasSection expanded={extrasOpen} onToggle={() => setExtrasOpen((v) => !v)} showRate={!apple} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
