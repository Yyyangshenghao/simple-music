import { useVisualStore } from '../../stores/visual'
import { useSettingsStore } from '../../stores/settings'
import { Slider } from '../ui/Slider'
import type { FxParams, PerformanceMode, BackgroundMode } from '../../types/domain'
import type { FileResult, ImportResult } from '../../types/ipc'
import styles from './VisualSettings.module.css'

/** fx 中可用滑块调节的数值字段。 */
type NumericFxKey =
  | 'intensity'
  | 'point'
  | 'speed'
  | 'twist'
  | 'scatter'
  | 'depth'
  | 'bloomStrength'
  | 'lyricScale'
  | 'backgroundOpacity'

const SLIDERS: ReadonlyArray<{ key: NumericFxKey; label: string; min: number; max: number; step: number }> = [
  { key: 'intensity', label: '强度', min: 0, max: 1, step: 0.01 },
  { key: 'point', label: '点密度', min: 0, max: 1, step: 0.01 },
  { key: 'speed', label: '速度', min: 0, max: 3, step: 0.01 },
  { key: 'twist', label: '扭曲', min: 0, max: 1, step: 0.01 },
  { key: 'scatter', label: '散射', min: 0, max: 1, step: 0.01 },
  { key: 'depth', label: '景深', min: 0, max: 1, step: 0.01 },
  { key: 'bloomStrength', label: '泛光强度', min: 0, max: 3, step: 0.01 },
  { key: 'lyricScale', label: '歌词缩放', min: 0.5, max: 3, step: 0.01 },
  { key: 'backgroundOpacity', label: '背景不透明度', min: 0, max: 1, step: 0.01 }
]

const PRESET_COUNT = 8

const PERF_MODES: ReadonlyArray<{ id: PerformanceMode; label: string }> = [
  { id: 'eco', label: '节能' },
  { id: 'balanced', label: '均衡' },
  { id: 'high', label: '高清' },
  { id: 'ultra', label: '极致' }
]

const BG_MODES: ReadonlyArray<{ id: BackgroundMode; label: string }> = [
  { id: 'auto', label: '自动' },
  { id: 'keep', label: '常驻' },
  { id: 'release', label: '释放' }
]

/** 视觉设置：fx 滑块、预设切换、性能/背景模式、存档导入导出。 */
export function VisualSettings() {
  const fx = useVisualStore((s) => s.fx)
  const preset = useVisualStore((s) => s.preset)
  const performanceMode = useVisualStore((s) => s.performanceMode)
  const backgroundMode = useVisualStore((s) => s.backgroundMode)
  const updateFx = useVisualStore((s) => s.updateFx)
  const setPreset = useVisualStore((s) => s.setPreset)
  const setPerformanceMode = useVisualStore((s) => s.setPerformanceMode)
  const setBackgroundMode = useVisualStore((s) => s.setBackgroundMode)

  const setFx = (key: NumericFxKey, value: number): void => {
    const patch: Partial<FxParams> = {}
    patch[key] = value
    updateFx(patch)
  }

  const handleExport = (): void => {
    const text = useSettingsStore.getState().exportArchive('我的预设')
    void (window.desktop?.exportJson({ defaultName: 'simplemusic-fx.json', text }) as
      | Promise<FileResult>
      | undefined)
  }

  const handleImport = (): void => {
    void (async () => {
      const r = (await window.desktop?.importJson()) as ImportResult | undefined
      if (r?.ok && r.text) useSettingsStore.getState().importArchive(r.text)
    })()
  }

  return (
    <div className={styles.root}>
      <section className={styles.section}>
        <h3 className={styles.heading}>预设</h3>
        <div className={styles.grid}>
          {Array.from({ length: PRESET_COUNT }, (_, id) => (
            <button
              key={id}
              type="button"
              className={`${styles.preset}${preset === id ? ` ${styles.active}` : ''}`}
              onClick={() => setPreset(id, { commitPlayback: true })}
            >
              {id + 1}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>参数</h3>
        <div className={styles.sliders}>
          {SLIDERS.map((s) => (
            <Slider
              key={s.key}
              label={s.label}
              min={s.min}
              max={s.max}
              step={s.step}
              value={fx[s.key]}
              onChange={(v) => setFx(s.key, v)}
            />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>性能模式</h3>
        <div className={styles.segment}>
          {PERF_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${styles.segBtn}${performanceMode === m.id ? ` ${styles.active}` : ''}`}
              onClick={() => setPerformanceMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>背景模式</h3>
        <div className={styles.segment}>
          {BG_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${styles.segBtn}${backgroundMode === m.id ? ` ${styles.active}` : ''}`}
              onClick={() => setBackgroundMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>存档</h3>
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={handleExport}>
            保存存档
          </button>
          <button type="button" className={styles.action} onClick={handleImport}>
            导入存档
          </button>
        </div>
      </section>
    </div>
  )
}
