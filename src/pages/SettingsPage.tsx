import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion, Reorder, useDragControls, useReducedMotion } from 'motion/react'
import { api } from '../lib/api'
import { loginMusicProvider } from '../lib/provider-login'
import { logoutMusicProvider } from '../lib/provider-logout'
import { PERFORMANCE_PRESETS, useSettingsStore, type PerformancePreset } from '../stores/settings'
import { MINI_PLAYER_LYRICS_WIDTH } from '../lib/mini-player-config'
import { useToastStore } from '../stores/toast'
import { useUpdateStore } from '../stores/update'
import { springSnappy, tapScale } from '../lib/motion-presets'
import { InfoButton } from '../components/ui/InfoButton'
import { Switch } from '../components/ui/Switch'
import { SourceBadge } from '../components/ui/SourceBadge'
import { SourceName } from '../components/ui/SourceName'
import { SystemFontPicker } from '../components/ui/SystemFontPicker'
import { AppleMusicAccountInfo, AppleMusicSettings } from '../components/Settings/AppleMusicSettings'
import { AccountButton } from '../components/Settings/AccountButton'
import { AppleMusicIcon, NeteaseLogo, QQMusicLogo } from '../components/ui/brand-logos'
import { ShortcutSettings } from '../components/Settings/ShortcutSettings'
import { DesktopLyricsSettings } from '../components/Settings/DesktopLyricsSettings'
import { PlaybackLogicHelp } from '../components/Settings/PlaybackLogicHelp'
import { listProviders } from '../providers/registry'
import { useProviderStore } from '../stores/providers'
import { useAppleMusicConnection } from '../stores/apple-music-connection'
import { useNavigationStore } from '../stores/navigation'
import { useVisualStore } from '../stores/visual'
import { useGameModeStore } from '../stores/game-mode'
import { useOfflineCacheStore } from '../stores/offline-cache'
import type { ProviderId } from '../providers/types'
import type { Lyrics3dDisplayMode, Lyrics3dEffect, Lyrics3dParams, Lyrics3dStyle, PerformanceFlags } from '../types/domain'
import type { MiniPlayerAppearance, SystemFontFamily } from '../types/ipc'
import { version as appVersion } from '../../package.json'
import styles from './SettingsPage.module.css'
import pageScroll from '../styles/page-scroll.module.css'

type ThemeMode = 'auto' | 'light' | 'dark'
type AudioQuality = 'standard' | 'higher' | 'exhigh' | 'lossless' | 'max'
const SETTINGS_TABS = [
  { id: 'music', label: '音源与播放', description: '账户、来源标识、播放顺序与音质' },
  { id: 'visual', label: '界面与窗口', description: '主题、字体、迷你播放条与界面动效' },
  { id: 'lyrics', label: '歌词与动效', description: '桌面歌词、字体与 3D 歌词舞台' },
  { id: 'cache', label: '缓存与下载', description: '自动缓存、已下载歌曲与存储位置' },
  { id: 'shortcuts', label: '快捷键', description: '应用内、全局快捷键与系统媒体键' },
  { id: 'about', label: '关于应用', description: '版本信息、更新与更新日志' },
] as const
type SettingsTab = (typeof SETTINGS_TABS)[number]['id']

function SectionHeading({ section, index }: { section: (typeof SETTINGS_TABS)[number]; index: number }) {
  return (
    <div className={styles.sectionHeading}>
      <span className={styles.sectionEyebrow}>PREFERENCES / {String(index + 1).padStart(2, '0')}</span>
      <h2 id={`settings-heading-${section.id}`}>{section.label}</h2>
      <p>{section.description}</p>
    </div>
  )
}

/** 字节数格式化为可读体积(MB/GB)。 */
function formatCacheSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

const CACHE_LIMIT_PRESETS_GB = [1, 2, 5, 10]

interface AudioCacheConfigInfo {
  dir: string
  limitBytes: number
  defaultDir: string
}

interface AudioCacheStatsInfo {
  bytes: number
  files: number
  temporaryBytes: number
  temporaryFiles: number
  pinnedBytes: number
  pinnedFiles: number
  unmanagedBytes: number
  unmanagedFiles: number
}

function enabledLabel(enabled: boolean): string {
  return enabled ? '停用' : '启用'
}

function providerLabel(source: ProviderId): string {
  return listProviders().find((provider) => provider.descriptor.id === source)?.descriptor.label ?? source
}

function systemDefaultFonts(platform: string | undefined): { western: string; cjk: string } {
  return platform === 'win32'
    ? { western: 'Segoe UI', cjk: '微软雅黑（Microsoft YaHei）' }
    : { western: 'SF Pro', cjk: '苹方（PingFang SC）' }
}

function PlaybackOrderItem({
  source,
  index,
  total,
  followOrigin,
  onMove,
}: {
  source: ProviderId
  index: number
  total: number
  followOrigin: boolean
  onMove: (source: ProviderId, direction: -1 | 1) => void
}) {
  const dragControls = useDragControls()
  const label = providerLabel(source)
  const role = total === 1
    ? '唯一音源'
    : followOrigin
      ? `补位 ${index + 1}`
      : index === 0 ? '首选' : `备用 ${index}`

  return (
    <Reorder.Item
      value={source}
      className={styles.playbackOrderItem}
      dragListener={false}
      dragControls={dragControls}
      layout
    >
      <span className={styles.playbackOrderRank}>{index + 1}</span>
      <SourceBadge source={source} compact displayMode="always" />
      <span className={styles.playbackOrderName}>{label}</span>
      <span className={styles.playbackOrderRole}>{role}</span>
      {total > 1 && (
        <button
          type="button"
          className={`${styles.playbackOrderHandle} no-drag`}
          aria-label={`拖动${label}调整顺序，或按 Alt 加上下箭头移动`}
          title="拖动排序 · Alt + ↑/↓"
          onPointerDown={(event) => dragControls.start(event)}
          onKeyDown={(event) => {
            if (!event.altKey) return
            if (event.key === 'ArrowUp' && index > 0) {
              event.preventDefault()
              onMove(source, -1)
            }
            if (event.key === 'ArrowDown' && index < total - 1) {
              event.preventDefault()
              onMove(source, 1)
            }
          }}
        >
          <span aria-hidden="true" />
        </button>
      )}
    </Reorder.Item>
  )
}

function PlaybackOrderEditor({
  order,
  followOrigin,
  emptyMessage,
  onChange,
}: {
  order: ProviderId[]
  followOrigin: boolean
  emptyMessage: string
  onChange: (order: ProviderId[]) => void
}) {
  const moveSource = (source: ProviderId, direction: -1 | 1): void => {
    const from = order.indexOf(source)
    const to = from + direction
    if (from < 0 || to < 0 || to >= order.length) return
    const next = [...order]
    ;[next[from], next[to]] = [next[to], next[from]]
    onChange(next)
  }

  if (order.length === 0) {
    return <div className={styles.playbackOrderEmpty}>{emptyMessage}</div>
  }

  return (
    <Reorder.Group
      axis="y"
      values={order}
      onReorder={onChange}
      className={styles.playbackOrderList}
    >
      {order.map((source, index) => (
        <PlaybackOrderItem
          key={source}
          source={source}
          index={index}
          total={order.length}
          followOrigin={followOrigin}
          onMove={moveSource}
        />
      ))}
    </Reorder.Group>
  )
}

