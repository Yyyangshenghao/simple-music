/**
 * 动态歌词样式的纯数据清单：名称、排序、参数声明与快捷参数。
 * 渲染组件和图标在 components/Lyrics/styles/registry.tsx，按同一个 id 对应；
 * store、App 与迁移逻辑只依赖这里，不会把渲染代码拉进来。
 */

export const LYRIC_STYLE_IDS = ['pop', 'luminous', 'tilt', 'partita', 'fume', 'tempera', 'lumiere', 'sonnet', 'diorama', 'stage3d'] as const
export type LyricStyleId = typeof LYRIC_STYLE_IDS[number]
export const DEFAULT_LYRIC_STYLE: LyricStyleId = 'pop'

export function isLyricStyleId(value: unknown): value is LyricStyleId {
  return typeof value === 'string' && (LYRIC_STYLE_IDS as readonly string[]).includes(value)
}

export type TuningValue = number | boolean | string

export type TuningField =
  | { key: string; type: 'number'; label: string; min: number; max: number; step: number; defaultValue: number; format?: 'percent' | 'multiplier' }
  | { key: string; type: 'boolean'; label: string; defaultValue: boolean }
  | { key: string; type: 'select'; label: string; options: readonly { value: string; label: string }[]; defaultValue: string }

export interface LyricStyleInfo {
  id: LyricStyleId
  label: string
  /** 一句话说明，显示在样式卡片上 */
  hint: string
  order: number
  /** 通用参数声明；由选择器和设置面板按声明生成控件。有自带设置面板的样式可以不声明。 */
  tuning: readonly TuningField[]
  /** 选择器里直接显示的参数键（最多 3 个） */
  quick: readonly string[]
  /** live：卡片里用当前歌曲实时渲染缩略预览；still：重型样式只显示示意图 */
  preview: 'live' | 'still'
  /** 依赖设置中的 3D 歌词开关；关闭时卡片不可选，已选的回落到默认样式 */
  needs3d?: boolean
  /** 始终画暗场（深浅主题都一样）：页头控件改用深色舞台的浅色配色 */
  darkStage?: boolean
  /** 不透明铺满舞台：歌词页不再垫封面虚化与霞光层（被盖住还在后台动画） */
  opaque?: boolean
  /** 全屏 WebGL 场景：与应用背景的 WebGL 层互斥，同屏只跑一个 */
  webgl?: boolean
}

