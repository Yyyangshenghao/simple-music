import { useRef, useCallback, useEffect, type ReactNode } from 'react'
import './BorderGlow.css'

const GRADIENT_POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%']
const GRADIENT_KEYS = ['--gradient-one','--gradient-two','--gradient-three','--gradient-four','--gradient-five','--gradient-six','--gradient-seven']
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1]

function parseHSL(hslStr: string) {
  const m = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/)
  if (!m) return { h: 0, s: 0, l: 95 }
  return { h: parseFloat(m[1]), s: parseFloat(m[2]), l: parseFloat(m[3]) }
}

function buildGlowVars(glowColor: string, intensity: number): Record<string, string> {
  const { h, s, l } = parseHSL(glowColor)
  const base = `${h}deg ${s}% ${l}%`
  const opacities = [100, 60, 50, 40, 30, 20, 10]
  const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10']
  const vars: Record<string, string> = {}
  for (let i = 0; i < opacities.length; i++) {
    vars[`--glow-color${keys[i]}`] = `hsl(${base} / ${Math.min(opacities[i] * intensity, 100)}%)`
  }
  return vars
}

function buildGradientVars(colors: string[]): Record<string, string> {
  const vars: Record<string, string> = {}
  for (let i = 0; i < 7; i++) {
    const c = colors[Math.min(COLOR_MAP[i], colors.length - 1)]
    vars[GRADIENT_KEYS[i]] = `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`
  }
  vars['--gradient-base'] = `linear-gradient(${colors[0]} 0 100%)`
  return vars
}

interface BorderGlowProps {
  children: ReactNode
  className?: string
  glowColor?: string
  backgroundColor?: string
  borderRadius?: number
  glowRadius?: number
  glowIntensity?: number
  coneSpread?: number
  edgeSensitivity?: number
  colors?: string[]
  fillOpacity?: number
}

export function BorderGlow({
  children,
  className = '',
  glowColor = '0 0 95',
  backgroundColor = 'rgba(255,255,255,0.05)',
  borderRadius = 16,
  glowRadius = 40,
  glowIntensity = 0.7,
  coneSpread = 30,
  edgeSensitivity = 35,
  colors = ['#ffffff', '#cccccc', '#888888'],
  fillOpacity = 0.35,
}: BorderGlowProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const activeRef = useRef(false)

  const getCenter = useCallback((el: HTMLDivElement) => {
    const { width, height } = el.getBoundingClientRect()
    return [width / 2, height / 2]
  }, [])

  const getEdgeProximity = useCallback((el: HTMLDivElement, x: number, y: number) => {
    const [cx, cy] = getCenter(el)
    const dx = x - cx, dy = y - cy
    let kx = Infinity, ky = Infinity
    if (dx !== 0) kx = cx / Math.abs(dx)
    if (dy !== 0) ky = cy / Math.abs(dy)
    return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1)
  }, [getCenter])

  const getCursorAngle = useCallback((el: HTMLDivElement, x: number, y: number) => {
    const [cx, cy] = getCenter(el)
    const dx = x - cx, dy = y - cy
    if (dx === 0 && dy === 0) return 0
    let deg = Math.atan2(dy, dx) * (180 / Math.PI) + 90
    if (deg < 0) deg += 360
    return deg
  }, [getCenter])

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!activeRef.current) return
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const card = cardRef.current
      if (!card) return
      const rect = card.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      card.style.setProperty('--edge-proximity', `${(getEdgeProximity(card, x, y) * 100).toFixed(3)}`)
      card.style.setProperty('--cursor-angle', `${getCursorAngle(card, x, y).toFixed(3)}deg`)
    })
  }, [getEdgeProximity, getCursorAngle])

  useEffect(() => {
    const card = cardRef.current
    if (!card) return

    observerRef.current = new IntersectionObserver(([entry]) => {
      activeRef.current = entry.isIntersecting
    }, { threshold: 0 })
    observerRef.current.observe(card)

    card.addEventListener('pointermove', handlePointerMove)
    return () => {
      card.removeEventListener('pointermove', handlePointerMove)
      observerRef.current?.disconnect()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [handlePointerMove])

  const glowVars = buildGlowVars(glowColor, glowIntensity)
  const gradVars = buildGradientVars(colors)

  return (
    <div
      ref={cardRef}
      className={`border-glow-card ${className}`}
      style={{
        '--card-bg': backgroundColor,
        '--edge-sensitivity': edgeSensitivity,
        '--border-radius': `${borderRadius}px`,
        '--glow-padding': `${glowRadius}px`,
        '--cone-spread': coneSpread,
        '--fill-opacity': fillOpacity,
        ...glowVars,
        ...gradVars,
      } as React.CSSProperties}
    >
      <span className="edge-light" />
      <div className="border-glow-inner">
        {children}
      </div>
    </div>
  )
}
