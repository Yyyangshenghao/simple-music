import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { api } from '../lib/api'
import { PERFORMANCE_PRESETS, useSettingsStore, type PerformancePreset } from '../stores/settings'
import { useToastStore } from '../stores/toast'
import { useVisualStore } from '../stores/visual'
import { useUpdateStore } from '../stores/update'
import { springSnappy, tapScale } from '../lib/motion-presets'
import { Switch } from '../components/ui/Switch'
import type { Lyrics3dEffect, Lyrics3dParams, PerformanceFlags } from '../types/domain'
import styles from './SettingsPage.module.css'

type ThemeMode = 'auto' | 'light' | 'dark'
type AudioQuality = 'standard' | 'higher' | 'exhigh' | 'lossless'
type SettingsTab = 'general' | 'lyrics3d'

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
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="no-drag"
      />
      <span className={styles.rowValue}>{format(value)}</span>
    </div>
  )
}

const EFFECT_LABELS: Record<Lyrics3dEffect, string> = {
  'cover-cloud': '封面粒子云',
  'waveform-3d': '3D 频谱环',
  'speaker-particles': '音箱沙粒'
}

const FPS_OPTIONS = [0, 60, 45, 30, 24]

const PERFORMANCE_PRESET_LABELS: Record<PerformancePreset, string> = {
  standard: '标准',
  simple: '简单模式',
  minimal: '极简模式',
}

const PERFORMANCE_FLAG_LABELS: { key: keyof PerformanceFlags; label: string; hint: string }[] = [
  { key: 'bgFluidMotion', label: '背景跟手流体动效', hint: '关闭后氛围背景改用静态渐变,不再跟随鼠标' },
  { key: 'lyrics3dEnabled', label: '3D 歌词模式', hint: '关闭后歌词页只保留纯文字滚动,3D 按钮禁用' },
  { key: 'cardTiltEffect', label: '卡片跟光 3D 倾斜', hint: '歌单/推荐卡片跟随鼠标倾斜追光' },
  { key: 'clickSparkEffect', label: '点击火花特效', hint: '' },
  { key: 'gradientTextMotion', label: '标题流光呼吸动画', hint: '' },
]

/** 当前开关组合与某预设完全一致时返回该预设 id,否则返回 null(自定义组合,不高亮任何预设)。 */
function matchPerformancePreset(flags: PerformanceFlags): PerformancePreset | null {
  for (const id of Object.keys(PERFORMANCE_PRESETS) as PerformancePreset[]) {
    const preset = PERFORMANCE_PRESETS[id]
    if ((Object.keys(preset) as (keyof PerformanceFlags)[]).every((k) => preset[k] === flags[k])) return id
  }
  return null
}

