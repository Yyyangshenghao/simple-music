import type { Transition, Variants } from 'motion/react'

/** 快速回弹弹簧：按钮按压、小控件。 */
export const springSnappy: Transition = { type: 'spring', stiffness: 480, damping: 30, mass: 0.7 }

/** springGentle 的原始参数（供 useSpring 等需要 SpringOptions 的 API 使用）。 */
export const gentleSpringValues = { stiffness: 220, damping: 26, mass: 1 }

/** 柔和弹簧：卡片上浮、面板入场。 */
export const springGentle: Transition = { type: 'spring', ...gentleSpringValues }

/** Q 弹弹簧：低阻尼、带明显过冲回弹,用于「从无到有蹦出来」的诞生类动画(如画布相似歌手节点弹出)。 */
export const springBouncy: Transition = { type: 'spring', stiffness: 420, damping: 15, mass: 0.9 }

/** 按压反馈（配 whileTap）。 */
export const tapScale = { scale: 0.94 }

/** 页面往返短转场，避免缩放与栏目入场叠加。 */
export const pageTransition: Transition = { duration: 0.18, ease: 'easeOut' }

/** 图标切换快速淡入淡出（AnimatePresence 内的小图标 crossfade，如播放/暂停、音量档位）。 */
export const iconSwap: Transition = { duration: 0.1, ease: 'easeOut' }

/** 桌面双行歌词顺序换句：整行向上滚动，使用浏览器原生动画。 */
export const desktopLyricsScrollTiming: KeyframeAnimationOptions = { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }

/** 横排松手停靠：有限惯性后平顺减速，避免弹回。 */
export const railSettleTiming = { duration: 320, ease: (progress: number) => 1 - Math.pow(1 - progress, 4) }

/** 入场：淡入上移（配 initial="hidden" animate="visible"）。 */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0 }
}

/** 专辑封面连续移动并放大，使用高阻尼避免落位后弹跳。 */
export const albumCoverTransition: Transition = { type: 'spring', stiffness: 170, damping: 28, mass: 1 }

/** 返回列表时封面快速收回，避免弹簧收尾拖慢返回反馈。 */
export const coverReturnTransition: Transition = { type: 'tween', duration: 0.24, ease: [0.22, 1, 0.36, 1] }

/** 流体玻璃分段指示器：低阻尼带少量过冲，落位时像液滴撞停后回弹。 */
export const liquidPillSpring = { stiffness: 380, damping: 22, mass: 0.8 }

/** 流体玻璃指示器浮起成透镜 / 落回的弹簧。 */
export const liquidLiftSpring = { stiffness: 520, damping: 30, mass: 0.6 }

/** 红心点亮心跳：先收缩成小点、再过冲回弹（参考 React Bits PulseHeart）；times 中段即收缩最低点。 */
export const heartBeatTransition = { duration: 0.56, times: [0, 0.4, 1], ease: ['easeOut', 'backOut'] } satisfies Transition

/** 心跳收缩到最低点时的缩放；填充在此刻切换，粒子由此迸出。 */
export const heartBeatMinScale = 0.3

/** 红心粒子迸散：从心跳最低点起外扩并淡出。 */
export const heartBurstTransition: Transition = {
  duration: 0.42,
  delay: heartBeatTransition.duration * heartBeatTransition.times[1],
  ease: 'easeOut'
}

/** 尾迹滑块（参考 React Bits WakeSlider）：填充头追随数值的临界阻尼弹簧，约 0.3s 落位。 */
export const wakeHeadSpring = { stiffness: 946, damping: 61.5, mass: 1 }

/** 尾迹滑块：对填充头速度再做一次平滑，波峰随拖动快慢起落而不抖。 */
export const wakeSpeedSpring = { stiffness: 400, damping: 50, mass: 1 }

/** 队列拖动排序（参考 React Bits Shredder）：浮起卡片向指针指数逼近的速率（1/秒），越大越跟手。 */
export const queueDragFollow = 30

/** 队列拖动：浮起时放大倍率与最大倾斜角（度），倾斜随横向速度变化。 */
export const queueDragLift = { scale: 1.03, maxTilt: 6 }

/** 队列碎纸：纸条依次落下并淡出，相邻纸条错开 stagger 秒。 */
export const queueShredStrip = { duration: 0.62, stagger: 0.035, ease: [0.4, 0, 1, 1] } as const

/** 悬停提示首次出现（参考 React Bits WarmTooltip）：由略小、略糊上浮弹出。 */
export const tooltipPop = { duration: 0.16, ease: [0.23, 1, 0.32, 1], scale: 0.94, blur: 4, rise: 4 } as const

/** 悬停提示已出现时移到相邻按钮：气泡滑过去并伸缩宽度，文字按移动方向错位淡换。 */
export const tooltipGlide: Transition = { type: 'spring', duration: 0.32, bounce: 0.1 }
export const tooltipSwap: Transition = { duration: 0.14, ease: [0.23, 1, 0.32, 1] }
