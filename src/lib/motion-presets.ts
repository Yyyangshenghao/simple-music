import type { Transition, Variants } from 'motion/react'

/** 快速回弹弹簧：按钮按压、小控件。 */
export const springSnappy: Transition = { type: 'spring', stiffness: 480, damping: 30, mass: 0.7 }

/** springGentle 的原始参数（供 useSpring 等需要 SpringOptions 的 API 使用）。 */
export const gentleSpringValues = { stiffness: 220, damping: 26, mass: 1 }

/** 柔和弹簧：卡片上浮、面板入场。 */
export const springGentle: Transition = { type: 'spring', ...gentleSpringValues }

/** 按压反馈（配 whileTap）。 */
export const tapScale = { scale: 0.94 }

/** 图标切换快速淡入淡出（AnimatePresence 内的小图标 crossfade，如播放/暂停、音量档位）。 */
export const iconSwap: Transition = { duration: 0.1, ease: 'easeOut' }

/** 入场：淡入上移（配 initial="hidden" animate="visible"）。 */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0 }
}