export const LYRIC_STYLES: readonly LyricStyleInfo[] = [
  {
    id: 'pop',
    label: '跃字',
    hint: '居中的连续字列，唱到的字轻轻跃起，是画面唯一的重心',
    order: 0,
    tuning: [
      { key: 'intensity', type: 'number', label: '跃起幅度', min: 0.4, max: 1.6, step: 0.05, defaultValue: 1, format: 'multiplier' },
    ],
    quick: ['intensity'],
    preview: 'live',
  },
  {
    id: 'luminous',
    label: '流光',
    hint: '词句松散浮起，唱到的词发光并荡开涟漪',
    order: 1,
    tuning: [
      { key: 'spread', type: 'number', label: '散布', min: 0, max: 2, step: 0.05, defaultValue: 1, format: 'multiplier' },
      { key: 'glow', type: 'number', label: '辉光', min: 0, max: 2, step: 0.05, defaultValue: 1, format: 'multiplier' },
      { key: 'beat', type: 'boolean', label: '随拍闪烁', defaultValue: true },
      { key: 'breath', type: 'number', label: '呼吸漂浮', min: 0, max: 2, step: 0.05, defaultValue: 1, format: 'multiplier' },
      { key: 'rotation', type: 'boolean', label: '词语倾斜', defaultValue: true },
      { key: 'ripple', type: 'boolean', label: '开唱涟漪', defaultValue: true },
    ],
    quick: ['spread', 'glow', 'beat'],
    preview: 'live',
  },
  {
    id: 'tilt',
    label: '倾诉',
    hint: '正体与细斜体分行错落，逐词浮现',
    order: 2,
    tuning: [
      { key: 'split', type: 'number', label: '分行倾向', min: 0, max: 1, step: 0.05, defaultValue: 0.6, format: 'percent' },
      { key: 'tilt', type: 'number', label: '斜体比例', min: 0, max: 1, step: 0.05, defaultValue: 0.5, format: 'percent' },
      { key: 'offset', type: 'number', label: '错位幅度', min: 0, max: 2, step: 0.05, defaultValue: 1, format: 'multiplier' },
    ],
    quick: ['split', 'tilt', 'offset'],
    preview: 'live',
  },
  {
    id: 'partita',
    label: '云阶',
    hint: '词组成行台阶错落，引导线标出唱到的一级',
    order: 3,
    tuning: [
      { key: 'step', type: 'number', label: '阶梯错落', min: 0, max: 2, step: 0.05, defaultValue: 1, format: 'multiplier' },
      { key: 'emphasis', type: 'number', label: '强调放大', min: 0, max: 2, step: 0.05, defaultValue: 1, format: 'multiplier' },
      { key: 'guides', type: 'boolean', label: '引导线', defaultValue: true },
      { key: 'semantic', type: 'boolean', label: '按词组分行', defaultValue: true },
    ],
    quick: ['step', 'emphasis', 'guides'],
    preview: 'live',
  },
  {
    id: 'fume',
    label: '浮名',
    hint: '整首歌词排成文章，镜头推到正在唱的句子逐字打印',
    order: 4,
    tuning: [
      { key: 'zoom', type: 'number', label: '镜头远近', min: 0.6, max: 1.6, step: 0.05, defaultValue: 1, format: 'multiplier' },
      { key: 'hold', type: 'number', label: '唱后保留', min: 0, max: 1, step: 0.05, defaultValue: 0.5, format: 'percent' },
      { key: 'cursor', type: 'boolean', label: '打字光块', defaultValue: true },
      { key: 'float', type: 'number', label: '镜头漂浮', min: 0, max: 2, step: 0.05, defaultValue: 1, format: 'multiplier' },
      { key: 'decor', type: 'boolean', label: '装饰线条', defaultValue: true },
      { key: 'serif', type: 'boolean', label: '衬线字体', defaultValue: true },
    ],
    quick: ['zoom', 'hold', 'cursor'],
    preview: 'live',
  },
  {
    id: 'tempera',
    label: '凝彩',
    hint: '平涂色块与网点的歌词 PV，镜头沿一个方向接力',
    order: 5,
    tuning: [
      { key: 'settle', type: 'number', label: '落字节奏', min: 0, max: 1, step: 0.05, defaultValue: 0.5, format: 'percent' },
      { key: 'wholeLine', type: 'boolean', label: '整句成镜', defaultValue: false },
      { key: 'mono', type: 'boolean', label: '单色', defaultValue: false },
      { key: 'echo', type: 'boolean', label: '运动残影', defaultValue: true },
      { key: 'decor', type: 'boolean', label: '网点与线条', defaultValue: true },
      { key: 'camera', type: 'number', label: '镜头推移', min: 0, max: 2, step: 0.05, defaultValue: 1, format: 'multiplier' },
    ],
    quick: ['settle', 'wholeLine', 'mono'],
    preview: 'live',
  },
  {
    id: 'lumiere',
    label: '绘光',
    hint: '暗场光柱扫过歌词，唱到的字被点亮，唱过的散成光尘',
    order: 6,
    tuning: [
      { key: 'beams', type: 'number', label: '光柱强度', min: 0, max: 2, step: 0.05, defaultValue: 1, format: 'multiplier' },
      { key: 'drift', type: 'number', label: '崩解飘散', min: 0, max: 2, step: 0.05, defaultValue: 1, format: 'multiplier' },
      { key: 'sparkle', type: 'boolean', label: '点亮闪光', defaultValue: true },
      { key: 'lineArt', type: 'boolean', label: '线稿与星点', defaultValue: true },
      { key: 'bokeh', type: 'boolean', label: '前景光斑', defaultValue: true },
      { key: 'serif', type: 'boolean', label: '衬线字体', defaultValue: true },
    ],
    quick: ['beams', 'drift', 'sparkle'],
    preview: 'live',
    darkStage: true,
    opaque: true,
  },
  {
    id: 'sonnet',
    label: '商籁',
    hint: '印刷感的动态字体与几何线稿，随拍推镜、强拍撕裂',
    order: 7,
    tuning: [
      { key: 'punch', type: 'number', label: '推镜裂光', min: 0, max: 2, step: 0.05, defaultValue: 1, format: 'multiplier' },
      { key: 'geometry', type: 'boolean', label: '几何线稿', defaultValue: true },
      { key: 'hud', type: 'boolean', label: '界面读数', defaultValue: true },
      { key: 'outline', type: 'boolean', label: '未唱描边', defaultValue: true },
      { key: 'glitch', type: 'boolean', label: '强拍撕裂', defaultValue: true },
      { key: 'camera', type: 'number', label: '镜头推移', min: 0, max: 2, step: 0.05, defaultValue: 1, format: 'multiplier' },
    ],
    quick: ['punch', 'geometry', 'hud'],
    preview: 'live',
  },
  {
    id: 'diorama',
    label: '镜台',
    hint: '歌词立在雾中的路径上，镜头一句一景飞过去',
    order: 8,
    tuning: [
      { key: 'distance', type: 'number', label: '镜头远近', min: 0.6, max: 1.6, step: 0.05, defaultValue: 1, format: 'multiplier' },
      { key: 'ripples', type: 'boolean', label: '水镜涟漪', defaultValue: true },
      { key: 'dust', type: 'boolean', label: '漂浮光尘', defaultValue: true },
      { key: 'serif', type: 'boolean', label: '衬线字体', defaultValue: true },
    ],
    quick: ['distance', 'ripples', 'dust'],
    preview: 'still',
    needs3d: true,
    darkStage: true,
    opaque: true,
    webgl: true,
  },
  {
    id: 'stage3d',
    label: '3D 舞台',
    hint: '封面粒子与立体歌词，多种文字风格',
    order: 9,
    tuning: [],
    quick: [],
    preview: 'still',
    needs3d: true,
    webgl: true,
  },
]

