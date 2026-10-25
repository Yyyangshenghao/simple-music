import { useCallback } from 'react'
import { useSettingsStore } from '../stores/settings'
import type { PerformanceFlags } from '../types/domain'

export type MotionFlag = 'pageTransitionMotion' | 'controlMotion' | 'smoothScrollMotion' | 'lyricsLineMotion'

const INSTANT = { duration: 0 } as const

/** 读取单项动效开关；每项只管自己的范围，不受其它开关或系统偏好压制。 */
export function useMotion(flag: MotionFlag & keyof PerformanceFlags): boolean {
  return useSettingsStore((s) => s.performance[flag])
}

/** 入场、退场、弹层与共享元素过渡：页面转场关闭时换成即时过渡。 */
export function usePageTransition(): <T>(transition: T) => T | typeof INSTANT {
  const enabled = useMotion('pageTransitionMotion')
  return useCallback(<T,>(transition: T) => enabled ? transition : INSTANT, [enabled])
}

/** 按压、悬停等控件反馈：控件动效关闭时不传动画目标。 */
export function useControlFeedback(): <T>(target: T) => T | undefined {
  const enabled = useMotion('controlMotion')
  return useCallback(<T,>(target: T) => enabled ? target : undefined, [enabled])
}
