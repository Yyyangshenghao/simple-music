import { useId, useLayoutEffect, useRef, useState } from 'react'
import { LayoutGroup } from 'motion/react'
import { useProviderStore } from '../../stores/providers'
import { providerAccountSession } from '../../lib/provider-account-session'
import type { ProviderId } from '../../providers/types'
import { ProviderRecommendationSection } from '../Explore/ProviderRecommendationSection'
import styles from './ExplorePagePreview.module.css'

const MIN_PAGE_WIDTH = 1280
const ignorePreview = () => {}

/** 复用实际探索内容；独立布局组隔离封面转场，预览只读且随面板卸载。 */
export function ExplorePagePreview({ source }: { source: ProviderId }) {
  const groupId = useId()
  const accountSession = useProviderStore(() => providerAccountSession(source))
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: MIN_PAGE_WIDTH, scale: 0, height: 0 })

  useLayoutEffect(() => {
    const frame = viewport.current
    const page = content.current
    if (!frame || !page) return
    const measure = () => {
      // 沿用窗口的响应式规则，并保留桌面画布宽度，避免窄窗口把多列推荐挤成竖排。
      const width = Math.max(MIN_PAGE_WIDTH, document.documentElement.clientWidth)
      const scale = frame.clientWidth / width
      const height = page.offsetHeight * scale
      setSize(current => current.width === width && current.scale === scale && current.height === height ? current : { width, scale, height })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    observer.observe(page)
    measure()
    return () => observer.disconnect()
  }, [])

  return <aside className={styles.preview} aria-label="探索页实时预览">
    <div className={styles.heading}><h4>探索页预览</h4><span>实时内容 · 只读</span></div>
    <div ref={viewport} className={styles.viewport} data-explore-preview>
      <div className={styles.spacer} style={{ height: size.height }}>
        <div ref={content} className={styles.page} aria-hidden="true" {...{ inert: '' }}
          style={{ width: size.width, transform: `scale(${size.scale})` }}>
          <LayoutGroup id={groupId}>
            <ProviderRecommendationSection key={`${source}:${accountSession}`} source={source} onPreview={ignorePreview} />
          </LayoutGroup>
        </div>
      </div>
    </div>
  </aside>
}
