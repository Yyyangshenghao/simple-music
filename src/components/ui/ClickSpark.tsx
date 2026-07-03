import { useEffect, useRef } from 'react'

interface Spark {
  x: number
  y: number
  angle: number
  start: number
}

const SPARK_COUNT = 8
const DURATION = 400
const SPARK_RADIUS = 18
const SPARK_SIZE = 8

/** 全局点击火花：单个全屏 canvas 覆盖层，颜色取 --ambient-1，reduced-motion 时禁用。 */
export function ClickSpark() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const sparks: Spark[] = []
    let raf = 0
    let running = false

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const easeOut = (t: number) => t * (2 - t)

    const draw = (now: number) => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      const color =
        getComputedStyle(document.documentElement).getPropertyValue('--ambient-1').trim() || '#5227ff'
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        const t = (now - s.start) / DURATION
        if (t >= 1) {
          sparks.splice(i, 1)
          continue
        }
        const eased = easeOut(t)
        const dist = eased * SPARK_RADIUS
        const len = SPARK_SIZE * (1 - eased)
        const x1 = s.x + dist * Math.cos(s.angle)
        const y1 = s.y + dist * Math.sin(s.angle)
        ctx.strokeStyle = color
        ctx.globalAlpha = 1 - eased
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x1 + len * Math.cos(s.angle), y1 + len * Math.sin(s.angle))
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      if (sparks.length > 0) {
        raf = requestAnimationFrame(draw)
      } else {
        running = false
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      }
    }

    const onClick = (e: MouseEvent) => {
      const now = performance.now()
      for (let i = 0; i < SPARK_COUNT; i++) {
        sparks.push({ x: e.clientX, y: e.clientY, angle: (Math.PI * 2 * i) / SPARK_COUNT, start: now })
      }
      // 无火花时才起新 raf 循环，火花耗尽自动停，空闲零开销
      if (!running) {
        running = true
        raf = requestAnimationFrame(draw)
      }
    }
    window.addEventListener('click', onClick)

    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 }}
    />
  )
}