/** 通用滑杆行:label + range + 格式化后的当前值。 */
function SliderRow({ label, min, max, step, value, format, onChange }: {
  label: string
  min: number
  max: number
  step: number
  value: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  const inputId = useId()

  return (
    <div className={styles.row}>
      <label className={styles.rowLabel} htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="no-drag"
      />
      <span className={styles.rowValue}>{format(value)}</span>
    </div>
  )
}

function FontPairSetting({
  label,
  idPrefix,
  westernValue,
  cjkValue,
  fonts,
  loading,
  westernDefaultLabel,
  cjkDefaultLabel,
  onWesternChange,
  onCjkChange
}: {
  label: string
  idPrefix: string
  westernValue: string
  cjkValue: string
  fonts: SystemFontFamily[]
  loading: boolean
  westernDefaultLabel: string
  cjkDefaultLabel: string
  onWesternChange(value: string): void
  onCjkChange(value: string): void
}) {
  return (
    <div className={`${styles.row} ${styles.fontPairRow}`}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.fontPair}>
        <div className={styles.fontSlot}>
          <label className={styles.fontSlotLabel} htmlFor={`${idPrefix}-western`}>西文</label>
          <SystemFontPicker
            id={`${idPrefix}-western`}
            value={westernValue}
            fonts={fonts}
            loading={loading}
            defaultLabel={westernDefaultLabel}
            ariaLabel={`${label}西文字体`}
            onChange={onWesternChange}
          />
        </div>
        <div className={styles.fontSlot}>
          <label className={styles.fontSlotLabel} htmlFor={`${idPrefix}-cjk`}>中文</label>
          <SystemFontPicker
            id={`${idPrefix}-cjk`}
            value={cjkValue}
            fonts={fonts}
            loading={loading}
            defaultLabel={cjkDefaultLabel}
            ariaLabel={`${label}中文字体`}
            onChange={onCjkChange}
          />
        </div>
      </div>
    </div>
  )
}

const MINI_PLAYER_TINTS: { value: MiniPlayerAppearance['tint']; label: string }[] = [
  { value: 'cover', label: '跟随封面' },
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' }
]

const EFFECT_LABELS: Record<Lyrics3dEffect, string> = {
  'cover-cloud': '封面粒子云',
  'waveform-3d': '3D 频谱环',
  'speaker-particles': '音箱沙粒'
}

const LYRIC_STYLE_LABELS: Record<Lyrics3dStyle, string> = {
  glass: '玻璃',
  smooth: '丝滑',
  float: '漂浮',
  quick: '快切',
  shine: '流光',
  glitch: '故障',
  focus: '简洁叠层'
}

const LYRIC_DISPLAY_LABELS: Record<Lyrics3dDisplayMode, string> = {
  single: '单行',
  dual: '双行',
  triple: '三行',
  cinema: '电影五行'
}

const FPS_OPTIONS = [120, 0]

const PERFORMANCE_PRESET_LABELS: Record<PerformancePreset, string> = {
  standard: '标准',
  simple: '简单模式',
  minimal: '极简模式',
}

const PERFORMANCE_FLAG_LABELS: { key: keyof PerformanceFlags; label: string; hint: string }[] = [
  { key: 'bgFluidMotion', label: '背景跟手流体动效', hint: '关闭后氛围背景改用静态渐变,不再跟随鼠标' },
  { key: 'cardTiltEffect', label: '卡片跟光 3D 倾斜', hint: '歌单/推荐卡片跟随鼠标倾斜追光' },
  { key: 'clickSparkEffect', label: '点击火花特效', hint: '' },
  { key: 'gradientTextMotion', label: '标题流光呼吸动画', hint: '' },
  { key: 'audioGlowEffect', label: '播放栏音频辉光', hint: '播放时随低频呼吸的底部辉光,关闭可降低持续 GPU 占用' },
  { key: 'reduceTransparency', label: '减少透明度', hint: '开启后关闭背景流体并把玻璃层去模糊转不透明,消除毛玻璃随动态背景逐帧重取样的 GPU 大头' },
]

/** 当前开关组合与某预设完全一致时返回该预设 id,否则返回 null(自定义组合,不高亮任何预设)。 */
function matchPerformancePreset(flags: PerformanceFlags): PerformancePreset | null {
  for (const id of Object.keys(PERFORMANCE_PRESETS) as PerformancePreset[]) {
    const preset = PERFORMANCE_PRESETS[id]
    if ((Object.keys(preset) as (keyof typeof preset)[]).every((k) => preset[k] === flags[k])) return id
  }
  return null
}

