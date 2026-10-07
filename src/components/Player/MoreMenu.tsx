import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { usePlayerStore } from '../../stores/player'
import { useSleepTimerStore } from '../../stores/sleep-timer'
import { useGameModeStore } from '../../stores/game-mode'
import { useProviderStore } from '../../stores/providers'
import { isProviderId } from '../../providers/types'
import { SOURCE_BRAND } from '../../lib/source-brand'
import { fetchTrackQualities, type TrackQualityOption } from '../../lib/track-qualities'
import { tapScale, springSnappy, springGentle } from '../../lib/motion-presets'
import type { AudioQuality } from '../../types/domain'
import { SourceBadge } from '../ui/SourceBadge'
import { SourceName } from '../ui/SourceName'
import { offlineTrackKey } from '../../lib/offline-cache'
import { useOfflineCacheStore } from '../../stores/offline-cache'
import { useToastStore } from '../../stores/toast'
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

function GameModeSection() {
  const enabled = useGameModeStore((s) => s.enabled)
  return (
    <section className={styles.section}>
      <button type="button" className={`${styles.optionRow} ${styles.gameModeRow}`} role="switch"
        aria-label="游戏模式" aria-checked={enabled} data-on={enabled}
        onClick={() => void useGameModeStore.getState().configure({ enabled: !enabled })}>
        <svg className={styles.gameModeIcon} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 7h10c2 0 3 2 3.5 5l.5 4c.3 2-2 3-3.3 1.5L15 15H9l-2.7 2.5C5 19 2.7 18 3 16l.5-4C4 9 5 7 7 7Z" />
          <path d="M7 10v4m-2-2h4m7-1h.01m2 2h.01" />
        </svg>
        <span className={styles.gameModeCopy}>
          <span className={styles.sectionTitle}>游戏模式</span>
          <span className={styles.tip}>后台播放，可从托盘返回</span>
        </span>
        <span className={styles.optionState} aria-hidden="true" />
      </button>
    </section>
  )
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
          <div className={styles.sourceChoices}>
            {participants.map((source) => (
              <button
                key={source}
                type="button"
                className={styles.chip}
                data-on={actualSource === source}
                aria-pressed={actualSource === source}
                aria-label={`本次优先使用${SOURCE_BRAND[source].label}`}
                onClick={() => preferSourceOnce(source)}
                title={`当前曲目优先使用${SOURCE_BRAND[source].label}，失败后仍按设置降级`}
              >
                <SourceBadge source={source} compact reveal />
                <SourceName source={source} />
              </button>
            ))}
          </div>
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
  // null = 检测中;[] = 无可选档(本地音乐/探测失败)
  const [options, setOptions] = useState<TrackQualityOption[] | null>(null)
  const fetchSession = useRef(0)

  const trackKey = qualityTrack ? `${qualityTrack.source}:${String(qualityTrack.mid ?? qualityTrack.id ?? '')}` : ''

  // 打开或换曲时探测;晚到的过期响应丢弃
  useEffect(() => {
    if (!open) return
    const session = ++fetchSession.current
    setOptions(null)
    const player = usePlayerStore.getState()
    const track = player.resolvedTrack ?? player.currentTrack
    if (!track || !currentSourceParticipating) {
      setOptions([])
      return
    }
    fetchTrackQualities(track)
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
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>倍速</span>
        <span className={styles.sectionStatus}>{rate}x</span>
      </div>
      <div className={styles.rateChips}>
        {RATE_OPTIONS.map((r) => (
          <button key={r} type="button" className={styles.chip} data-on={rate === r} aria-pressed={rate === r} onClick={() => setRate(r)}>
            {r}x
          </button>
        ))}
      </div>
    </section>
  )
}

/** 定时关闭分区:预设时长倒计时到点停播,可选播完当前曲再停。 */
function SleepSection() {
  const phase = useSleepTimerStore((s) => s.phase)
  const remainingSec = useSleepTimerStore((s) => s.remainingSec)
  const finishTrack = useSleepTimerStore((s) => s.finishTrack)
  const active = phase !== 'idle'

  const statusText =
    phase === 'counting'
      ? `${formatCountdown(remainingSec)} 后停止`
      : phase === 'finishing-track'
        ? '播完当前曲后停止'
        : '未开启'

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>定时关闭</span>
        <span className={styles.sectionStatus}>{statusText}</span>
      </div>
      <div className={styles.sleepChips}>
        {SLEEP_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            className={styles.chip}
            onClick={() => useSleepTimerStore.getState().start(m)}
          >
            {m} 分
          </button>
        ))}
        {active && (
          <button type="button" className={styles.chip} onClick={() => useSleepTimerStore.getState().cancel()}>
            取消
          </button>
        )}
      </div>
      <button
        type="button"
        className={styles.optionRow}
        role="switch"
        aria-checked={finishTrack}
        data-on={finishTrack}
        onClick={() => useSleepTimerStore.getState().setFinishTrack(!finishTrack)}
      >
        <span>到点后播完当前曲</span>
        <span className={styles.optionState} aria-hidden="true" />
      </button>
    </section>
  )
}

/** 「更多」菜单:整合游戏模式与播放设置，给播放栏右侧腾出空间。 */
export function MoreMenu() {
  const [open, setOpen] = useState(false)
  const rate = usePlayerStore((s) => s.rate)
  const apple = usePlayerStore((s) => s.currentTrack?.source === 'apple')
  const sleepPhase = useSleepTimerStore((s) => s.phase)
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  const hasActive = rate !== 1 || sleepPhase !== 'idle'

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
        title="更多:游戏模式 / 来源 / 离线 / 音质 / 倍速 / 定时关闭"
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
              <GameModeSection />
              <PlaybackSourceSection />
              <OfflineSection open={open} />
              <QualitySection open={open} />
              {!apple && <RateSection />}
              <SleepSection />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
