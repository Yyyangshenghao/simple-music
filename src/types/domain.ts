// 领域类型。Track/Playlist 对齐 server 返回（netease-client.ts 的 mapSongRecord/mapDiscoverPlaylist），
// FxParams/FxSnapshot 对齐 public/default-user-fx-archive.json 以保证存档互通。

export const ONLINE_MUSIC_SOURCES = ['netease', 'qq', 'apple'] as const
export type OnlineMusicSource = (typeof ONLINE_MUSIC_SOURCES)[number]
export type MusicSource = OnlineMusicSource | 'local'
// max = 不锁档位,服务端按每首歌实际可得的最高档(母带/Hi-Res/无损…)逐级回退;
// jymaster/sky/jyeffect/hires 为网易专属档,aac 为 QQ 专属兜底档,经音质弹层按单曲真实可得档选中
export type AudioQuality =
  | 'standard'
  | 'higher'
  | 'exhigh'
  | 'lossless'
  | 'hires'
  | 'jyeffect'
  | 'sky'
  | 'jymaster'
  | 'aac'
  | 'max'

export interface Artist {
  id: unknown
  name: string
}

export interface ArtistInfo {
  id: unknown
  mid?: string
  name: string
  avatar: string
  /** 歌手主页封面，与头像分开用于页面背景。 */
  cover?: string
  description?: string
  musicSize?: number
  songNum?: number
  source: MusicSource
}

export interface Track {
  provider: MusicSource
  source: MusicSource
  type: string
  id: unknown
  name: string
  artist: string
  artists: Artist[]
  artistId?: unknown
  album?: string
  cover?: string
  duration?: number
  fee?: unknown
  /** 本地音乐文件修改时间(毫秒),由 local-library 透传,供本地列表「添加时间」排序。在线音源无此字段。 */
  mtimeMs?: number
  /** 解析出的可播放 URL（懒加载）。 */
  url?: string
  /** 懒加载占位曲目:仅有 id,详情播到/滚到时再补。 */
  pending?: boolean
  /** false 表示音源目录仍收录，但当前账号/地区明确不可播放。 */
  playable?: boolean
  quality?: AudioQuality
  /** 不同来源透传的额外字段（mid/songmid 等）。 */
  [key: string]: unknown
}

export interface Playlist {
  provider: MusicSource
  source: MusicSource
  type: string
  id: unknown
  name: string
  cover: string
  trackCount: number
  /** 歌单列表未返回数量且尚未读取曲目关系时，避免把未知显示成 0。 */
  trackCountKnown?: boolean
  playCount: number
  creator: string
  /** 账号歌单列表中区分收藏（他人创建）与自建；缺省视为自建。 */
  subscribed?: boolean
  /** 仅自己可见；只有平台账号歌单列表能确认时才有值。 */
  private?: boolean
  /** 平台特殊歌单类型（网易「我喜欢的音乐」等非 0）；仅账号歌单列表返回。 */
  specialType?: number
  tag?: string
  description?: string
  tracks?: Track[]
}

export interface LyricLine {
  time: number
  text: string
}

export interface LyricLayout {
  scale: number
  offsetX: number
  offsetY: number
  offsetZ: number
  tiltX: number
  tiltY: number
  cameraLock: boolean
}

export type PresetId = number