/** 3D 歌词标签页:效果选择 + 粒子/波纹/性能参数,实时生效并持久化。 */
function Lyrics3dSettings() {
  const lyrics3dEffect = useSettingsStore((s) => s.lyrics3dEffect)
  const setLyrics3dEffect = useSettingsStore((s) => s.setLyrics3dEffect)
  const params = useSettingsStore((s) => s.lyrics3d)
  const setParams = useSettingsStore((s) => s.setLyrics3dParams)
  const resetParams = useSettingsStore((s) => s.resetLyrics3dParams)
  const lyricsOverlayBlur = useSettingsStore((s) => s.lyricsOverlayBlur)
  const setLyricsOverlayBlur = useSettingsStore((s) => s.setLyricsOverlayBlur)

  const patch = (key: keyof Lyrics3dParams) => (v: number) => setParams({ [key]: v })
  const percent = (v: number): string => `${Math.round(v * 100)}%`

  return (
    <>
      <section className={styles.group}>
        <h2 className={styles.groupTitle}>效果</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>3D 效果</span>
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
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>粒子</h2>
        <SliderRow label="粒子数量" min={0.25} max={2} step={0.05}
          value={params.particleCount} format={percent} onChange={patch('particleCount')} />
        <SliderRow label="粒子大小" min={0.2} max={2} step={0.05}
          value={params.particleSize} format={percent} onChange={patch('particleSize')} />
        <SliderRow label="粒子亮度" min={0.3} max={2} step={0.05}
          value={params.particleBrightness} format={percent} onChange={patch('particleBrightness')} />
        <SliderRow label="辉光强度" min={0} max={2} step={0.05}
          value={params.glowStrength} format={percent} onChange={patch('glowStrength')} />
        <SliderRow label="动效强度" min={0.2} max={2} step={0.05}
          value={params.motionIntensity} format={percent} onChange={patch('motionIntensity')} />
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>鼓点波纹（封面粒子云）</h2>
        <SliderRow label="波纹数量" min={1} max={6} step={1}
          value={params.rippleCount} format={(v) => `${v} 道`} onChange={patch('rippleCount')} />
        <SliderRow label="触发灵敏度" min={0} max={1} step={0.01}
          value={params.rippleSensitivity} format={percent} onChange={patch('rippleSensitivity')} />
        <SliderRow label="扩散时长" min={0.2} max={1.5} step={0.05}
          value={params.rippleDuration} format={(v) => `${v.toFixed(2)}s`} onChange={patch('rippleDuration')} />
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>性能</h2>
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
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>歌词叠加层</h2>
        <SliderRow label="底部模糊度" min={0} max={1} step={0.01}
          value={lyricsOverlayBlur} format={percent} onChange={setLyricsOverlayBlur} />
      </section>

      <section className={styles.group}>
        <div className={styles.row}>
          <span className={styles.rowLabel}>恢复全部 3D 参数为默认值</span>
          <button className={`${styles.seg} no-drag`} onClick={resetParams}>
            恢复默认
          </button>
        </div>
      </section>
    </>
  )
}

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('general')
  const themeMode = useSettingsStore((s) => s.themeMode)
  const setThemeMode = useSettingsStore((s) => s.setThemeMode)
  const fontFamily = useSettingsStore((s) => s.fontFamily)
  const setFontFamily = useSettingsStore((s) => s.setFontFamily)
  const [fontDraft, setFontDraft] = useState(fontFamily)
  const fontDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // store 中的字体被外部改变时（如导入存档）同步草稿
  useEffect(() => {
    setFontDraft(fontFamily)
  }, [fontFamily])

  const handleFontChange = (value: string): void => {
    setFontDraft(value)
    if (fontDebounce.current) clearTimeout(fontDebounce.current)
    fontDebounce.current = setTimeout(() => setFontFamily(value), 300)
  }

  const handleFontReset = (): void => {
    if (fontDebounce.current) clearTimeout(fontDebounce.current)
    setFontDraft('')
    setFontFamily('')
  }

  const activeSource = useSettingsStore((s) => s.activeSource)
  const setActiveSource = useSettingsStore((s) => s.setActiveSource)
  const audioQuality = useSettingsStore((s) => s.audioQuality)
  const setAudioQuality = useSettingsStore((s) => s.setAudioQuality)
  const crossSourceFallback = useSettingsStore((s) => s.crossSourceFallback)
  const setCrossSourceFallback = useSettingsStore((s) => s.setCrossSourceFallback)
  const performance = useSettingsStore((s) => s.performance)
  const setPerformance = useSettingsStore((s) => s.setPerformance)
  const applyPerformancePreset = useSettingsStore((s) => s.applyPerformancePreset)
  const activePerformancePreset = matchPerformancePreset(performance)

  const [audioCache, setAudioCache] = useState<{ bytes: number; files: number } | null>(null)
  const [cacheConfig, setCacheConfig] = useState<AudioCacheConfigInfo | null>(null)
  const [clearingCache, setClearingCache] = useState(false)
  async function refreshCacheInfo(): Promise<void> {
    try {
      const [stats, config] = await Promise.all([
        api.get<{ bytes: number; files: number }>('/api/audio-cache/stats'),
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
  async function handleClearAudioCache(): Promise<void> {
    setClearingCache(true)
    try {
      await api.get('/api/audio-cache/clear')
      await refreshCacheInfo()
    } catch {
      /* 失败保留旧值 */
    } finally {
      setClearingCache(false)
    }
  }
  async function postCacheConfig(patch: { dir?: string; limitBytes?: number }): Promise<void> {
    try {
      await api.post('/api/audio-cache/config', patch)
    } catch {
      useToastStore.getState().show('缓存设置失败:目录无效或不可写')
    }
    await refreshCacheInfo()
  }
  async function handlePickCacheDir(): Promise<void> {
    const picker = window.desktop?.selectDirectory
    if (!picker) return
    const r = await picker({ title: '选择音频缓存文件夹', defaultPath: cacheConfig?.dir })
    if (!r.ok || !r.filePath) return
    await postCacheConfig({ dir: r.filePath })
  }
  const neteaseLoggedIn = useSettingsStore((s) => s.neteaseLoggedIn)
  const desktopLyrics = useVisualStore((s) => s.fx.desktopLyrics)
  const desktopLyricsSize = useVisualStore((s) => s.fx.desktopLyricsSize)
  const updateFx = useVisualStore((s) => s.updateFx)

  const updateInfo = useUpdateStore((s) => s.info)
  const checking = useUpdateStore((s) => s.checking)
  const downloading = useUpdateStore((s) => s.downloading)
  const job = useUpdateStore((s) => s.job)
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate)
  const startDownload = useUpdateStore((s) => s.startDownload)
  const installing = useUpdateStore((s) => s.installing)
  const installUpdate = useUpdateStore((s) => s.installUpdate)

  const currentVersion = updateInfo?.currentVersion || '1.0.0'
  const ready = job?.status === 'ready'
  const updateStatusText = checking
    ? '检查中…'
    : updateInfo?.updateAvailable
      ? `发现新版本 v${updateInfo.release.version}`
      : updateInfo
        ? '已是最新版本'
        : '尚未检查'

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>设置</h1>

      {/* 标签页导航:通用 / 3D 歌词 */}
      <div className={styles.tabBar}>
        {([['general', '通用'], ['lyrics3d', '3D 歌词']] as [SettingsTab, string][]).map(([id, label]) => (
          <motion.button
            key={id}
            className={`${styles.tab} no-drag ${tab === id ? styles.tabActive : ''}`}
            onClick={() => setTab(id)}
            whileTap={tapScale}
            transition={springSnappy}
          >
            {label}
          </motion.button>
        ))}
      </div>

      {tab === 'lyrics3d' && <Lyrics3dSettings />}

      {tab === 'general' && (<>
      <section className={styles.group}>
        <h2 className={styles.groupTitle}>账户</h2>
        <div className={styles.row}>
          <div className={styles.rowIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z"/>
            </svg>
          </div>
          <span className={styles.rowLabel}>{neteaseLoggedIn ? '已登录网易云' : '未登录'}</span>
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>外观</h2>
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
        <div className={styles.row}>
          <span className={styles.rowLabel}>字体</span>
          <div className={styles.fontRow}>
            <input
              className={`${styles.fontInput} no-drag`}
              value={fontDraft}
              onChange={(e) => handleFontChange(e.target.value)}
              placeholder="系统默认"
            />
            <button type="button" className={`${styles.seg} no-drag`} onClick={handleFontReset}>
              重置
            </button>
          </div>
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>性能</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>预设</span>
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
            {/* 当前开关组合不匹配任何预设时的只读指示态:下面 5 个开关已实时存档,这里仅是展示 */}
            <span
              className={`${styles.seg} ${styles.segCustom} ${activePerformancePreset === null ? styles.segActive : ''}`}
              title="单独调整下面任意开关后,组合不再对应某个预设,但改动会照常保存"
            >
              自定义
            </span>
          </div>
        </div>
        {PERFORMANCE_FLAG_LABELS.map(({ key, label, hint }) => (
          <div className={styles.row} key={key}>
            <span className={styles.rowLabel} title={hint || undefined}>{label}</span>
            <Switch checked={performance[key]} onChange={(v) => setPerformance({ [key]: v })} aria-label={label} />
          </div>
        ))}
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>音乐</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>音源</span>
          <div className={styles.segControl}>
            {(['netease', 'qq'] as const).map((s) => (
              <motion.button
                key={s}
                className={`${styles.seg} no-drag ${activeSource === s ? styles.segActive : ''}`}
                onClick={() => setActiveSource(s)}
                whileTap={tapScale}
                transition={springSnappy}
              >
                {{ netease: '网易云', qq: 'QQ 音乐' }[s]}
              </motion.button>
            ))}
          </div>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>音质偏好</span>
          <div className={styles.segControl}>
            {(['standard', 'higher', 'exhigh', 'lossless'] as AudioQuality[]).map((q) => (
              <motion.button
                key={q}
                className={`${styles.seg} no-drag ${audioQuality === q ? styles.segActive : ''}`}
                onClick={() => setAudioQuality(q)}
                whileTap={tapScale}
                transition={springSnappy}
              >
                {{ standard: '标准', higher: '高品质', exhigh: '极高', lossless: '无损' }[q]}
              </motion.button>
            ))}
          </div>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel} title="当前音源放不了(VIP/下架)时,自动去另一音源搜同曲播放">跨音源兜底播放</span>
          <Switch checked={crossSourceFallback} onChange={setCrossSourceFallback} aria-label="跨音源兜底播放" />
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel} title="已播放的整曲会缓存到此文件夹,重复播放不再消耗流量;更改后原文件夹里的缓存会被清空">缓存位置</span>
          <span className={`${styles.rowValue} ${styles.pathValue}`} title={cacheConfig?.dir}>
            {cacheConfig?.dir ?? '—'}
          </span>
          {!!window.desktop?.selectDirectory && (
            <button className={`${styles.seg} no-drag`} disabled={!cacheConfig} onClick={() => void handlePickCacheDir()}>
              更改
            </button>
          )}
          {cacheConfig && cacheConfig.dir !== cacheConfig.defaultDir && (
            <button className={`${styles.seg} no-drag`} onClick={() => void postCacheConfig({ dir: '' })}>
              恢复默认
            </button>
          )}
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>缓存上限</span>
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
          <span className={styles.rowLabel}>已用空间</span>
          <span className={styles.rowValue}>
            {audioCache ? `${formatCacheSize(audioCache.bytes)} · ${audioCache.files} 首` : '—'}
          </span>
          <button
            className={`${styles.seg} no-drag`}
            disabled={clearingCache || !audioCache || audioCache.bytes === 0}
            onClick={() => void handleClearAudioCache()}
          >
            {clearingCache ? '清理中…' : '清空'}
          </button>
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>桌面歌词</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>启用桌面歌词</span>
          <Switch checked={desktopLyrics} onChange={(v) => updateFx({ desktopLyrics: v })} aria-label="启用桌面歌词" />
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>字体大小</span>
          <input
            type="range"
            min={12}
            max={48}
            step={2}
            value={desktopLyricsSize}
            onChange={(e) => updateFx({ desktopLyricsSize: Number(e.target.value) })}
            className="no-drag"
          />
          <span className={styles.rowValue}>{desktopLyricsSize}px</span>
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>关于</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Simple Music</span>
          <span className={styles.rowValue}>v{currentVersion}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>{updateStatusText}</span>
          {ready ? (
            <button className={`${styles.seg} no-drag`} disabled={installing} onClick={() => void installUpdate()}>
              {installing ? '正在安装…' : '重启并安装'}
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
      </section>
      </>)}
    </div>
  )
}