export function lyricStyleInfo(id: LyricStyleId): LyricStyleInfo {
  return LYRIC_STYLES.find(style => style.id === id) ?? LYRIC_STYLES[0]
}

/** 按声明读出完整参数：缺失或类型不符的字段回到默认值，数值夹在范围内。 */
export function resolveTuning(fields: readonly TuningField[], stored: unknown): Record<string, TuningValue> {
  const source = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, unknown> : {}
  const result: Record<string, TuningValue> = {}
  for (const field of fields) {
    const value = Object.hasOwn(source, field.key) ? source[field.key] : undefined
    if (field.type === 'number') {
      result[field.key] = typeof value === 'number' && Number.isFinite(value) ? Math.min(field.max, Math.max(field.min, value)) : field.defaultValue
    } else if (field.type === 'boolean') {
      result[field.key] = typeof value === 'boolean' ? value : field.defaultValue
    } else {
      result[field.key] = typeof value === 'string' && field.options.some(option => option.value === value) ? value : field.defaultValue
    }
  }
  return result
}

function validFor(field: TuningField, value: unknown): boolean {
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (field.type === 'boolean') return typeof value === 'boolean'
  return typeof value === 'string' && field.options.some(option => option.value === value)
}

/** 只保留声明过且类型合法的改动（数值夹在范围内），用于写入与读档；非法值直接丢弃而不是写成默认值。 */
export function sanitizeTuningPatch(fields: readonly TuningField[], patch: unknown): Record<string, TuningValue> {
  const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch as Record<string, unknown> : {}
  const valid = fields.filter(field => Object.hasOwn(source, field.key) && validFor(field, source[field.key]))
  return resolveTuning(valid, source)
}

export type LyricsView = 'lyrics' | LyricStyleId | 'mod'

/**
 * 歌词页实际显示的内容。3D 被设置关闭时回落到默认样式（不改写用户的选择），
 * 选中的实验模组覆盖内置样式。
 */
export function resolveLyricsView(input: { mode: 'lyrics' | 'dynamic'; style: LyricStyleId; lyrics3dEnabled: boolean; modActive?: boolean }): LyricsView {
  if (input.mode === 'lyrics') return 'lyrics'
  if (input.modActive) return 'mod'
  if (lyricStyleInfo(input.style).needs3d && !input.lyrics3dEnabled) return DEFAULT_LYRIC_STYLE
  return input.style
}