/** 视觉 FX 参数快照——字段与 default-user-fx-archive.json 的 snapshot 完全对应。 */
export interface FxSnapshot {
  visualPresetSchema: string
  preset: number
  intensity: number
  cinemaShake: number
  depth: number
  coverResolution: number
  point: number
  speed: number
  twist: number
  color: number
  scatter: number
  bgFade: number
  bloomStrength: number
  lyricGlowStrength: number
  lyricScale: number
  lyricOffsetX: number
  lyricOffsetY: number
  lyricOffsetZ: number
  lyricTiltX: number
  lyricTiltY: number
  lyricCameraLock: boolean
  lyricColorMode: string
  lyricColor: string
  lyricHighlightMode: string
  lyricHighlightColor: string
  lyricGlowLinked: boolean
  lyricGlowColor: string
  lyricFont: string
  lyricLetterSpacing: number
  lyricLineHeight: number
  lyricWeight: number
  visualTintMode: string
  visualTintColor: string
  uiAccentColor: string
  homeAccentColor: string
  homeIconColor: string
  visualIconColor: string
  backgroundColorMode: string
  backgroundColor: string
  backgroundOpacity: number
  controlGlassChromaticOffset: number
  backgroundColorCustom: boolean
  floatLayer: boolean
  cinema: boolean
  edge: boolean
  aiDepth: boolean
  bloom: boolean
  lyricGlow: boolean
  lyricGlowBeat: boolean
  lyricGlowParticles: boolean
  desktopLyrics: boolean
  desktopLyricsSize: number
  desktopLyricsFontFamily: string
  desktopLyricsFontFamilyCjk: string
  desktopLyricsColor: string
  desktopLyricsOpacity: number
  desktopLyricsBackgroundOpacity: number
  desktopLyricsBackgroundStyle: 'dark' | 'frosted'
  desktopLyricsAutoWidth: boolean
  desktopLyricsLineMode: 'single' | 'double'
  desktopLyricsWordByWord: boolean
  desktopLyricsY: number
  desktopLyricsClickThrough: boolean
  desktopLyricsCinema: boolean
  desktopLyricsHighlight: boolean
  desktopLyricsShowTranslation: boolean
  desktopLyricsShowRoma: boolean
  desktopLyricsFps: number
  performanceBackground: string
  performanceQuality: string
  liveBackgroundKeep: boolean
  particleLyrics: boolean
  backCover: boolean
  shelf: string
  shelfCameraMode: string
  shelfPresence: string
  shelfShowPodcasts: boolean
  shelfMergeCollections: boolean
  shelfSize: number
  shelfOffsetX: number
  shelfOffsetY: number
  shelfOffsetZ: number
  shelfAngleY: number
  shelfAngleYManual: boolean
  shelfOpacity: number
  shelfBgOpacity: number
  shelfAccentColor: string
  cam: string
}

/** 运行期可调的 FX 参数，等价于快照（store 内部以此为 state）。 */
export type FxParams = FxSnapshot

/** 导出存档信封——与原项目格式完全兼容。 */
export interface FxArchive {
  type: string
  schema: number
  exportedAt: number
  name: string
  savedAt: number
  snapshot: FxSnapshot
}

export type PerformanceMode = 'eco' | 'balanced' | 'high' | 'ultra'
export type BackgroundMode = 'auto' | 'keep' | 'release'

/** 主窗口背景类型：流体（封面或自定义三色）、自定义图片、视频（含 Wallpaper Engine 视频工程）、静态纯色/渐变。 */
export type AppBackgroundKind = 'fluid' | 'image' | 'video' | 'solid'

/** 主进程复制进 userData/backgrounds 的背景文件，与 server/lib/custom-background.ts 保持一致。 */
export interface CustomBackgroundMedia {
  id: string
  kind: 'image' | 'video'
  name: string
}

/** 独立视觉选项：每个开关只管自己的效果，互不压制；动效预设只批量设置取值。 */
export interface PerformanceFlags {
  /** 页面切换、菜单弹出、列表滚动入场与封面飞行等转场；关闭后直接切换。 */
  pageTransitionMotion: boolean
  /** 控件手感七项，各自独立；设置页「控件动效」只是一次性批量开关。 */
  /** 按钮与卡片按下时的缩小回弹。 */
  tapFeedbackMotion: boolean
  /** 卡片悬停上浮、播放栏封面放大、播放控件图标位移。 */
  hoverLiftMotion: boolean
  /** 开关拉伸回弹、分段选择果冻、主题图标、勾选框与平台切换面板。 */
  toggleMotion: boolean
  /** 顶栏、我的库标签与设置目录的滑动指示条。 */
  indicatorMotion: boolean
  /** 进度、音量等滑杆的拉伸、倾斜与数值气泡。 */
  sliderMotion: boolean
  /** 队列拖动倾斜与碎纸、探索卡片堆甩动、歌词来源排序。 */
  dragMotion: boolean
  /** 红心爆开、播放模式图标变形、返回按钮、均衡器跳动、提示气泡弹出、搜索框展开。 */
  iconMotion: boolean
  /** 歌词跟随、页内跳转等平滑滚动；关闭后直接跳到目标位置。 */
  smoothScrollMotion: boolean
  /** 歌词换句淡入淡出与歌词样式切换过渡；关闭后直接换句。 */
  lyricsLineMotion: boolean
  /** 简介、帮助说明的逐字显现；关闭后直接渲染完整文本。 */
  textRevealMotion: boolean
  /** DOM 歌词逐字高亮；关闭后按整行点亮，不创建逐字动画。 */
  lyricsWordMotion: boolean
  /** 氛围背景 LiquidEther 自动流动,关闭后退化为静态渐变。 */
  bgFluidMotion: boolean
  /** 流体背景跟随鼠标/触摸；关闭后仍自动流动。 */
  bgPointerMotion: boolean
  /** 卡片跟随鼠标的 3D 倾斜(TiltCard)。 */
  cardTiltEffect: boolean
  /** 卡片内跟随鼠标的光斑，与倾斜独立。 */
  cardSpotlightEffect: boolean
  /** 标题流光渐变呼吸动画。 */
  gradientTextMotion: boolean
  /** 播放栏底部随低频能量呼吸的氛围辉光。辉光垫在毛玻璃面板后方,
   *  每次能量变化都会迫使面板 backdrop-filter 重新取样,是播放期间的持续 GPU 负载。 */
  audioGlowEffect: boolean
  /** 减少透明度 / 降低视觉特效:开启后关闭背景流体(退化 CSS 霞光),并把所有玻璃层去模糊、
   *  底色提到近乎不透明,消除 backdrop-filter 随全屏动态背景逐帧重取样的 GPU 大头开销。 */
  reduceTransparency: boolean
}
/** 歌词面板 3D 模式下的背景场景；频谱环与音箱沙粒已移除，旧存档读取时迁回封面粒子云。 */
export type Lyrics3dEffect = 'cover-cloud'
/** 歌词页展示模式：纯歌词列表、3D 舞台、跃字（逐词跳出的大字单句）。 */
/** 歌词页：逐行歌词，或「动态」——具体样式由 stores/lyric-styles 决定。 */
export type LyricsPanelMode = 'lyrics' | 'dynamic'
/** Mineradio 舞台歌词的运动风格；storyboard 是每句一个镜头的分镜演出。 */
export type Lyrics3dStyle = 'storyboard' | 'glass' | 'smooth' | 'float' | 'quick' | 'shine' | 'glitch'
/** Mineradio 舞台歌词的同屏行数模式。 */
export type Lyrics3dDisplayMode = 'single' | 'dual' | 'triple' | 'cinema'
export type ShelfMode = 'dynamic' | 'static'