/** 3D 歌词设置按当前场景与歌词样式展示生效的参数。 */
function Lyrics3dSettings({ view }: { view: 'scene' | 'tuning' }) {
  const reducedMotion = useReducedMotion()
  const lyrics3dEffect = useSettingsStore((s) => s.lyrics3dEffect)
  const setLyrics3dEffect = useSettingsStore((s) => s.setLyrics3dEffect)
  const lyrics3dStyle = useSettingsStore((s) => s.lyrics3dStyle)
  const setLyrics3dStyle = useSettingsStore((s) => s.setLyrics3dStyle)
  const params = useSettingsStore((s) => s.lyrics3d)
  const setParams = useSettingsStore((s) => s.setLyrics3dParams)
  const resetParams = useSettingsStore((s) => s.resetLyrics3dParams)
  const lyricsOverlayBlur = useSettingsStore((s) => s.lyricsOverlayBlur)
  const setLyricsOverlayBlur = useSettingsStore((s) => s.setLyricsOverlayBlur)

  const patch = (key: keyof Lyrics3dParams) => (v: number) => setParams({ [key]: v })
  const percent = (v: number): string => `${Math.round(v * 100)}%`

  const renderSettings = (
      <section className={`${styles.group} ${styles.lyricsPerformanceGroup}`}>
        <h3 className={styles.groupTitle}>3D 渲染</h3>
        <div className={styles.row}>
          <span className={styles.rowLabel}>帧率上限</span>
          <div className={styles.segControl}>
            {FPS_OPTIONS.map((fps) => (
              <motion.button
                key={fps}
                className={`${styles.seg} no-drag ${params.fpsCap === fps ? styles.segActive : ''}`}
                onClick={() => setParams({ fpsCap: fps })}
                whileTap={tapScale}
                transition={springSnappy}
              >
                {fps === 0 ? '不限' : fps}
              </motion.button>
            ))}
          </div>
        </div>
        <SliderRow label="渲染分辨率" min={0.75} max={2} step={0.05}
          value={params.renderScale} format={(v) => `${v.toFixed(2)}×`} onChange={patch('renderScale')} />
        <div className={styles.lyricsSubheading}>恢复设置</div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>恢复场景、歌词层次与渲染参数</span>
          <button className={`${styles.seg} no-drag`} onClick={resetParams}>
            恢复默认
          </button>
        </div>
      </section>
  )

  return (
    view === 'scene' ? <section className={`${styles.group} ${styles.lyricsEffectGroup}`}>
        <h3 className={styles.groupTitle}>场景与文字</h3>
        <div className={styles.row}>
          <span className={styles.rowLabel}>背景场景</span>
          <div className={styles.segControl}>
            {(Object.keys(EFFECT_LABELS) as Lyrics3dEffect[]).map((id) => (
              <motion.button
                key={id}
                className={`${styles.seg} no-drag ${lyrics3dEffect === id ? styles.segActive : ''}`}
                onClick={() => setLyrics3dEffect(id)}
                whileTap={tapScale}
                transition={springSnappy}
              >
                {EFFECT_LABELS[id]}
              </motion.button>
            ))}
          </div>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>文字演出</span>
          <div className={styles.segControl}>
            {(Object.keys(LYRIC_STYLE_LABELS) as Lyrics3dStyle[]).map((id) => (
              <motion.button
                key={id}
                className={`${styles.seg} no-drag ${lyrics3dStyle === id ? styles.segActive : ''}`}
                onClick={() => setLyrics3dStyle(id)}
                whileTap={tapScale}
                transition={springSnappy}
              >
                {LYRIC_STYLE_LABELS[id]}
              </motion.button>
            ))}
          </div>
        </div>
        {lyrics3dStyle !== 'focus' && <div className={styles.row}>
          <span className={styles.rowLabel}>
            同屏歌词
            <InfoButton label="同屏歌词" text="控制 3D 歌词舞台同时显示的歌词行数。" />
          </span>
          <div className={styles.segControl}>
            {(Object.keys(LYRIC_DISPLAY_LABELS) as Lyrics3dDisplayMode[]).map((id) => (
              <motion.button
                key={id}
                className={`${styles.seg} no-drag ${params.displayMode === id ? styles.segActive : ''}`}
                onClick={() => setParams({ displayMode: id })}
                whileTap={tapScale}
                transition={springSnappy}
              >
                {LYRIC_DISPLAY_LABELS[id]}
              </motion.button>
            ))}
          </div>
        </div>}
      </section> : <div className={styles.lyricsGrid}>
      <div className={styles.lyricsTuning}>
      <div className={styles.lyricsTuningColumn}>
      <section className={`${styles.group} ${styles.lyricsOverlayGroup}`}>
        <h3 className={styles.groupTitle}>
          {lyrics3dStyle === 'focus' ? '简洁叠层 · 歌词' : '3D 歌词 · 文字层次'}
          <InfoButton label="3D 歌词文字层次" text="调整歌词的亮度、间距、切换过渡和辉光。辉光强度也会影响封面粒子云；简洁叠层只显示居中的当前歌词。" />
        </h3>
        {lyrics3dStyle === 'focus' ? (
          <SliderRow label="当前歌词底部模糊" min={0} max={1} step={0.01}
            value={lyricsOverlayBlur} format={percent} onChange={setLyricsOverlayBlur} />
        ) : <>
          <SliderRow label="前后歌词亮度" min={0.25} max={1} step={0.01}
            value={params.contextOpacity} format={percent} onChange={patch('contextOpacity')} />
          <SliderRow label="歌词行间距" min={0.6} max={2.4} step={0.02}
            value={params.contextSpread} format={(v) => `${v.toFixed(2)}×`} onChange={patch('contextSpread')} />
          <SliderRow label="远处歌词渐隐" min={0} max={1} step={0.01}
            value={params.edgeFade} format={percent} onChange={patch('edgeFade')} />
          <SliderRow label="切换柔和度" min={0.15} max={1.2} step={0.01}
            value={params.motionSoftness} format={(v) => `${v.toFixed(2)}×`} onChange={patch('motionSoftness')} />
          <SliderRow label="辉光强度" min={0} max={2} step={0.05}
            value={params.glowStrength} format={percent} onChange={patch('glowStrength')} />
        </>}
      </section>
      {renderSettings}
      </div>
      <motion.div layout className={styles.lyricsTuningColumn} transition={{ duration: reducedMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.section
            key={lyrics3dEffect}
            className={`${styles.group} ${styles.lyricsParticleGroup}`}
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <h3 className={styles.groupTitle}>
              {EFFECT_LABELS[lyrics3dEffect]} · 场景细节
              <InfoButton label="场景细节" text="下面的粒子与动效参数随当前背景场景实时变化；切换场景时会保留数值。" />
            </h3>
            <SliderRow label="粒子数量" min={0.25} max={2} step={0.05}
              value={params.particleCount} format={percent} onChange={patch('particleCount')} />
            <SliderRow label={lyrics3dEffect === 'waveform-3d' ? '歌词点缀粒子大小' : '粒子大小'} min={0.2} max={2} step={0.05}
              value={params.particleSize} format={percent} onChange={patch('particleSize')} />
            <SliderRow label="场景亮度" min={0.3} max={2} step={0.05}
              value={params.particleBrightness} format={percent} onChange={patch('particleBrightness')} />
            <SliderRow label="动效强度" min={0.2} max={2} step={0.05}
              value={params.motionIntensity} format={percent} onChange={patch('motionIntensity')} />
            {lyrics3dEffect === 'cover-cloud' && lyrics3dStyle === 'focus' && <SliderRow label="辉光强度" min={0} max={2} step={0.05}
              value={params.glowStrength} format={percent} onChange={patch('glowStrength')} />}
            {lyrics3dEffect === 'cover-cloud' && <>
              <div className={styles.lyricsSubheading}>鼓点波纹 <span>仅封面粒子云</span></div>
              <SliderRow label="波纹数量" min={1} max={6} step={1}
                value={params.rippleCount} format={(v) => `${v} 道`} onChange={patch('rippleCount')} />
              <SliderRow label="触发灵敏度" min={0} max={1} step={0.01}
                value={params.rippleSensitivity} format={percent} onChange={patch('rippleSensitivity')} />
              <SliderRow label="扩散时长" min={0.2} max={1.5} step={0.05}
                value={params.rippleDuration} format={(v) => `${v.toFixed(2)}s`} onChange={patch('rippleDuration')} />
            </>}
          </motion.section>
        </AnimatePresence>
      </motion.div>
      </div>
    </div>
  )
}

export function SettingsPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  const selectedSectionRef = useRef<SettingsTab | null>(null)
  const [activeSection, setActiveSection] = useState<SettingsTab>('music')
  const settingsMusicRequest = useNavigationStore((s) => s.settingsMusicRequest)

  useEffect(() => {
    const page = pageRef.current
    if (!page) return
    const updateActiveSection = () => {
      if (selectedSectionRef.current) return
      if (page.scrollTop + page.clientHeight >= page.scrollHeight - 2) {
        setActiveSection(SETTINGS_TABS[SETTINGS_TABS.length - 1].id)
        return
      }
      const topbarHeight = parseFloat(getComputedStyle(page).getPropertyValue('--sm-topbar-height')) || 0
      const threshold = page.getBoundingClientRect().top + topbarHeight + 120
      let current: SettingsTab = 'music'
      for (const section of SETTINGS_TABS) {
        const node = document.getElementById(`settings-section-${section.id}`)
        if (node && node.getBoundingClientRect().top <= threshold) current = section.id
      }
      setActiveSection(current)
    }
    const resumeScrollTracking = () => {
      selectedSectionRef.current = null
      updateActiveSection()
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target === page) resumeScrollTracking()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) resumeScrollTracking()
    }
    page.addEventListener('scroll', updateActiveSection, { passive: true })
    page.addEventListener('wheel', resumeScrollTracking, { passive: true })
    page.addEventListener('touchstart', resumeScrollTracking, { passive: true })
    page.addEventListener('keydown', handleKeyDown)
    page.addEventListener('pointerdown', handlePointerDown)
    updateActiveSection()
    return () => {
      page.removeEventListener('scroll', updateActiveSection)
      page.removeEventListener('wheel', resumeScrollTracking)
      page.removeEventListener('touchstart', resumeScrollTracking)
      page.removeEventListener('keydown', handleKeyDown)
      page.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [])

  const scrollToSection = useCallback((id: SettingsTab): void => {
    const page = pageRef.current
    const section = document.getElementById(`settings-section-${id}`)
    if (!page || !section) return
    selectedSectionRef.current = id
    const top = section.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop - parseFloat(window.getComputedStyle(section).scrollMarginTop)
    page.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    setActiveSection(id)
  }, [])
  useEffect(() => {
    const navigation = useNavigationStore.getState()
    if (navigation.lastAction === 'pop' && navigation.future[0] === 'release-history') scrollToSection('about')
  }, [scrollToSection])
  useEffect(() => {
    if (settingsMusicRequest === 0) return
    scrollToSection('music')
    useNavigationStore.setState({ settingsMusicRequest: 0 })
  }, [settingsMusicRequest, scrollToSection])
  const themeMode = useSettingsStore((s) => s.themeMode)
  const setThemeMode = useSettingsStore((s) => s.setThemeMode)
  const fontFamily = useSettingsStore((s) => s.fontFamily)
  const setFontFamily = useSettingsStore((s) => s.setFontFamily)
  const fontFamilyCjk = useSettingsStore((s) => s.fontFamilyCjk)
  const setFontFamilyCjk = useSettingsStore((s) => s.setFontFamilyCjk)
  const lyricsFontFamily = useSettingsStore((s) => s.lyricsFontFamily)
  const setLyricsFontFamily = useSettingsStore((s) => s.setLyricsFontFamily)
  const lyricsFontFamilyCjk = useSettingsStore((s) => s.lyricsFontFamilyCjk)
  const setLyricsFontFamilyCjk = useSettingsStore((s) => s.setLyricsFontFamilyCjk)
  const lyrics3dFontFamily = useSettingsStore((s) => s.lyrics3dFontFamily)
  const setLyrics3dFontFamily = useSettingsStore((s) => s.setLyrics3dFontFamily)
  const lyrics3dFontFamilyCjk = useSettingsStore((s) => s.lyrics3dFontFamilyCjk)
  const setLyrics3dFontFamilyCjk = useSettingsStore((s) => s.setLyrics3dFontFamilyCjk)
  const fx = useVisualStore((s) => s.fx)
  const updateFx = useVisualStore((s) => s.updateFx)
  const [systemFonts, setSystemFonts] = useState<SystemFontFamily[]>([])
  const [fontsLoading, setFontsLoading] = useState(true)
  const [fontsError, setFontsError] = useState(false)
  const defaultFonts = systemDefaultFonts(window.desktop?.platform)
  const inheritedWesternFont = fontFamily || defaultFonts.western
  const inheritedCjkFont = fontFamilyCjk || defaultFonts.cjk

  async function loadSystemFonts(): Promise<void> {
    setFontsLoading(true)
    setFontsError(false)
    try {
      const result = await window.desktop.listSystemFonts()
      setSystemFonts(result.fonts)
      setFontsError(!result.ok)
    } catch {
      setSystemFonts([])
      setFontsError(true)
    } finally {
      setFontsLoading(false)
    }
  }

  useEffect(() => {
    void loadSystemFonts()
    // 字体列表只在进入设置页时读取一次，失败时可手动重试。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const audioQuality = useSettingsStore((s) => s.audioQuality)
  const setAudioQuality = useSettingsStore((s) => s.setAudioQuality)
  const providerState = useProviderStore((s) => s.byId)
  const playbackOrder = useProviderStore((s) => s.playbackOrder)
  const preferOriginSource = useProviderStore((s) => s.preferOriginSource)
  const multiSourceFallback = useProviderStore((s) => s.multiSourceFallback)
  const sourceBadgeMode = useProviderStore((s) => s.sourceBadgeMode)
  const apple = useAppleMusicConnection()
  const [loginBusy, setLoginBusy] = useState<ProviderId | null>(null)
  const changeProviderAccount = async (source: 'netease' | 'qq', connected: boolean): Promise<void> => {
    if (loginBusy !== null) return
    setLoginBusy(source)
    try {
      if (connected) await logoutMusicProvider(source)
      else await loginMusicProvider(source)
    } catch {
      useToastStore.getState().show(connected ? '退出登录失败，请重试' : '登录失败，请重试')
    } finally {
      setLoginBusy(null)
    }
  }
  const setProviderEnabled = useProviderStore((s) => s.setEnabled)
  const setPlaybackOrder = useProviderStore((s) => s.setPlaybackOrder)
  const setPreferOriginSource = useProviderStore((s) => s.setPreferOriginSource)
  const setMultiSourceFallback = useProviderStore((s) => s.setMultiSourceFallback)
  const setSourceBadgeMode = useProviderStore((s) => s.setSourceBadgeMode)
  const participatingPlaybackOrder = playbackOrder.filter((source) => (
    source !== 'apple' && providerState[source].enabled && providerState[source].auth === 'authenticated' && providerState[source].playbackAvailable !== false
  ))
  const playbackAuthPending = playbackOrder.some((source) => (
    source !== 'apple' && providerState[source].enabled && providerState[source].auth === 'unknown'
  ))
  const visiblePlaybackOrder = playbackAuthPending ? [] : participatingPlaybackOrder
  const performance = useSettingsStore((s) => s.performance)
  const setPerformance = useSettingsStore((s) => s.setPerformance)
  const applyPerformancePreset = useSettingsStore((s) => s.applyPerformancePreset)
  const activePerformancePreset = matchPerformancePreset(performance)

  const setLyrics3dEnabled = (enabled: boolean): void => {
    setPerformance({ lyrics3dEnabled: enabled })
  }

  const [audioCache, setAudioCache] = useState<AudioCacheStatsInfo | null>(null)
  const downloadDir = useOfflineCacheStore((state) => state.downloadDir)
  const [cacheConfig, setCacheConfig] = useState<AudioCacheConfigInfo | null>(null)
  const [clearingCache, setClearingCache] = useState(false)
  async function refreshCacheInfo(): Promise<void> {
    try {
      const [stats, config] = await Promise.all([
        api.get<AudioCacheStatsInfo>('/api/audio-cache/stats'),
        api.get<AudioCacheConfigInfo>('/api/audio-cache/config'),
      ])
      setAudioCache(stats)
      setCacheConfig(config)
    } catch {
      /* server 未就绪时保持占位 */
    }
  }
  useEffect(() => {
    void refreshCacheInfo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function handleClearAudioCache(scope: 'temporary' | 'pinned' | 'unmanaged'): Promise<void> {
    if (scope === 'pinned' && !window.confirm('这会删除播放器中的离线音频，需要时要重新保存。下载目录中的歌曲文件会保留。仍要删除吗？')) return
    if (scope === 'unmanaged' && !window.confirm('这些文件无法识别是否曾经下载保存，删除后无法恢复。仍要删除吗？')) return
    setClearingCache(true)
    try {
      await api.post('/api/audio-cache/clear', { scope }, undefined, { timeoutMs: 120_000 })
      useOfflineCacheStore.getState().invalidate()
      await refreshCacheInfo()
      useToastStore.getState().show(scope === 'temporary' ? '自动缓存已清理，已下载歌曲已保留' : '本地文件已删除')
    } catch {
      useToastStore.getState().show('清理失败：缓存正在播放或保存中')
    } finally {
      setClearingCache(false)
    }
  }
  async function postCacheConfig(patch: { dir?: string; limitBytes?: number; confirmPinned?: boolean }): Promise<void> {
    try {
      await api.post('/api/audio-cache/config', patch)
      useOfflineCacheStore.getState().invalidate()
    } catch {
      useToastStore.getState().show('缓存设置失败：目录无效、不可写或正在使用')
    }
    await refreshCacheInfo()
  }
  async function handlePickCacheDir(): Promise<void> {
    const picker = window.desktop?.selectDirectory
    if (!picker) return
    const r = await picker({ title: '选择音频存储文件夹', defaultPath: cacheConfig?.dir })
    if (!r.ok || !r.filePath) return
    const hasSaved = !!audioCache?.pinnedFiles
    if ((hasSaved || audioCache?.unmanagedFiles) && !window.confirm('更改缓存位置会清除当前目录中的自动缓存、播放器离线音频和未识别旧文件，独立下载目录中的歌曲文件会保留。仍要继续吗？')) return
    await postCacheConfig({ dir: r.filePath, confirmPinned: hasSaved })
  }
  const miniPlayerAppearance = useSettingsStore((s) => s.miniPlayerAppearance)
  const setMiniPlayerAppearance = useSettingsStore((s) => s.setMiniPlayerAppearance)

  const updateInfo = useUpdateStore((s) => s.info)
  const checking = useUpdateStore((s) => s.checking)
  const downloading = useUpdateStore((s) => s.downloading)
  const job = useUpdateStore((s) => s.job)
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate)
  const startDownload = useUpdateStore((s) => s.startDownload)
  const installing = useUpdateStore((s) => s.installing)
  const installUpdate = useUpdateStore((s) => s.installUpdate)

  const currentVersion = updateInfo?.currentVersion || appVersion
  const ready = job?.status === 'ready'
  const isMacUpdate = window.desktop?.platform === 'darwin'
  const updateStatusText = checking
    ? '检查中…'
    : updateInfo?.updateAvailable
      ? `发现新版本 v${updateInfo.release.version}`
      : updateInfo
        ? '已是最新版本'
        : '尚未检查'

  return (
    <div className={`${styles.page} ${pageScroll.viewport}`} ref={pageRef}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>CONTROL CENTER</span>
            <h1 className={styles.title}>设置</h1>
            <p className={styles.lede}>音源、播放、界面与歌词，都可以按你的习惯调整。</p>
          </div>
        </header>
        <div className={styles.settingsLayout}>
          <nav className={styles.tabBar} aria-label="设置导航">
            {SETTINGS_TABS.map(({ id, label, description }, index) => (
              <motion.button
                key={id}
                type="button"
                aria-current={activeSection === id ? 'location' : undefined}
                aria-label={label}
                className={`${styles.tab} no-drag ${activeSection === id ? styles.tabActive : ''}`}
                onClick={(event) => {
                  scrollToSection(id)
                  if (event.detail > 0) event.currentTarget.blur()
                }}
                whileTap={tapScale}
                transition={springSnappy}
              >
                <span className={styles.tabNumber}>{String(index + 1).padStart(2, '0')}</span>
                <span className={styles.tabCopy}>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
              </motion.button>
            ))}
          </nav>
          <div className={styles.settingsContent}>
            <section id="settings-section-music" className={styles.settingsSection} aria-labelledby="settings-heading-music">
              <SectionHeading section={SETTINGS_TABS[0]} index={0} />
              <div className={`${styles.settingsGrid} ${styles.musicGrid}`}>
                <section className={styles.group}>
                  <h3 className={styles.groupTitle}>
                    音源与账户
                    <InfoButton label="音源与账户" text="登录并启用后，平台才会参与浏览和联网播放。停用或退出登录后不再向它获取歌曲，但已有本地缓存仍可播放。来源标识只控制角标显示，不改变播放平台。" />
                  </h3>
                  <p className={styles.providerExplanation}>
                    登录后启用，才参与浏览与联网播放。
                  </p>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>来源标识</span>
                    <div className={styles.segControl}>
                      {(['always', 'dynamic', 'hidden'] as const).map((mode) => (
                        <motion.button
                          key={mode}
                          className={`${styles.seg} no-drag ${sourceBadgeMode === mode ? styles.segActive : ''}`}
                          onClick={() => setSourceBadgeMode(mode)}
                          whileTap={tapScale}
                          transition={springSnappy}
                        >
                          {{ always: '常显', dynamic: '动态', hidden: '隐藏' }[mode]}
                        </motion.button>
                      ))}
                    </div>
                    <span className={styles.rowValue}>
                      {sourceBadgeMode === 'dynamic' ? '悬停或聚焦时显示' : sourceBadgeMode === 'hidden' ? '隐藏内容中的来源角标' : '始终显示'}
                    </span>
                  </div>
                  {listProviders().map((provider) => {
                    const source = provider.descriptor.id
                    const runtime = providerState[source]
                    const connected = runtime.auth === 'authenticated'
                    const busy = loginBusy === source
                    const active = connected && runtime.enabled && runtime.playbackAvailable !== false
                    const accountLabel = source === 'apple' && apple.account?.restoring ? '恢复登录中'
                      : source === 'apple' && apple.phase === 'waiting' && !connected ? '等待授权'
                      : connected
                        ? runtime.playbackAvailable === false ? runtime.lastError || '当前不可播放'
                          : source === 'apple' ? '已连接' : runtime.profile?.nickname || '已登录'
                        : runtime.auth === 'unknown' ? '正在核实账号状态' : runtime.auth === 'expired' ? '登录已失效' : '未登录'
                    const Logo = source === 'netease' ? NeteaseLogo : source === 'qq' ? QQMusicLogo : AppleMusicIcon
                    return (
                      <div className={styles.providerRow} key={source}>
                        <span className={styles.providerMark} aria-hidden="true"><Logo /></span>
                        <div className={styles.providerAccount}>
                          <div className={styles.providerName}>
                            <strong><SourceName source={source} /></strong>
                            {source === 'apple' && <AppleMusicAccountInfo />}
                          </div>
                          <small title={`${accountLabel}${connected ? active ? ' · 已启用' : ' · 未启用' : ''}`}>
                            <span className={styles.providerStatus} data-connected={connected} data-active={active} aria-hidden="true" />
                            <span className={styles.providerAccountName}>{accountLabel}</span>
                          </small>
                        </div>
                        <div className={styles.providerActions}>
                          <Switch
                            checked={active}
                            disabled={!connected || runtime.playbackAvailable === false || busy}
                            onChange={(enabled) => setProviderEnabled(source, enabled)}
                            aria-label={`${enabledLabel(active)}${provider.descriptor.label}`}
                          />
                          {source === 'apple' ? <AppleMusicSettings /> : <AccountButton
                            label={`${busy ? connected ? '退出中' : '登录中' : connected ? '退出登录' : runtime.auth === 'expired' ? '重新登录' : '登录'}${provider.descriptor.label}`}
                            exit={connected}
                            busy={busy}
                            disabled={loginBusy !== null}
                            onClick={() => void changeProviderAccount(source, connected)}
                          />}
                        </div>
                      </div>
                    )
                  })}
                </section>
                <section className={styles.group}>
                  <div className={`${styles.groupTitle} ${styles.playbackCardHeader}`}>
                    <h3>播放偏好</h3>
                    <div className={styles.playbackHeadingActions}>
                      <span className={styles.playbackProviderCount}>
                        {playbackAuthPending ? '正在核实' : `${participatingPlaybackOrder.length} 个平台`}
                      </span>
                      <PlaybackLogicHelp
                        providerLabels={visiblePlaybackOrder.map(providerLabel)}
                        preferOriginSource={preferOriginSource}
                        multiSourceFallback={multiSourceFallback}
                        authPending={playbackAuthPending}
                      />
                    </div>
                  </div>
                  <div className={styles.playbackStrategyRow}>
                    <div className={styles.playbackStrategy}>
                      {visiblePlaybackOrder.length > 1 ? (
                        <div className={styles.playbackModeBlock}>
                          <span className={styles.playbackFieldLabel}>
                            没有缓存时的起播方式
                            <InfoButton
                              label="起播方式"
                              text={preferOriginSource
                                ? '需要联网且未指定本次优先时，先尝试已启用的歌曲所属平台，再按下方顺序补位。'
                                : '需要联网且未指定本次优先时，从下方第一个平台开始。'}
                            />
                          </span>
                          <div className={styles.playbackModeControl} role="radiogroup" aria-label="起播方式">
                            <motion.button
                              type="button"
                              role="radio"
                              aria-checked={preferOriginSource}
                              tabIndex={preferOriginSource ? 0 : -1}
                              className={`${styles.playbackModeButton} no-drag ${preferOriginSource ? styles.playbackModeButtonActive : ''}`}
                              onClick={() => setPreferOriginSource(true)}
                              onKeyDown={(event) => {
                                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
                                event.preventDefault()
                                const keepCurrent = event.key === 'Home'
                                setPreferOriginSource(keepCurrent)
                                if (!keepCurrent) {
                                  ;(event.currentTarget.nextElementSibling as HTMLElement | null)?.focus()
                                }
                              }}
                              whileTap={tapScale}
                              transition={springSnappy}
                            >
                              跟随歌曲来源
                            </motion.button>
                            <motion.button
                              type="button"
                              role="radio"
                              aria-checked={!preferOriginSource}
                              tabIndex={!preferOriginSource ? 0 : -1}
                              className={`${styles.playbackModeButton} no-drag ${!preferOriginSource ? styles.playbackModeButtonActive : ''}`}
                              onClick={() => setPreferOriginSource(false)}
                              onKeyDown={(event) => {
                                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
                                event.preventDefault()
                                const keepCurrent = event.key === 'End'
                                setPreferOriginSource(!keepCurrent)
                                if (!keepCurrent) {
                                  ;(event.currentTarget.previousElementSibling as HTMLElement | null)?.focus()
                                }
                              }}
                              whileTap={tapScale}
                              transition={springSnappy}
                            >
                              固定播放顺序
                            </motion.button>
                          </div>
                          <p className={styles.playbackModeExplanation}>
                            {preferOriginSource
                              ? '先用歌曲原平台，下方顺序用于补位。'
                              : '先用排名第一的平台，与歌曲来源无关。'}
                          </p>
                        </div>
                      ) : visiblePlaybackOrder.length === 1 ? (
                        <div className={styles.playbackSingleProviderHint}>当前只有一个已启用平台，无需设置接力方式。</div>
                      ) : null}

                      <div className={styles.playbackOrderBlock}>
                        <div className={styles.playbackOrderHeading}>
                          <span>
                            {visiblePlaybackOrder.length <= 1
                              ? '当前音源'
                              : preferOriginSource ? '跨平台补位顺序' : '固定播放顺序'}
                          </span>
                          {visiblePlaybackOrder.length > 1 && <small>拖动排序 · 键盘可用 Alt + ↑/↓</small>}
                        </div>
                        <PlaybackOrderEditor
                          order={visiblePlaybackOrder}
                          followOrigin={preferOriginSource}
                          emptyMessage={playbackAuthPending ? '正在核实平台账号状态…' : '先在“音源与账户”中启用一个平台'}
                          onChange={setPlaybackOrder}
                        />
                      </div>

                      {visiblePlaybackOrder.length > 1 && <div className={styles.playbackFallbackRow}>
                        <div>
                          <strong>播放失败后自动换源</strong>
                          <small>
                            {multiSourceFallback
                              ? '当前平台失败后，按排序尝试其他平台。'
                              : '当前平台仍无法播放就停止。'}
                          </small>
                        </div>
                        <Switch
                          checked={multiSourceFallback}
                          onChange={setMultiSourceFallback}
                          aria-label="播放失败后自动换源"
                        />
                      </div>}

                      <p className={styles.playbackSingleProviderHint}>已有缓存优先播放 · 新设置下次起播生效</p>
                    </div>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>音质偏好</span>
                    <div className={styles.segControl}>
                      {(['standard', 'higher', 'exhigh', 'lossless', 'max'] as AudioQuality[]).map((q) => (
                        <motion.button
                          key={q}
                          className={`${styles.seg} no-drag ${audioQuality === q ? styles.segActive : ''}`}
                          onClick={() => setAudioQuality(q)}
                          whileTap={tapScale}
                          transition={springSnappy}
                          title={q === 'max' ? '按每首歌实际可得的最高音质播放(母带/Hi-Res/无损…逐级回退)' : undefined}
                        >
                          {{ standard: '标准', higher: '高品质', exhigh: '极高', lossless: '无损', max: '最高' }[q]}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </section>
            <section id="settings-section-visual" className={styles.settingsSection} aria-labelledby="settings-heading-visual">
              <SectionHeading section={SETTINGS_TABS[1]} index={1} />
              <div className={`${styles.settingsGrid} ${styles.visualGrid}`}>
                <div className={styles.visualColumn}>
                  <section className={styles.group}>
                    <h3 className={styles.groupTitle}>游戏模式</h3>
                    <p className={styles.groupHint}>收起主窗口、壁纸与迷你条，暂停界面动效，保留音乐播放和已启用的全局快捷键。可从托盘退出并恢复。</p>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>使用托盘或全局快捷键控制播放。</span>
                      <button type="button" className={`${styles.seg} no-drag`} onClick={() => void useGameModeStore.getState().configure({ enabled: true })}>进入游戏模式</button>
                    </div>
                  </section>
                  <section className={styles.group}>
                    <h3 className={styles.groupTitle}>主题</h3>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>主题模式</span>
                      <div className={styles.segControl}>
                        {(['auto', 'light', 'dark'] as ThemeMode[]).map((m) => (
                          <motion.button
                            key={m}
                            className={`${styles.seg} no-drag ${themeMode === m ? styles.segActive : ''}`}
                            onClick={() => setThemeMode(m)}
                            whileTap={tapScale}
                            transition={springSnappy}
                          >
                            {{ auto: '自动', light: '浅色', dark: '深色' }[m]}
                          </motion.button>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className={styles.group}>
                    <h3 className={styles.groupTitle}>
                      界面字体
                      <InfoButton label="界面字体" text={`西文优先显示，中文字符使用中文回退字体。系统默认：${defaultFonts.western} / ${defaultFonts.cjk}`} />
                    </h3>
                    <div className={styles.fontGuide}>
                      <span role="status" aria-live="polite">
                        {fontsLoading ? '正在读取系统字体…' : fontsError ? '读取失败' : `${systemFonts.length} 种系统字体可用`}
                      </span>
                      {fontsError && (
                        <button type="button" className={`${styles.seg} no-drag`} onClick={() => void loadSystemFonts()}>
                          重试
                        </button>
                      )}
                    </div>
                    <FontPairSetting
                      label="界面"
                      idPrefix="settings-interface-font"
                      westernValue={fontFamily}
                      cjkValue={fontFamilyCjk}
                      fonts={systemFonts}
                      loading={fontsLoading}
                      westernDefaultLabel={`默认：${defaultFonts.western}`}
                      cjkDefaultLabel={`默认：${defaultFonts.cjk}`}
                      onWesternChange={setFontFamily}
                      onCjkChange={setFontFamilyCjk}
                    />
                  </section>
                  <section className={`${styles.group} ${styles.miniPlayerGroup}`}>
                    <h3 className={styles.groupTitle}>
                      迷你播放条
                      <InfoButton label="迷你播放条" text={`开关在播放栏右侧。悬浮条可拖动、拖右边缘可调宽度；加宽到 ${MINI_PLAYER_LYRICS_WIDTH}px 以上会显示当前歌词。`} />
                    </h3>
                    <SliderRow
                      label="底板不透明度"
                      min={0.15}
                      max={1}
                      step={0.01}
                      value={miniPlayerAppearance.opacity}
                      format={(v) => `${Math.round(v * 100)}%`}
                      onChange={(v) => setMiniPlayerAppearance({ opacity: v })}
                    />
                    <SliderRow
                      label="背景模糊"
                      min={0}
                      max={36}
                      step={1}
                      value={miniPlayerAppearance.blur}
                      format={(v) => `${Math.round(v)}px`}
                      onChange={(v) => setMiniPlayerAppearance({ blur: v })}
                    />
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>色调</span>
                      <div className={styles.segControl}>
                        {MINI_PLAYER_TINTS.map((t) => (
                          <button
                            key={t.value}
                            type="button"
                            className={`${styles.seg} ${miniPlayerAppearance.tint === t.value ? styles.segActive : ''}`}
                            onClick={() => setMiniPlayerAppearance({ tint: t.value })}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>显示底边进度条</span>
                      <Switch
                        checked={miniPlayerAppearance.showProgress}
                        onChange={(v) => setMiniPlayerAppearance({ showProgress: v })}
                        aria-label="显示底边进度条"
                      />
                    </div>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>加宽后显示歌词</span>
                      <Switch
                        checked={miniPlayerAppearance.showLyrics}
                        onChange={(v) => setMiniPlayerAppearance({ showLyrics: v })}
                        aria-label="加宽后显示歌词"
                      />
                    </div>
                  </section>
                </div>
                <div className={styles.visualColumn}>
                  <section className={styles.group}>
                    <h3 className={styles.groupTitle}>
                      界面动效
                      <InfoButton label="动效预设" text="预设只调整界面动效；3D 歌词可在歌词设置中单独启用。" />
                    </h3>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>动效预设</span>
                      <div className={styles.segControl}>
                        {(Object.keys(PERFORMANCE_PRESET_LABELS) as PerformancePreset[]).map((id) => (
                          <motion.button
                            key={id}
                            className={`${styles.seg} no-drag ${activePerformancePreset === id ? styles.segActive : ''}`}
                            onClick={() => applyPerformancePreset(id)}
                            whileTap={tapScale}
                            transition={springSnappy}
                          >
                            {PERFORMANCE_PRESET_LABELS[id]}
                          </motion.button>
                        ))}
                        <span
                          className={`${styles.seg} ${styles.segCustom} ${activePerformancePreset === null ? styles.segActive : ''}`}
                          title="单独调整开关后，组合不再对应预设，改动仍会保存"
                        >
                          自定义
                        </span>
                      </div>
                    </div>
                    {PERFORMANCE_FLAG_LABELS.map(({ key, label, hint }) => (
                      <div className={styles.row} key={key}>
                        <span className={styles.rowLabel}>
                          {label}
                          {hint && <InfoButton label={label} text={hint} />}
                        </span>
                        <Switch checked={performance[key]} onChange={(v) => setPerformance({ [key]: v })} aria-label={label} />
                      </div>
                    ))}
                  </section>
                </div>
              </div>
            </section>
            <section id="settings-section-lyrics" className={styles.settingsSection} aria-labelledby="settings-heading-lyrics">
              <SectionHeading section={SETTINGS_TABS[2]} index={2} />
              <div className={styles.lyricsPage}>
                <DesktopLyricsSettings />
                <section className={styles.group}>
                  <h3 className={styles.groupTitle}>
                    歌词字体
                    <InfoButton label="歌词字体" text="桌面、普通和 3D 歌词可分别选中文与西文字体；留空时跟随对应的界面字体。" />
                  </h3>
                  <div className={styles.fontGuide}>
                    <span role="status" aria-live="polite">
                      {fontsLoading ? '正在读取系统字体…' : fontsError ? '读取失败' : `${systemFonts.length} 种系统字体可用`}
                    </span>
                    {fontsError && (
                      <button type="button" className={`${styles.seg} no-drag`} onClick={() => void loadSystemFonts()}>
                        重试
                      </button>
                    )}
                  </div>
                  <FontPairSetting
                    label="桌面歌词"
                    idPrefix="settings-desktop-lyrics-font"
                    westernValue={fx.desktopLyricsFontFamily}
                    cjkValue={fx.desktopLyricsFontFamilyCjk}
                    fonts={systemFonts}
                    loading={fontsLoading}
                    westernDefaultLabel={`跟随界面：${inheritedWesternFont}`}
                    cjkDefaultLabel={`跟随界面：${inheritedCjkFont}`}
                    onWesternChange={(value) => updateFx({ desktopLyricsFontFamily: value })}
                    onCjkChange={(value) => updateFx({ desktopLyricsFontFamilyCjk: value })}
                  />
                  <FontPairSetting
                    label="普通歌词"
                    idPrefix="settings-lyrics-font"
                    westernValue={lyricsFontFamily}
                    cjkValue={lyricsFontFamilyCjk}
                    fonts={systemFonts}
                    loading={fontsLoading}
                    westernDefaultLabel={`跟随界面：${inheritedWesternFont}`}
                    cjkDefaultLabel={`跟随界面：${inheritedCjkFont}`}
                    onWesternChange={setLyricsFontFamily}
                    onCjkChange={setLyricsFontFamilyCjk}
                  />
                  <FontPairSetting
                    label="3D 歌词"
                    idPrefix="settings-lyrics-3d-font"
                    westernValue={lyrics3dFontFamily}
                    cjkValue={lyrics3dFontFamilyCjk}
                    fonts={systemFonts}
                    loading={fontsLoading}
                    westernDefaultLabel={`跟随界面：${inheritedWesternFont}`}
                    cjkDefaultLabel={`跟随界面：${inheritedCjkFont}`}
                    onWesternChange={setLyrics3dFontFamily}
                    onCjkChange={setLyrics3dFontFamilyCjk}
                  />
                </section>
                <section className={styles.group}>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>
                      启用 3D 歌词舞台
                      <InfoButton label="3D 歌词" text="关闭后播放页使用普通歌词；下方场景与渲染设置保留，重新启用后生效。" />
                    </span>
                    <Switch
                      checked={performance.lyrics3dEnabled}
                      onChange={setLyrics3dEnabled}
                      aria-label="启用 3D 歌词舞台"
                      aria-controls="settings-lyrics3d-details"
                    />
                  </div>
                </section>
                <fieldset
                  id="settings-lyrics3d-details"
                  className={styles.lyricsDetails}
                  disabled={!performance.lyrics3dEnabled}
                  aria-describedby="settings-lyrics3d-hint"
                >
                  <legend>3D 歌词详细设置</legend>
                  <p id="settings-lyrics3d-hint" className={styles.lyricsDetailsHint}>
                    {performance.lyrics3dEnabled ? '调整场景、文字与渲染效果。' : '启用 3D 歌词舞台后可调整；当前设置已保留，歌词字体仍可独立选择。'}
                  </p>
                  <Lyrics3dSettings view="scene" />
                  <Lyrics3dSettings view="tuning" />
                </fieldset>
              </div>
            </section>
            <section id="settings-section-cache" className={styles.settingsSection} aria-labelledby="settings-heading-cache">
              <SectionHeading section={SETTINGS_TABS[3]} index={3} />
              <div className={`${styles.settingsGrid} ${styles.storageGrid}`}>
                <section className={`${styles.group} ${styles.storageShared}`}>
                  <h3 className={styles.groupTitle}>歌曲下载</h3>
                  <p className={styles.groupHint}>歌曲按名称保存为音频文件，支持批量加入下载队列、三首并发、暂停和重试。更改下载目录保留已有文件，清理播放器缓存不会删除这些文件。</p>
                  <div className={`${styles.row} ${styles.pathRow}`}>
                    <span className={styles.rowLabel}>下载目录</span>
                    <span className={`${styles.rowValue} ${styles.pathValue}`} title={downloadDir}>{downloadDir || '在下载队列中选择'}</span>
                    <button className={`${styles.storageAction} no-drag`} onClick={() => useOfflineCacheStore.getState().setQueueOpen(true)}>管理下载与目录</button>
                  </div>
                </section>
                <section className={styles.group}>
                  <h3 className={styles.groupTitle}>自动缓存</h3>
                  <p className={styles.groupHint}>播放时自动产生，容量满后可自动清理。清理缓存不会删除已下载歌曲。</p>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>缓存占用</span>
                    <span className={styles.rowValue}>
                      {audioCache ? `${formatCacheSize(audioCache.temporaryBytes)} · ${audioCache.temporaryFiles} 个文件` : '—'}
                    </span>
                    <button className={`${styles.storageAction} no-drag`} disabled={clearingCache || !audioCache?.temporaryFiles} title={audioCache?.temporaryFiles === 0 ? '暂无自动缓存可清理' : undefined} onClick={() => void handleClearAudioCache('temporary')}>
                      {clearingCache ? '处理中…' : '清理自动缓存'}
                    </button>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>自动缓存上限</span>
                    <div className={styles.segControl}>
                      {CACHE_LIMIT_PRESETS_GB.map((gb) => (
                        <motion.button
                          key={gb}
                          className={`${styles.seg} no-drag ${cacheConfig?.limitBytes === gb * 1024 ** 3 ? styles.segActive : ''}`}
                          onClick={() => void postCacheConfig({ limitBytes: gb * 1024 ** 3 })}
                          whileTap={tapScale}
                          transition={springSnappy}
                        >
                          {gb} GB
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </section>
                <section className={styles.group}>
                  <h3 className={styles.groupTitle}>播放器离线音乐</h3>
                  <p className={styles.groupHint}>播放器中保留的离线音频，不占自动缓存额度，可在“我的库 → 离线音乐”中查看；与下载目录中的歌曲文件分别管理。</p>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>离线音频占用</span>
                    <span className={styles.rowValue}>
                      {audioCache ? `${formatCacheSize(audioCache.pinnedBytes)} · ${audioCache.pinnedFiles} 个文件` : '—'}
                    </span>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowValue}>删除前会再次确认</span>
                    <button className={`${styles.storageAction} no-drag`} disabled={clearingCache || !audioCache?.pinnedFiles} onClick={() => void handleClearAudioCache('pinned')}>
                      删除离线音频
                    </button>
                  </div>
                </section>
                <section className={`${styles.group} ${styles.storageShared}`}>
                  <h3 className={styles.groupTitle}>播放器缓存位置</h3>
                  <p className={styles.groupHint}>自动缓存与播放器离线音乐共用此位置，分别统计和清理。更改位置会清除原目录中的缓存、离线音频及未识别旧文件，不影响独立下载目录中的歌曲文件。</p>
                  <div className={`${styles.row} ${styles.pathRow}`}>
                    <span className={styles.rowLabel}>缓存文件夹</span>
                    <span className={`${styles.rowValue} ${styles.pathValue}`} title={cacheConfig?.dir}>
                      {cacheConfig?.dir ?? '—'}
                    </span>
                    {!!window.desktop?.selectDirectory && (
                      <button className={`${styles.storageAction} no-drag`} disabled={!cacheConfig} onClick={() => void handlePickCacheDir()}>
                        更改
                      </button>
                    )}
                    {cacheConfig && cacheConfig.dir !== cacheConfig.defaultDir && (
                      <button className={`${styles.storageAction} no-drag`} onClick={() => {
                        const hasSaved = !!audioCache?.pinnedFiles
                        if ((hasSaved || audioCache?.unmanagedFiles) && !window.confirm('恢复默认缓存位置会清除当前目录中的自动缓存、播放器离线音频和未识别旧文件，独立下载目录中的歌曲文件会保留。仍要继续吗？')) return
                        void postCacheConfig({ dir: '', confirmPinned: hasSaved })
                      }}>
                        恢复默认
                      </button>
                    )}
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>总占用</span>
                    <span className={styles.rowValue}>
                      {audioCache ? `${formatCacheSize(audioCache.bytes)} · ${audioCache.files} 个文件` : '—'}
                    </span>
                  </div>
                  {!!audioCache?.unmanagedFiles && (
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>未识别旧文件<InfoButton label="未识别旧文件" text="这些文件缺少可用记录，无法判断是否曾经保存下载；不会随自动缓存清理，手动删除需要确认。" /></span>
                      <span className={styles.rowValue}>{formatCacheSize(audioCache.unmanagedBytes)} · {audioCache.unmanagedFiles} 个</span>
                      <button className={`${styles.storageAction} no-drag`} disabled={clearingCache} onClick={() => void handleClearAudioCache('unmanaged')}>
                        删除未识别文件
                      </button>
                    </div>
                  )}
                </section>
              </div>
            </section>
            <section id="settings-section-shortcuts" className={styles.settingsSection} aria-labelledby="settings-heading-shortcuts">
              <SectionHeading section={SETTINGS_TABS[4]} index={4} />
              <ShortcutSettings />
            </section>
            <section id="settings-section-about" className={styles.settingsSection} aria-labelledby="settings-heading-about">
              <SectionHeading section={SETTINGS_TABS[5]} index={5} />
              <div className={styles.settingsGrid}>
                <section className={styles.group}>
                  <h3 className={styles.groupTitle}>版本与更新</h3>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>Simple Music</span>
                    <span className={styles.rowValue}>v{currentVersion}</span>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>{updateStatusText}</span>
                    {ready ? (
                      <button className={`${styles.seg} no-drag`} disabled={installing} onClick={() => void installUpdate()}>
                        {installing
                          ? isMacUpdate
                            ? '正在打开安装包…'
                            : '正在安装…'
                          : isMacUpdate
                            ? '打开安装包'
                            : '重启并安装'}
                      </button>
                    ) : downloading ? (
                      <span className={styles.rowValue}>{job?.progress ?? 0}%</span>
                    ) : updateInfo?.updateAvailable ? (
                      <button className={`${styles.seg} no-drag`} onClick={() => void startDownload()}>
                        下载更新
                      </button>
                    ) : (
                      <button className={`${styles.seg} no-drag`} disabled={checking} onClick={() => void checkForUpdate()}>
                        检查更新
                      </button>
                    )}
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>查看各版本的更新内容</span>
                    <button type="button" className={`${styles.seg} no-drag`} onClick={() => useNavigationStore.getState().navigateTo('release-history')}>
                      更新日志
                    </button>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>开源项目</span>
                    <a
                      className={`${styles.aboutLink} no-drag`}
                      href="https://github.com/Yyyangshenghao/simple-music"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="在浏览器中打开 GitHub 项目主页"
                      title="GitHub 项目主页"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                      </svg>
                    </a>
                  </div>
                </section>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
