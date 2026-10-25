import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'
import { useMotion } from '../hooks/useMotion'
import { api } from '../lib/api'
import { loginMusicProvider } from '../lib/provider-login'
import { logoutMusicProvider } from '../lib/provider-logout'
import { CONTENT_GUTTER_DEFAULT, CONTENT_GUTTER_MIN, CONTENT_GUTTER_MAX, CONTROL_MOTION_KEYS, PERFORMANCE_PRESETS, controlMotionFlags, useSettingsStore, type PerformancePreset } from '../stores/settings'
import { DEFAULT_MINI_PLAYER_APPEARANCE, MINI_PLAYER_LYRICS_WIDTH } from '../lib/mini-player-config'
import { useToastStore } from '../stores/toast'
import { useUpdateStore } from '../stores/update'
import { springSnappy, tapScale } from '../lib/motion-presets'
import { InfoButton } from '../components/ui/InfoButton'
import { Switch } from '../components/ui/Switch'
import { SettingSlider } from '../components/ui/SettingSlider'
import { SourceBadge } from '../components/ui/SourceBadge'
import { SourceName } from '../components/ui/SourceName'
import { SystemFontPicker } from '../components/ui/SystemFontPicker'
import { AppleMusicAccountInfo, AppleMusicSettings } from '../components/Settings/AppleMusicSettings'
import { AccountButton } from '../components/Settings/AccountButton'
import { AppleMusicIcon, NeteaseLogo, QQMusicLogo } from '../components/ui/brand-logos'
import { ShortcutSettings } from '../components/Settings/ShortcutSettings'
import { DesktopLyricsSettings } from '../components/Settings/DesktopLyricsSettings'
import { AmllLyricsSettings } from '../components/Settings/AmllLyricsSettings'
import { PlaybackLogicHelp } from '../components/Settings/PlaybackLogicHelp'
import { ThemeModePicker } from '../components/Settings/ThemeModePicker'
import { listProviders } from '../providers/registry'
import { useProviderStore } from '../stores/providers'
import { useAppleMusicConnection } from '../stores/apple-music-connection'
import { useNavigationStore } from '../stores/navigation'
import { useVisualStore } from '../stores/visual'
import { useGameModeStore } from '../stores/game-mode'
import { useWindowCloseStore } from '../stores/window-close'
import { useOfflineCacheStore } from '../stores/offline-cache'
import { DEFAULT_BACKGROUND, MEDIA_BLUR_MAX, MEDIA_DIM_MAX, solidBackgroundsFor, useBackgroundStore } from '../stores/background'
import { useLightTheme } from '../hooks/useLightTheme'
import { useAmbientStore } from '../stores/ambient'
import { ACCENT_PRESETS, accentTokensFor } from '../lib/theme-tone'
import type { ProviderId } from '../providers/types'
import type { AppBackgroundKind, PerformanceFlags } from '../types/domain'
import type { MiniPlayerAppearance, SystemFontFamily } from '../types/ipc'
import { version as appVersion } from '../../package.json'
import { EffectPreview, type PreviewEffect } from '../components/Settings/EffectPreview'
import styles from './SettingsPage.module.css'
import pageScroll from '../styles/page-scroll.module.css'

type AudioQuality = 'standard' | 'higher' | 'exhigh' | 'lossless' | 'max'
const SETTINGS_TABS = [
  { id: 'music', label: '音源与播放', items: [
    { id: 'accounts', label: '音源与账户' }, { id: 'playback', label: '播放偏好' },
  ] },
  { id: 'visual', label: '界面与窗口', items: [
    { id: 'appearance', label: '主题与布局' }, { id: 'background', label: '应用背景' },
    { id: 'interface-font', label: '界面字体' },
    { id: 'mini-player', label: '迷你播放条' }, { id: 'motion', label: '动效' },
    { id: 'game', label: '游戏模式' },
  ] },
  { id: 'lyrics', label: '歌词与特效', items: [
    { id: 'desktop-lyrics', label: '桌面歌词' }, { id: 'lyrics-display', label: '歌词显示' },
    { id: 'lyrics-source', label: '歌词来源' },
  ] },
  { id: 'cache', label: '缓存与下载', items: [
    { id: 'downloads', label: '歌曲下载' }, { id: 'player-cache', label: '播放器缓存' },
  ] },
  { id: 'shortcuts', label: '快捷键', items: [] },
  { id: 'about', label: '关于应用', items: [] },
] as const
type SettingsTab = (typeof SETTINGS_TABS)[number]['id']

/** 分支导航几何（参考 React Bits BranchedMenu）：子项行高、分支区宽度、主干横坐标与圆角半径。 */
const BRANCH_ROW = 32
const BRANCH_INDENT = 26
const BRANCH_TRUNK = 7
const BRANCH_RADIUS = 8
const branchY = (k: number) => k * BRANCH_ROW + BRANCH_ROW / 2
const branchEnd = BRANCH_INDENT - 6
const branchLength = (k: number) => branchY(k) - BRANCH_RADIUS + (Math.PI * BRANCH_RADIUS) / 2 + (branchEnd - BRANCH_TRUNK - BRANCH_RADIUS)
const branchArc = `A ${BRANCH_RADIUS} ${BRANCH_RADIUS} 0 0 0 ${BRANCH_TRUNK + BRANCH_RADIUS}`

/** 子项分支线：灰色主干与弧形分支常显，当前子项从主干顶端描出一条强调色通路。 */
function BranchLines({ items, active }: { items: readonly { id: string }[]; active: string }) {
  const height = items.length * BRANCH_ROW
  return (
    <svg className={styles.branchLines} width={BRANCH_INDENT} height={height} aria-hidden="true">
      <path className={styles.branchBase} d={`M ${BRANCH_TRUNK} 0 V ${branchY(items.length - 1) - BRANCH_RADIUS}`} />
      {items.map((item, k) => (
        <path key={item.id} className={styles.branchBase}
          d={`M ${BRANCH_TRUNK} ${branchY(k) - BRANCH_RADIUS} ${branchArc} ${branchY(k)} H ${branchEnd}`} />
      ))}
      {items.map((item, k) => (
        <path key={item.id} className={styles.branchReach}
          d={`M ${BRANCH_TRUNK} 0 V ${branchY(k) - BRANCH_RADIUS} ${branchArc} ${branchY(k)} H ${branchEnd}`}
          style={{ strokeDasharray: branchLength(k), strokeDashoffset: item.id === active ? 0 : branchLength(k) }} />
      ))}
    </svg>
  )
}

