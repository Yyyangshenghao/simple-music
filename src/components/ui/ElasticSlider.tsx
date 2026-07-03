import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import styles from './ElasticSlider.module.css'

const MAX_OVERFLOW = 50

interface ElasticSliderProps {
  defaultValue?: number
  startingValue?: number
  maxValue?: number
  className?: string
  isStepped?: boolean
  stepSize?: number
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  onChange?: (value: number) => void
}

export function ElasticSlider({
  defaultValue = 50,
  startingValue = 0,
  maxValue = 100,
  className = '',
  isStepped = false,
  stepSize = 1,
  leftIcon,
  rightIcon,
  onChange
}: ElasticSliderProps) {
  return (
    <div className={`${styles.container} ${className}`}>
      <Slider
        defaultValue={defaultValue}
        startingValue={startingValue}
        maxValue={maxValue}
        isStepped={isStepped}
        stepSize={stepSize}
        leftIcon={leftIcon}
        rightIcon={rightIcon}
        onChange={onChange}
      />
    </div>
  )
}

function Slider({
  defaultValue = 50,
  startingValue = 0,
  maxValue = 100,
  isStepped = false,
  stepSize = 1,
  leftIcon,
  rightIcon,
  onChange
}: ElasticSliderProps) {
  const [value, setValue] = useState(defaultValue)
  const sliderRef = useRef<HTMLDivElement>(null)
  const [region, setRegion] = useState('middle')
  const clientX = useMotionValue(0)
  const overflow = useMotionValue(0)
  const scale = useMotionValue(1)

  useEffect(() => {
    setValue(defaultValue)
  }, [defaultValue])

  useMotionValueEvent(clientX, 'change', (latest) => {
    if (sliderRef.current) {
      const { left, right } = sliderRef.current.getBoundingClientRect()
      let newValue: number

      if (latest < left) {
        setRegion('left')
        newValue = left - latest
      } else if (latest > right) {
        setRegion('right')
        newValue = latest - right
      } else {
        setRegion('middle')
        newValue = 0
      }

      overflow.jump(decay(newValue, MAX_OVERFLOW))
    }
  })

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.buttons > 0 && sliderRef.current) {
      const { left, width } = sliderRef.current.getBoundingClientRect()
      let newValue = startingValue + ((e.clientX - left) / width) * (maxValue - startingValue)

      if (isStepped) {
        newValue = Math.round(newValue / stepSize) * stepSize
      }

      newValue = Math.min(Math.max(newValue, startingValue), maxValue)
      setValue(newValue)
      onChange?.(newValue)
      clientX.jump(e.clientX)
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    handlePointerMove(e)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerUp = () => {
    animate(overflow, 0, { type: 'spring', bounce: 0.5 })
  }

  const getRangePercentage = () => {
    const totalRange = maxValue - startingValue
    if (totalRange === 0) return 0
    return ((value - startingValue) / totalRange) * 100
  }

  const defaultLeftIcon = (
    <span className={styles.icon}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9z" />
      </svg>
    </span>
  )

  const defaultRightIcon = (
    <span className={styles.icon}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9zM16 8.5a4 4 0 0 1 0 7v-7zM19 6a9 9 0 0 1 0 12v-2a7 7 0 0 0 0-8z" />
      </svg>
    </span>
  )

  return (
    <>
      <motion.div
        onHoverStart={() => animate(scale, 1.2)}
        onHoverEnd={() => animate(scale, 1)}
        onTouchStart={() => animate(scale, 1.2)}
        onTouchEnd={() => animate(scale, 1)}
        style={{
          scale,
          opacity: useTransform(scale, [1, 1.2], [0.7, 1])
        }}
        className={styles.wrapper}
      >
        <motion.div
          animate={{
            scale: region === 'left' ? [1, 1.4, 1] : 1,
            transition: { duration: 0.25 }
          }}
          style={{
            x: useTransform(() => (region === 'left' ? -overflow.get() / scale.get() : 0))
          }}
        >
          {leftIcon ?? defaultLeftIcon}
        </motion.div>

        <div
          ref={sliderRef}
          className={`${styles.root} no-drag`}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
        >
          <motion.div
            style={{
              scaleX: useTransform(() => {
                if (sliderRef.current) {
                  const { width } = sliderRef.current.getBoundingClientRect()
                  return 1 + overflow.get() / width
                }
                return 1
              }),
              scaleY: useTransform(overflow, [0, MAX_OVERFLOW], [1, 0.8]),
              transformOrigin: useTransform(() => {
                if (sliderRef.current) {
                  const { left, width } = sliderRef.current.getBoundingClientRect()
                  return clientX.get() < left + width / 2 ? 'right' : 'left'
                }
                return 'right'
              }),
              height: useTransform(scale, [1, 1.2], [4, 8]),
              marginTop: useTransform(scale, [1, 1.2], [0, -2]),
              marginBottom: useTransform(scale, [1, 1.2], [0, -2])
            }}
            className={styles.trackWrapper}
          >
            <div className={styles.track}>
              <div className={styles.range} style={{ width: `${getRangePercentage()}%` }} />
            </div>
          </motion.div>
        </div>

        <motion.div
          animate={{
            scale: region === 'right' ? [1, 1.4, 1] : 1,
            transition: { duration: 0.25 }
          }}
          style={{
            x: useTransform(() => (region === 'right' ? overflow.get() / scale.get() : 0))
          }}
        >
          {rightIcon ?? defaultRightIcon}
        </motion.div>
      </motion.div>
    </>
  )
}

function decay(value: number, max: number) {
  if (max === 0) return 0
  const entry = value / max
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5)
  return sigmoid * max
}
