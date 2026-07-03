import type { Transition, Variants } from 'motion/react'

/** 快速回弹弹簧：按钮按压、小控件。 */
export const springSnappy: Transition = { type: 'spring', stiffness: 480, damping: 30, mass: 0.7 }

/** 柔和弹簧：卡片上浮、面板入场。 */
export const springGentle: Transition = { type: 'spring', stiffness: 220, damping: 26, mass: 1 }

/** 按压反馈（配 whileTap）。 */
export const tapScale = { scale: 0.94 }

/** 入场：淡入上移（配 initial="hidden" animate="visible"）。 */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0 }
}