/** 普通歌词舞台的自由排版参数。位置单位为视口百分比，便于不同窗口尺寸下保持观感。 */
export interface LyricsLayoutParams {
  coverScale: number
  coverX: number
  coverY: number
  lyricsWidth: number
  lyricsX: number
  lyricsY: number
}

/** 3D 歌词模式的可调参数,由设置页「3D 歌词」标签页调节并持久化。 */
export interface Lyrics3dParams {
  /** 同屏显示 1/2/3/5 行歌词。 */
  displayMode: Lyrics3dDisplayMode
  /** 非当前行的基础不透明度。 */
  contextOpacity: number
  /** 上下文行间距倍率。 */
  contextSpread: number
  /** 边缘行渐隐强度。 */
  edgeFade: number
  /** 切行转场的柔和度。 */
  motionSoftness: number
  /** 粒子数量倍率(0.25~2,乘在各效果按性能档取的基础数量上) */
  particleCount: number
  /** 粒子大小倍率(0.5~2) */
  particleSize: number
  /** 粒子亮度倍率(0.3~2) */
  particleBrightness: number
  /** 辉光强度倍率(0~2,封面粒子云的泛光层) */
  glowStrength: number
  /** 动效强度倍率(0.2~2,弹跳/踢飞/频谱振幅) */
  motionIntensity: number
  /** 鼓点荡漾幅度(0 关闭，0~1，默认 0.5) */
  rippleAmplitude: number
  /** 波纹触发灵敏度(0~1,越高鼓点越容易触发涟漪) */
  rippleSensitivity: number
  /** 单道波纹扩散时长(秒,0.2~1.5) */
  rippleDuration: number
  /** 帧率上限(0=不限制,否则至少 30 fps) */
  fpsCap: number
  /** 渲染分辨率倍率(0.75~2,即 Canvas dpr) */
  renderScale: number
}
/** 播放模式：列表循环 / 随机 / 单曲循环。 */
export type PlayMode = 'order' | 'shuffle' | 'one'

/** 逐字歌词中的单个字/词 token。startMs 是相对于该行起始时间的毫秒偏移。 */
export interface WordToken {
  text: string
  startMs: number
  durationMs?: number   // 该字的精确时长（来自 YRC；估算数据无此字段）
}

/** 含逐字时序的歌词行（来自 YRC 解析或均分估算）。 */
export interface WordLyricLine {
  time: number           // 行起始时间（秒），与 LyricLine.time 对齐
  durationMs: number     // 行持续时长（毫秒）
  words: WordToken[]
  translationText?: string
}

export interface Banner {
  id: string | number
  title: string
  subtitle?: string
  cover: string
  track?: Track
  playlist?: Playlist
}