function SectionHeading({ section }: { section: (typeof SETTINGS_TABS)[number] }) {
  return (
    <div className={styles.sectionHeading}>
      <h2 id={`settings-heading-${section.id}`}>{section.label}</h2>
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

function WindowCloseSettings() {
  const behavior = useWindowCloseStore((s) => s.behavior)
  const initialized = useWindowCloseStore((s) => s.initialized)
  const pending = useWindowCloseStore((s) => s.pending)
  const error = useWindowCloseStore((s) => s.error)
  const configure = useWindowCloseStore((s) => s.configure)
  const refresh = useWindowCloseStore((s) => s.refresh)

  return (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>关闭窗口</h3>
      <p className={styles.groupHint}>选择点击关闭按钮时的行为。缩回托盘会继续播放，退出应用会停止播放。</p>
      <div className={styles.row}>
        <span className={styles.rowLabel}>关闭时</span>
        <div className={styles.segControl} role="group" aria-label="关闭窗口方式">
          {(['ask', 'tray', 'quit'] as const).map((value) => (
            <button key={value} type="button" className={`${styles.seg} ${initialized && behavior === value ? styles.segActive : ''}`}
              disabled={!initialized || pending} aria-pressed={initialized && behavior === value} onClick={() => void configure(value)}>
              {{ ask: '每次询问', tray: '缩回托盘', quit: '退出应用' }[value]}
            </button>
          ))}
        </div>
      </div>
      {!initialized && !error && <p className={styles.groupHint} role="status">正在读取关闭方式…</p>}
      {error && <div className={styles.row}>
        <span className={styles.rowLabel} role="alert">{error}</span>
        <button type="button" className={`${styles.action} no-drag`} disabled={pending} onClick={() => void refresh()}>重新读取</button>
      </div>}
    </section>
  )
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

/** 通用滑杆行:label + 胶囊滑条（数值可点开输入，双击滑条恢复默认）。 */
function SliderRow({ label, min, max, step, value, defaultValue, format, scale, unit, onChange, disabled }: {
  label: string
  min: number
  max: number
  step: number
  value: number
  defaultValue: number
  format: (v: number) => string
  /** 输入换算：显示值 = 值 × scale（百分比传 100）。 */
  scale?: number
  unit?: string
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <SettingSlider value={value} min={min} max={max} step={step} defaultValue={defaultValue} format={format}
        scale={scale} unit={unit} ariaLabel={label} disabled={disabled} onChange={onChange} />
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

const PERFORMANCE_PRESET_LABELS: Record<PerformancePreset, string> = {
  standard: '标准',
  simple: '简单模式',
  minimal: '极简模式',
}

type EffectItem = { key: PreviewEffect; label: string; hint: string }

const MOTION_EFFECTS: EffectItem[] = [
  { key: 'pageTransitionMotion', label: '页面转场', hint: '切换页面、弹出菜单与面板、列表滚动入场和封面飞行时的过渡；关闭后直接切换。' },
  { key: 'smoothScrollMotion', label: '平滑滚动', hint: '点击设置目录、切换歌手页标签、翻动卡片栏等页面跳转时平滑滚过去；关闭后直接跳到目标位置。歌词跟随在「歌词换句动画」里。' },
  { key: 'textRevealMotion', label: '文字逐字显现', hint: '简介和帮助说明逐字淡入；关闭后使用普通文本，减少文字节点' },
  { key: 'cardTiltEffect', label: '卡片倾斜', hint: '歌单与推荐卡片随鼠标轻微倾斜；关闭后保留按钮与卡片的基本悬停、按压反馈。' },
  { key: 'cardSpotlightEffect', label: '卡片跟手光斑', hint: '光斑沿卡片表面跟随鼠标，可独立于倾斜启用' },
  { key: 'gradientTextMotion', label: '标题流光', hint: '页面标题的渐变流动与呼吸' },
  { key: 'audioGlowEffect', label: '音频辉光', hint: '播放栏辉光随低频呼吸，关闭可减少持续渲染' },
]

const CONTROL_EFFECTS: EffectItem[] = [
  { key: 'tapFeedbackMotion', label: '按压回弹', hint: '按钮和卡片按下时轻微缩小，松开回弹；关闭后按下没有缩放。' },
  { key: 'hoverLiftMotion', label: '悬停浮起', hint: '卡片悬停上浮、播放栏封面放大、播放控件图标轻移；关闭后悬停只改颜色。' },
  { key: 'toggleMotion', label: '开关与选项', hint: '开关滑块拉伸回弹、分段选择的果冻底块、主题图标切换、勾选框与平台切换面板。' },
  { key: 'indicatorMotion', label: '标签指示条', hint: '顶栏、我的库标签和设置目录的指示条滑到新位置；关闭后直接跳到位。' },
  { key: 'sliderMotion', label: '滑杆手感', hint: '进度、音量等滑杆拖动时的拉伸、倾斜和数值气泡过渡。' },
  { key: 'dragMotion', label: '拖拽手感', hint: '队列拖动时的倾斜、抬起与碎纸删除，探索卡片堆的甩动，歌词来源排序的位移。' },
  { key: 'iconMotion', label: '图标小动画', hint: '红心爆开、播放模式图标变形、返回按钮、均衡器跳动、提示气泡弹出和搜索框展开。' },
]

/** 控件动效：批量开关只一次性设置七项，不压制子项；细节里逐项调整。 */
function ControlMotionGroup() {
  const performance = useSettingsStore((s) => s.performance)
  const setPerformance = useSettingsStore((s) => s.setPerformance)
  const [open, setOpen] = useState(false)
  const enabledCount = CONTROL_MOTION_KEYS.filter(key => performance[key]).length
  const all = enabledCount === CONTROL_MOTION_KEYS.length
  return (
    <div className={styles.controlGroup}>
      <div className={styles.row}>
        <span className={styles.rowLabel}>
          控件动效
          <InfoButton label="控件动效" text="按压、悬停、开关、指示条、滑杆、拖拽与图标的手感动画。这里的开关只是一次性全开或全关，展开细节可逐项调整，各项互不影响。" />
          {enabledCount > 0 && !all && <small className={styles.effectReason}>已开启 {enabledCount}/{CONTROL_MOTION_KEYS.length} 项</small>}
        </span>
        <button type="button" className={`${styles.detailToggle} no-drag`} aria-expanded={open} aria-controls="settings-control-motion-detail" onClick={() => setOpen(value => !value)}>
          细节
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </button>
        <Switch checked={all} onChange={(enabled) => setPerformance(controlMotionFlags(enabled))} aria-label="控件动效" />
      </div>
      <div id="settings-control-motion-detail" className={styles.controlDetail} data-expanded={open} aria-hidden={!open} {...(open ? {} : { inert: '' })}>
        <div className={styles.controlDetailInner}>
          <div className={styles.effectGrid}>
            {CONTROL_EFFECTS.map(effect => <EffectSwitchRow key={effect.key} effect={effect} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

const LYRICS_EFFECTS: EffectItem[] = [
  { key: 'lyricsWordMotion', label: '歌词逐字高亮', hint: '普通歌词按字点亮；关闭后按整行点亮并停止逐字动画' },
  { key: 'lyricsLineMotion', label: '歌词换句动画', hint: '换句时发生的一切：歌词列表滚到新的一行、当前行亮起与其它行淡化、立体歌词与桌面歌词的换行滚动、歌词样式切换过渡；关闭后直接换句。' },
]

const BACKGROUND_EFFECTS: EffectItem[] = [
  { key: 'bgFluidMotion', label: '流体背景', hint: '让氛围背景缓慢流动；关闭后使用静态渐变' },
  { key: 'bgPointerMotion', label: '背景鼠标跟随', hint: '让流体随鼠标移动，需要先开启流体背景' },
]

/** 单项动效开关：只管自己的效果；仅在背景类型或节能档使其无从生效时禁用并说明原因。 */
function EffectSwitchRow({ effect: { key, label, hint } }: { effect: EffectItem }) {
  const performance = useSettingsStore((s) => s.performance)
  const setPerformance = useSettingsStore((s) => s.setPerformance)
  const eco = useVisualStore((s) => s.performanceMode === 'eco')
  const backgroundKind = useBackgroundStore((s) => s.kind)
  const background = key === 'bgFluidMotion' || key === 'bgPointerMotion'
  const reason = background && backgroundKind !== 'fluid' ? '仅流体背景生效'
      : eco && (background || key === 'audioGlowEffect') ? '已随节能档暂停'
        : key === 'bgPointerMotion' && !performance.bgFluidMotion ? '开启流体背景后生效' : ''
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>
        {label}
        <InfoButton label={label} text={hint} preview={<EffectPreview effect={key} />} />
        {reason && <small className={styles.effectReason}>{reason}</small>}
      </span>
      <Switch checked={performance[key]} disabled={Boolean(reason)} onChange={(v) => setPerformance({ [key]: v })} aria-label={label} />
    </div>
  )
}

const BACKGROUND_KINDS: { value: AppBackgroundKind; label: string }[] = [
  { value: 'fluid', label: '流体' }, { value: 'image', label: '图片' },
  { value: 'video', label: '视频' }, { value: 'solid', label: '纯色' },
]

function backgroundImportError(code = ''): string {
  if (code.startsWith('WE_UNSUPPORTED_TYPE')) return '暂只支持 Wallpaper Engine 视频壁纸，场景和网页壁纸无法导入'
  if (code === 'WE_PROJECT_INVALID') return '无法识别这个 project.json'
  if (code === 'UNSUPPORTED_FILE') return '不支持这个文件格式'
  if (code === 'FILE_MISSING') return '找不到壁纸对应的文件'
  return '导入背景失败，请重试'
}

/** 应用背景：类型标签只切换编辑视图，图片/视频导入成功后才替换当前背景。 */
function BackgroundSettings() {
  const background = useBackgroundStore()
  const { update, setMedia, clearMedia } = background
  const [view, setView] = useState<AppBackgroundKind>(background.kind)
  const [importing, setImporting] = useState(false)
  const idPrefix = useId()
  const light = useLightTheme()
  const solids = solidBackgroundsFor(light)
  const solidActive = background.solid === 'custom' || solids.some(item => item.id === background.solid) ? background.solid : 'theme'
  const canImport = !!window.desktop?.importBackground
  const media = view === 'image' ? background.image : view === 'video' ? background.video : null

  function selectView(kind: AppBackgroundKind): void {
    setView(kind)
    if (kind === 'fluid' || kind === 'solid' || background[kind]) update({ kind })
  }
  async function importMedia(): Promise<void> {
    const picker = window.desktop?.importBackground
    if (!picker || importing) return
    setImporting(true)
    try {
      const result = await picker()
      if (result.ok && result.media) {
        setMedia(result.media)
        setView(result.media.kind)
      } else if (!result.canceled) {
        useToastStore.getState().show(backgroundImportError(result.error))
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <section id="settings-detail-background" className={styles.group}>
      <h3 className={styles.groupTitle}>
        应用背景
        <InfoButton label="应用背景" text="导入的图片和视频会复制到应用数据目录，原文件移动或删除不影响。画面过亮或过暗时会自动压暗或提亮，滑杆在此基础上再加强。视频支持 mp4、webm、mov，也可以选 Wallpaper Engine 视频壁纸目录里的 project.json；场景和网页壁纸暂不支持。打开立体歌词时背景会暂时隐藏。" />
      </h3>
      <div className={styles.row}>
        <span className={styles.rowLabel}>背景类型</span>
        <div className={styles.segControl} role="group" aria-label="背景类型">
          {BACKGROUND_KINDS.map(({ value, label }) => <button
            key={value}
            type="button"
            className={`${styles.seg} no-drag ${view === value ? styles.segActive : ''}`}
            aria-pressed={view === value}
            onClick={() => selectView(value)}
          >{label}</button>)}
        </div>
      </div>

      {view === 'fluid' && <>
        <div className={styles.row}>
          <span className={styles.rowLabel}>
            流体配色
            <InfoButton label="流体配色" text="跟随封面时切歌按封面主色变化；自定义配色只改变背景，界面强调色仍跟随封面。" />
          </span>
          <div className={styles.segControl} role="group" aria-label="流体配色">
            {(['cover', 'custom'] as const).map(source => <button
              key={source}
              type="button"
              className={`${styles.seg} no-drag ${background.fluidPalette === source ? styles.segActive : ''}`}
              aria-pressed={background.fluidPalette === source}
              onClick={() => update({ fluidPalette: source })}
            >{source === 'cover' ? '跟随封面' : '自定义'}</button>)}
          </div>
        </div>
        {background.fluidPalette === 'custom' && <div className={styles.row}>
          <span className={styles.rowLabel}>主色 / 副色 / 点缀</span>
          <div className={styles.backgroundColors}>
            {background.fluidColors.map((color, index) => <input
              key={index}
              type="color"
              className={`${styles.colorInput} no-drag`}
              value={color}
              aria-label={['流体主色', '流体副色', '流体点缀色'][index]}
              onChange={(event) => {
                const next = [...background.fluidColors] as typeof background.fluidColors
                next[index] = event.target.value
                update({ fluidColors: next })
              }}
            />)}
          </div>
        </div>}
        {BACKGROUND_EFFECTS.map(effect => <EffectSwitchRow key={effect.key} effect={effect} />)}
      </>}

      {(view === 'image' || view === 'video') && <>
        <div className={styles.row}>
          <span className={`${styles.rowLabel} ${styles.backgroundFile}`} title={media?.name ?? (view === 'image' ? '支持 jpg、png、webp、gif、avif' : '支持 mp4、webm、mov 与 Wallpaper Engine 视频壁纸的 project.json')}>
            {media ? media.name : view === 'image' ? '尚未选择图片' : '尚未选择视频'}
          </span>
          {media && <button type="button" className={`${styles.action} no-drag`} onClick={() => clearMedia(view)}>移除</button>}
          <button type="button" className={`${styles.action} no-drag`} disabled={!canImport || importing} onClick={() => void importMedia()}>
            {importing ? '导入中…' : media ? '更换' : view === 'image' ? '选择图片' : '选择视频'}
          </button>
        </div>
        {media && <>
          <SliderRow label="模糊" min={0} max={MEDIA_BLUR_MAX} step={1} value={background.mediaBlur} defaultValue={DEFAULT_BACKGROUND.mediaBlur}
            format={(v) => `${v} px`} unit="px" onChange={(v) => update({ mediaBlur: v })} />
          <SliderRow label={light ? '额外提亮' : '额外压暗'} min={0} max={MEDIA_DIM_MAX} step={0.05} value={background.mediaDim} defaultValue={DEFAULT_BACKGROUND.mediaDim}
            format={(v) => `${Math.round(v * 100)}%`} scale={100} unit="%" onChange={(v) => update({ mediaDim: v })} />
          {view === 'video' && <p className={styles.groupHint}>视频背景会持续占用 GPU，窗口失焦、隐藏或节能档时暂停。</p>}
        </>}
      </>}

      {view === 'solid' && <><div className={styles.row}>
        <span className={styles.rowLabel}>
          底色
          <InfoButton label="底色" text={`${light ? '浅色主题只列出浅色底' : '深色主题只列出深色底'}，切换主题后不匹配的底色回到主题底色。自定义颜色按所选显示。`} />
        </span>
        <div className={styles.backgroundColors} role="group" aria-label="底色">
          {solids.map(item => <button
            key={item.id}
            type="button"
            className={`${styles.backgroundSwatch} no-drag`}
            style={{ background: item.css }}
            aria-pressed={solidActive === item.id}
            aria-label={item.label}
            title={item.label}
            onClick={() => update({ solid: item.id })}
          />)}
          <label className={`${styles.backgroundSwatch} ${styles.backgroundCustom} no-drag`} htmlFor={`${idPrefix}-solid`} title="自定义" data-active={background.solid === 'custom'} style={{ background: background.solidColor }}>
            <input id={`${idPrefix}-solid`} type="color" value={background.solidColor} aria-label="自定义底色" onChange={(event) => update({ solid: 'custom', solidColor: event.target.value })} />
          </label>
        </div>
      </div>
</>}
    </section>
  )
}

/** 主题色：单色沿用黑白，其余按当前主题自动调亮/调暗，保证文字与按钮对比度。 */
function AccentPicker() {
  const mode = useSettingsStore((s) => s.accentMode)
  const custom = useSettingsStore((s) => s.accentCustom)
  const setAccent = useSettingsStore((s) => s.setAccent)
  const coverColor = useAmbientStore((s) => s.palette[0])
  const light = useLightTheme()
  const idPrefix = useId()
  const swatch = (color: string) => accentTokensFor(color, light)?.accent ?? color
  return <>
    <div className={styles.row}>
      <span className={styles.rowLabel}>
        主题色
        <InfoButton label="主题色" text={`作用于按钮、开关、选中状态，并给面板与弹窗染上一层淡色。${mode === 'cover' ? '随当前歌曲封面变化。' : ''}`} />
      </span>
      <div className={styles.backgroundColors} role="group" aria-label="主题色">
        <button type="button" className={`${styles.backgroundSwatch} ${styles.accentMono} no-drag`} aria-pressed={mode === 'mono'} aria-label="单色" title="单色" onClick={() => setAccent('mono')} />
        <button type="button" className={`${styles.backgroundSwatch} ${styles.accentCover} no-drag`} style={{ '--accent-cover': swatch(coverColor) } as CSSProperties}
          aria-pressed={mode === 'cover'} aria-label="跟随封面" title="跟随封面" onClick={() => setAccent('cover')} />
        {ACCENT_PRESETS.map(item => <button
          key={item.id}
          type="button"
          className={`${styles.backgroundSwatch} no-drag`}
          style={{ background: swatch(item.color) }}
          aria-pressed={mode === item.id}
          aria-label={item.label}
          title={item.label}
          onClick={() => setAccent(item.id)}
        />)}
        <label className={`${styles.backgroundSwatch} ${styles.backgroundCustom} no-drag`} htmlFor={`${idPrefix}-accent`} title="自定义" data-active={mode === 'custom'} style={{ background: swatch(custom) }}>
          <input id={`${idPrefix}-accent`} type="color" value={custom} aria-label="自定义主题色" onChange={(event) => setAccent('custom', event.target.value)} />
        </label>
      </div>
    </div>
  </>
}

/** 当前开关组合与某预设完全一致时返回该预设 id,否则返回 null(自定义组合,不高亮任何预设)。 */
function matchPerformancePreset(flags: PerformanceFlags): PerformancePreset | null {
  for (const id of Object.keys(PERFORMANCE_PRESETS) as PerformancePreset[]) {
    const preset = PERFORMANCE_PRESETS[id]
    if ((Object.keys(preset) as (keyof typeof preset)[]).every((k) => preset[k] === flags[k])) return id
  }
  return null
}

/** 本次运行内记住设置页滚动位置，切到别的页面再回来时回到原处。 */
let savedSettingsScrollTop = 0

/** 子菜单跳转落定后给目标卡片挂一次描边提示；连续点击时重启动画。 */
function markLanded(page: HTMLElement, node: HTMLElement, waitForScroll: boolean): void {
  const mark = () => {
    node.removeAttribute('data-settings-landed')
    void node.offsetWidth
    node.setAttribute('data-settings-landed', '')
    const card = node.matches('section') ? node : node.querySelector('section')
    const clear = (event: AnimationEvent) => {
      if (event.target !== card) return
      card?.removeEventListener('animationend', clear)
      node.removeAttribute('data-settings-landed')
    }
    card?.addEventListener('animationend', clear)
  }
  if (!waitForScroll) { mark(); return }
  const timeout = setTimeout(done, 900)
  function done() {
    clearTimeout(timeout)
    page.removeEventListener('scrollend', done)
    mark()
  }
  page.addEventListener('scrollend', done, { once: true })
}

export function SettingsPage() {
  const smoothScroll = useMotion('smoothScrollMotion')
  const indicatorMotion = useMotion('indicatorMotion')
  const pageRef = useRef<HTMLDivElement>(null)
  const selectedDetailRef = useRef<string | null>(null)
  const [activeSection, setActiveSection] = useState<SettingsTab>('music')
  const [activeDetail, setActiveDetail] = useState('accounts')
  const [expandedSection, setExpandedSection] = useState<SettingsTab | null>('music')
  const tabBarRef = useRef<HTMLDivElement>(null)
  const navMarkerRef = useRef<HTMLSpanElement>(null)
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({})
  const activeSectionRef = useRef<SettingsTab>('music')
  const settingsMusicRequest = useNavigationStore((s) => s.settingsMusicRequest)
  const settingsLyricsRequest = useNavigationStore((s) => s.settingsLyricsRequest)

  // 在首帧绘制前恢复；字体、缓存信息等异步内容撑开高度前不够滚时，等内容长高再补一次，用户先动则放弃。
  useLayoutEffect(() => {
    const page = pageRef.current
    const target = savedSettingsScrollTop
    if (!page || target <= 0) return
    page.scrollTop = target
    if (page.scrollTop >= target - 1) return
    const content = page.firstElementChild
    const stop = () => {
      observer.disconnect()
      clearTimeout(timeout)
      page.removeEventListener('wheel', stop)
      page.removeEventListener('pointerdown', stop)
    }
    const observer = new ResizeObserver(() => {
      page.scrollTop = target
      if (page.scrollTop >= target - 1) stop()
    })
    if (content) observer.observe(content)
    const timeout = setTimeout(stop, 1500)
    page.addEventListener('wheel', stop, { passive: true })
    page.addEventListener('pointerdown', stop)
    return stop
  }, [])

  useEffect(() => {
    const page = pageRef.current
    if (!page) return
    const updateActiveDetail = () => {
      if (selectedDetailRef.current) return
      let current = SETTINGS_TABS[0] as (typeof SETTINGS_TABS)[number]
      for (const section of SETTINGS_TABS) {
        const node = document.getElementById(`settings-section-${section.id}`)
        if (!node) continue
        const offset = parseFloat(getComputedStyle(node).scrollMarginTop) || 0
        if (node.getBoundingClientRect().top <= page.getBoundingClientRect().top + offset + 28) current = section
      }
      if (page.scrollTop + page.clientHeight >= page.scrollHeight - 2) current = SETTINGS_TABS[SETTINGS_TABS.length - 1]
      if (activeSectionRef.current !== current.id) {
        activeSectionRef.current = current.id
        setActiveSection(current.id)
        setExpandedSection(current.items.length ? current.id : null)
      }
      let detail: string = current.items[0]?.id ?? ''
      for (const item of current.items) {
        const node = document.getElementById(`settings-detail-${item.id}`)
        if (!node) continue
        const offset = parseFloat(getComputedStyle(node).scrollMarginTop) || 0
        if (node.getBoundingClientRect().top <= page.getBoundingClientRect().top + offset + 28) detail = item.id
      }
      setActiveDetail(detail)
    }
    const resumeScrollTracking = () => {
      selectedDetailRef.current = null
      updateActiveDetail()
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target === page) resumeScrollTracking()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) resumeScrollTracking()
    }
    const rememberScroll = () => { savedSettingsScrollTop = page.scrollTop }
    page.addEventListener('scroll', rememberScroll, { passive: true })
    page.addEventListener('scroll', updateActiveDetail, { passive: true })
    page.addEventListener('wheel', resumeScrollTracking, { passive: true })
    page.addEventListener('touchstart', resumeScrollTracking, { passive: true })
    page.addEventListener('keydown', handleKeyDown)
    page.addEventListener('pointerdown', handlePointerDown)
    updateActiveDetail()
    return () => {
      page.removeEventListener('scroll', rememberScroll)
      page.removeEventListener('scroll', updateActiveDetail)
      page.removeEventListener('wheel', resumeScrollTracking)
      page.removeEventListener('touchstart', resumeScrollTracking)
      page.removeEventListener('keydown', handleKeyDown)
      page.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [])

  // 左侧导轨标记滑到当前分类；子菜单展开收起改变高度时无过渡地跟随。
  useLayoutEffect(() => {
    const marker = navMarkerRef.current
    const bar = tabBarRef.current
    if (!marker || !bar) return
    const place = (glide: boolean) => {
      const tab = tabRefs.current[activeSection]
      if (!tab) return
      if (!glide) marker.style.transition = 'none'
      marker.style.top = `${tab.offsetTop + (tab.offsetHeight - marker.offsetHeight) / 2}px`
      if (!glide) {
        void marker.offsetHeight
        marker.style.transition = ''
      }
    }
    place(true)
    let first = true
    const observer = new ResizeObserver(() => {
      if (first) { first = false; return }
      place(false)
    })
    observer.observe(bar)
    return () => observer.disconnect()
  }, [activeSection])

  const scrollToSection = useCallback((section: SettingsTab, detail?: string): void => {
    const page = pageRef.current
    const node = document.getElementById(detail ? `settings-detail-${detail}` : `settings-section-${section}`)
    if (!page || !node) return
    selectedDetailRef.current = detail ?? section
    activeSectionRef.current = section
    setActiveSection(section)
    setExpandedSection(SETTINGS_TABS.find(item => item.id === section)!.items.length ? section : null)
    setActiveDetail(detail ?? SETTINGS_TABS.find(item => item.id === section)!.items[0]?.id ?? '')
    const margin = parseFloat(getComputedStyle(node).scrollMarginTop) || 0
    const top = node.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop - margin
    page.scrollTo({ top, behavior: smoothScroll ? 'smooth' : 'instant' })
    if (detail) markLanded(page, node, Math.abs(page.scrollTop - top) > 1 && smoothScroll)
  }, [smoothScroll])
  useEffect(() => {
    const navigation = useNavigationStore.getState()
    if (navigation.lastAction === 'pop' && navigation.future[0] === 'release-history') scrollToSection('about')
  }, [scrollToSection])
  useEffect(() => {
    if (settingsMusicRequest === 0) return
    scrollToSection('music')
    useNavigationStore.getState().consumeSettingsMusicRequest(settingsMusicRequest)
  }, [settingsMusicRequest, scrollToSection])
  useEffect(() => {
    if (settingsLyricsRequest === 0) return
    scrollToSection('lyrics')
    useNavigationStore.getState().consumeSettingsLyricsRequest(settingsLyricsRequest)
  }, [settingsLyricsRequest, scrollToSection])
  const themeMode = useSettingsStore((s) => s.themeMode)
  const setThemeMode = useSettingsStore((s) => s.setThemeMode)
  const contentGutter = useSettingsStore((s) => s.contentGutter)
  const setContentGutter = useSettingsStore((s) => s.setContentGutter)
  const contentLayout = useSettingsStore((s) => s.contentLayout)
  const setContentLayout = useSettingsStore((s) => s.setContentLayout)
  const fontFamily = useSettingsStore((s) => s.fontFamily)
  const setFontFamily = useSettingsStore((s) => s.setFontFamily)
  const fontFamilyCjk = useSettingsStore((s) => s.fontFamilyCjk)
  const setFontFamilyCjk = useSettingsStore((s) => s.setFontFamilyCjk)
  const lyricsFontFamily = useSettingsStore((s) => s.lyricsFontFamily)
  const setLyricsFontFamily = useSettingsStore((s) => s.setLyricsFontFamily)
  const lyricsFontFamilyCjk = useSettingsStore((s) => s.lyricsFontFamilyCjk)
  const setLyricsFontFamilyCjk = useSettingsStore((s) => s.setLyricsFontFamilyCjk)
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
  const unlikeConfirmation = useSettingsStore((s) => s.unlikeConfirmation)
  const setUnlikeConfirmation = useSettingsStore((s) => s.setUnlikeConfirmation)
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
  const eco = useVisualStore((s) => s.performanceMode === 'eco')

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
  const backgroundKind = useBackgroundStore((s) => s.kind)
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
          <h1 className={styles.title}>设置</h1>
        </header>
        <div className={styles.settingsLayout} data-reduced-motion={!indicatorMotion}>
          <aside className={styles.drawer}>
          <nav id="settings-navigation" className={styles.navigation} aria-label="设置导航">
            <div className={styles.tabBar} ref={tabBarRef}>
              <span ref={navMarkerRef} className={styles.navMarker} aria-hidden="true" />
              {SETTINGS_TABS.map(({ id, label, items }) => (
                <div key={id} className={styles.navCategory}>
                  <motion.button
                    ref={(el) => { tabRefs.current[id] = el }}
                    type="button"
                    aria-current={activeSection === id ? 'page' : undefined}
                    aria-expanded={items.length ? expandedSection === id : undefined}
                    aria-controls={items.length ? `settings-section-${id} settings-subnav-${id}` : `settings-section-${id}`}
                    className={`${styles.tab} no-drag ${activeSection === id ? styles.tabActive : ''}`}
                    onClick={(event) => {
                      if (activeSection !== id || items.length === 0) scrollToSection(id)
                      else setExpandedSection(value => value === id ? null : id)
                      if (event.detail > 0) event.currentTarget.blur()
                    }}
                    whileTap={tapScale}
                    transition={springSnappy}
                  >{label}</motion.button>
                  {items.length > 0 && <div id={`settings-subnav-${id}`} className={styles.subNav} data-expanded={expandedSection === id}
                    aria-hidden={expandedSection !== id} {...(expandedSection !== id ? { inert: '' } : {})}>
                    <div className={styles.subNavInner} aria-label={`${label}分组`}>
                    <BranchLines items={items} active={activeSection === id ? activeDetail : ''} />
                    {items.map(item => <button key={item.id} type="button"
                      aria-current={activeDetail === item.id ? 'location' : undefined}
                      aria-controls={`settings-detail-${item.id}`}
                      className={`${styles.subTab} no-drag`}
                      onClick={() => scrollToSection(id, item.id)}>{item.label}</button>)}
                    </div>
                  </div>}
                </div>
              ))}
            </div>
            <div className={styles.compactSubNav} data-expanded={expandedSection === activeSection} aria-hidden={expandedSection !== activeSection}
              {...(expandedSection !== activeSection ? { inert: '' } : {})}>
              <div className={styles.compactSubNavInner} aria-label="当前分类分组">
              {SETTINGS_TABS.find(section => section.id === activeSection)!.items.map(item => <button
                key={item.id} type="button" className={styles.subTab}
                aria-current={activeDetail === item.id ? 'location' : undefined}
                aria-controls={`settings-detail-${item.id}`}
                onClick={() => scrollToSection(activeSection, item.id)}>{item.label}</button>)}
              </div>
            </div>
          </nav>
          </aside>
          <div className={styles.settingsContent}>
            <section id="settings-section-music" className={styles.settingsSection} aria-labelledby="settings-heading-music">
              <SectionHeading section={SETTINGS_TABS[0]} />
              <div className={`${styles.settingsGrid} ${styles.musicGrid}`}>
                <section id="settings-detail-accounts" className={styles.group}>
                  <h3 className={styles.groupTitle}>
                    音源与账户
                    <InfoButton label="音源与账户" text="登录并启用后，平台才会参与浏览和联网播放。停用或退出登录后不再向它获取歌曲，但已有本地缓存仍可播放。来源标识只控制角标显示，不改变播放平台。" />
                  </h3>
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
                <section id="settings-detail-playback" className={styles.group}>
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
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>取消红心前确认</span>
                    <Switch checked={unlikeConfirmation} onChange={setUnlikeConfirmation} aria-label="取消红心前确认" />
                  </div>
                </section>
              </div>
            </section>
            <section id="settings-section-visual" className={styles.settingsSection} aria-labelledby="settings-heading-visual">
              <SectionHeading section={SETTINGS_TABS[1]} />
              <div className={`${styles.settingsGrid} ${styles.visualGrid}`}>
                <div className={styles.visualColumn}>
                  {window.desktop?.platform === 'win32' && <WindowCloseSettings />}
                  <section id="settings-detail-appearance" className={styles.group}>
                    <h3 className={styles.groupTitle}>主题与布局</h3>
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>主题模式</span>
                      <ThemeModePicker value={themeMode} onChange={setThemeMode} />
                    </div>
                    <AccentPicker />
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>
                        页面布局
                        <InfoButton label="页面布局" text="内容延展会移除栏目外框，让音乐内容铺开。" />
                      </span>
                      <div className={styles.segControl} role="group" aria-label="页面布局">
                        {(['framed', 'full'] as const).map(layout => <button
                          key={layout}
                          type="button"
                          className={`${styles.seg} no-drag ${contentLayout === layout ? styles.segActive : ''}`}
                          aria-pressed={contentLayout === layout}
                          onClick={() => setContentLayout(layout)}
                        >{layout === 'framed' ? '保留边框' : '内容延展'}</button>)}
                      </div>
                    </div>
                    {contentLayout === 'full' && <SliderRow
                      label="左右留白"
                      min={CONTENT_GUTTER_MIN} max={CONTENT_GUTTER_MAX} step={1}
                      value={contentGutter} defaultValue={CONTENT_GUTTER_DEFAULT} format={(v) => `${v} px`} unit="px"
                      onChange={setContentGutter}
                    />}
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>
                        减少透明度
                        <InfoButton label="减少透明度" text="使用更实的面板底色并关闭背景模糊，方便阅读。切换动效预设不会改变这一项。" />
                      </span>
                      <Switch
                        checked={performance.reduceTransparency}
                        onChange={(v) => setPerformance({ reduceTransparency: v })}
                        aria-label="减少透明度"
                      />
                    </div>
                  </section>

                  <BackgroundSettings />

                  <section id="settings-detail-interface-font" className={styles.group}>
                    <h3 className={styles.groupTitle}>
                      界面字体
                      <InfoButton label="界面字体" text={`西文优先显示，中文字符使用中文回退字体。系统默认：${defaultFonts.western} / ${defaultFonts.cjk}`} />
                    </h3>
                    <div className={styles.fontGuide} hidden={!fontsLoading && !fontsError}>
                      <span role="status" aria-live="polite">
                        {fontsLoading ? '正在读取系统字体…' : fontsError ? '读取失败' : ''}
                      </span>
                      {fontsError && (
                        <button type="button" className={`${styles.action} no-drag`} onClick={() => void loadSystemFonts()}>
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
                  <section id="settings-detail-mini-player" className={`${styles.group} ${styles.miniPlayerGroup}`}>
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
                      defaultValue={DEFAULT_MINI_PLAYER_APPEARANCE.opacity}
                      format={(v) => `${Math.round(v * 100)}%`}
                      scale={100}
                      unit="%"
                      onChange={(v) => setMiniPlayerAppearance({ opacity: v })}
                    />
                    <SliderRow
                      label="背景模糊"
                      min={0}
                      max={36}
                      step={1}
                      value={miniPlayerAppearance.blur}
                      defaultValue={DEFAULT_MINI_PLAYER_APPEARANCE.blur}
                      format={(v) => `${Math.round(v)}px`}
                      unit="px"
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
                  <section id="settings-detail-motion" className={styles.group}>
                    <h3 className={styles.groupTitle}>
                      动效
                      <InfoButton label="动效预设" text="标准保留完整动效；简单模式静止背景、直接显示说明；极简模式关闭全部动效，包括歌词显示里的两项。预设只是一次性批量设置各项，之后每项独立调整，不会互相压制；减少透明度不受影响。" />
                    </h3>
                    <div className={styles.effectPresetOptions}>
                      <div className={`${styles.segControl} ${styles.effectPresetControl}`} role="group" aria-label="动效预设">
                        {(Object.keys(PERFORMANCE_PRESET_LABELS) as PerformancePreset[]).map((id) => (
                          <motion.button
                            key={id}
                            className={`${styles.seg} no-drag ${activePerformancePreset === id ? styles.segActive : ''}`}
                            aria-pressed={activePerformancePreset === id}
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
                    {eco && <p className={styles.groupHint}>当前为节能档，背景流体与音频辉光暂不生效；原设置已保留。</p>}
                    <div className={styles.effectGrid}>
                      {MOTION_EFFECTS.map(effect => <EffectSwitchRow key={effect.key} effect={effect} />)}
                    </div>
                    <ControlMotionGroup />
                  </section>
                  <section id="settings-detail-game" className={styles.group}>
                    <div className={`${styles.groupTitle} ${styles.groupTitleBare}`}>
                      <h3>
                        游戏模式
                        <InfoButton label="游戏模式" text="收起主窗口、壁纸与迷你条，音乐继续播放。可通过托盘或已启用的全局快捷键控制，从托盘退出并恢复。" />
                      </h3>
                      <button type="button" className={`${styles.action} no-drag`} onClick={() => void useGameModeStore.getState().configure({ enabled: true })}>进入游戏模式</button>
                    </div>
                  </section>
                </div>
              </div>
            </section>
            <section id="settings-section-lyrics" className={styles.settingsSection} aria-labelledby="settings-heading-lyrics">
              <SectionHeading section={SETTINGS_TABS[2]} />
              <div className={styles.lyricsPage}>
                <div id="settings-detail-desktop-lyrics" className={styles.detailSection}><DesktopLyricsSettings /></div>
                <section id="settings-detail-lyrics-display" className={styles.group}>
                  <h3 className={styles.groupTitle}>
                    歌词显示
                    <InfoButton label="歌词显示" text="桌面和普通歌词可分别选中文与西文字体；留空时跟随对应的界面字体。" />
                  </h3>
                  {LYRICS_EFFECTS.map(effect => <EffectSwitchRow key={effect.key} effect={effect} />)}
                  <div className={styles.fontGuide} hidden={!fontsLoading && !fontsError}>
                    <span role="status" aria-live="polite">
                      {fontsLoading ? '正在读取系统字体…' : fontsError ? '读取失败' : ''}
                    </span>
                    {fontsError && (
                      <button type="button" className={`${styles.action} no-drag`} onClick={() => void loadSystemFonts()}>
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

                </section>
                <div id="settings-detail-lyrics-source" className={styles.detailSection}><AmllLyricsSettings /></div>

              </div>
            </section>
            <section id="settings-section-cache" className={styles.settingsSection} aria-labelledby="settings-heading-cache">
              <SectionHeading section={SETTINGS_TABS[3]} />
              <div className={`${styles.settingsGrid} ${styles.storageGrid}`}>
                <section id="settings-detail-downloads" className={`${styles.group} ${styles.storageShared}`}>
                  <h3 className={styles.groupTitle}>
                    歌曲下载
                    <InfoButton label="歌曲下载" text="更改目录只影响之后加入的任务，已有文件保留。" />
                  </h3>
                  <div className={`${styles.row} ${styles.pathRow}`}>
                    <span className={styles.rowLabel}>下载目录</span>
                    <span className={`${styles.rowValue} ${styles.pathValue}`} title={downloadDir}>{downloadDir || '在下载队列中选择'}</span>
                    <button className={`${styles.storageAction} no-drag`} onClick={() => useOfflineCacheStore.getState().setQueueOpen(true)}>管理下载</button>
                  </div>
                </section>
                <section id="settings-detail-player-cache" className={`${styles.group} ${styles.storageShared}`}>
                  <h3 className={styles.groupTitle}>
                    播放器缓存
                    <InfoButton label="播放器缓存" text="自动缓存在播放时保存，容量满后可自动清理；离线音频不占自动缓存额度，可在“我的库 → 离线音乐”中查看。清理缓存不会删除下载目录中的歌曲。" />
                  </h3>
                  <div className={`${styles.row} ${styles.pathRow}`}>
                    <span className={styles.rowLabel}>
                      缓存文件夹
                      <InfoButton label="缓存文件夹" text="更改位置会删除原目录中的缓存、离线音频及未识别旧文件，下载目录中的歌曲不受影响。" />
                    </span>
                    <span className={`${styles.rowValue} ${styles.pathValue}`} title={cacheConfig?.dir}>
                      {cacheConfig?.dir ?? '—'}
                    </span>
                    {!!window.desktop?.selectDirectory && (
                      <button className={`${styles.storageAction} no-drag`} disabled={!cacheConfig} onClick={() => void handlePickCacheDir()}>
                        更改
                      </button>
                    )}
                    {cacheConfig && cacheConfig.dir !== cacheConfig.defaultDir && (
                      <button className={`${styles.storageAction} ${styles.actionQuiet} no-drag`} onClick={() => {
                        const hasSaved = !!audioCache?.pinnedFiles
                        if ((hasSaved || audioCache?.unmanagedFiles) && !window.confirm('恢复默认缓存位置会清除当前目录中的自动缓存、播放器离线音频和未识别旧文件，独立下载目录中的歌曲文件会保留。仍要继续吗？')) return
                        void postCacheConfig({ dir: '', confirmPinned: hasSaved })
                      }}>
                        恢复默认
                      </button>
                    )}
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>自动缓存</span>
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
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>离线音频</span>
                    <span className={styles.rowValue}>
                      {audioCache ? `${formatCacheSize(audioCache.pinnedBytes)} · ${audioCache.pinnedFiles} 个文件` : '—'}
                    </span>
                    <button className={`${styles.storageAction} ${styles.actionDanger} no-drag`} disabled={clearingCache || !audioCache?.pinnedFiles} onClick={() => void handleClearAudioCache('pinned')}>
                      删除离线音频
                    </button>
                  </div>
                  {!!audioCache?.unmanagedFiles && (
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>未识别旧文件<InfoButton label="未识别旧文件" text="这些文件缺少可用记录，无法判断是否曾经保存下载；不会随自动缓存清理，手动删除需要确认。" /></span>
                      <span className={styles.rowValue}>{formatCacheSize(audioCache.unmanagedBytes)} · {audioCache.unmanagedFiles} 个</span>
                      <button className={`${styles.storageAction} ${styles.actionDanger} no-drag`} disabled={clearingCache} onClick={() => void handleClearAudioCache('unmanaged')}>
                        删除未识别文件
                      </button>
                    </div>
                  )}
                </section>
              </div>
            </section>
            <section id="settings-section-shortcuts" className={styles.settingsSection} aria-labelledby="settings-heading-shortcuts">
              <SectionHeading section={SETTINGS_TABS[4]} />
              <ShortcutSettings />
            </section>
            <section id="settings-section-about" className={styles.settingsSection} aria-labelledby="settings-heading-about">
              <SectionHeading section={SETTINGS_TABS[5]} />
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
                      <button className={`${styles.action} ${styles.actionPrimary} no-drag`} disabled={installing} onClick={() => void installUpdate()}>
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
                      <button className={`${styles.action} ${styles.actionPrimary} no-drag`} onClick={() => void startDownload()}>
                        下载更新
                      </button>
                    ) : (
                      <button className={`${styles.action} no-drag`} disabled={checking} onClick={() => void checkForUpdate()}>
                        检查更新
                      </button>
                    )}
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>更新日志</span>
                    <button type="button" className={`${styles.action} ${styles.actionQuiet} no-drag`} aria-label="查看更新日志" onClick={() => useNavigationStore.getState().navigateTo('release-history')}>
                      查看
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
