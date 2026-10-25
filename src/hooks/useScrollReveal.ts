import { useEffect, useRef } from 'react'
import { useMotion } from './useMotion'

export function useScrollReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const reducedMotion = !useMotion('pageTransitionMotion')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reducedMotion) {
      el.style.opacity = '1'
      el.style.transform = 'none'
      el.style.transition = 'none'
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.style.opacity = '1'
          el.style.transform = 'translateY(0)'
          observer.disconnect()
        }
      },
      { threshold: 0.1 }
    )
    el.style.opacity = '0'
    el.style.transform = 'translateY(20px)'
    el.style.transition = 'opacity 320ms var(--sm-ease-out), transform 320ms var(--sm-ease-out)'
    observer.observe(el)
    return () => observer.disconnect()
  }, [reducedMotion])

  return ref
}
