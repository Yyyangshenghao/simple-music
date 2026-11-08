import { memo } from 'react'
import { motion } from 'motion/react'
import { useSettingsStore } from '../../stores/settings'
import { useNavigationStore } from '../../stores/navigation'
import { providerFor } from '../../providers/registry'
import type { ProviderId } from '../../providers/types'
import type { Playlist } from '../../types/domain'
import { SourceBadge } from '../ui/SourceBadge'
import { RecommendationStage } from './RecommendationStage'
import { ToplistSection } from './ToplistSection'
import { RecentRail } from './RecentRail'
import { ProviderPlaylistRail } from './ProviderPlaylistRail'
import { AppleHomeLibrary } from './AppleHomeLibrary'
import { ApplePlaylistRecommendations } from './ApplePlaylistRecommendations'
import { PersonalListeningSection } from './PersonalListeningSection'
import { FeaturedSongs } from './FeaturedSongs'
import { QishuiThemePlaylists } from './QishuiThemePlaylists'
import styles from './ProviderRecommendationSection.module.css'

interface ProviderRecommendationSectionProps {
  source: ProviderId
  onPreview(playlist: Playlist): void
}

export const ProviderRecommendationSection = memo(function ProviderRecommendationSection({ source, onPreview }: ProviderRecommendationSectionProps) {
  const layout = useSettingsStore(state => state.exploreLayouts[source])
  const enabled = layout.filter(module => module.enabled)
  return <motion.section className={`${styles.section} ${source === 'apple' ? styles.appleSection : ''}`}
    initial={false} animate={{ opacity: 1, y: 0 }} aria-label={`${providerFor(source).descriptor.label}推荐`}>
    <header className={styles.header}>
      <SourceBadge source={source} displayMode="always" />
      {(source === 'netease' || source === 'qq' || source === 'kugou') && <button type="button" className={`${styles.browseMore} no-drag`}
        onClick={() => useNavigationStore.getState().navigateTo({ type: 'provider-playlists', source })}>浏览全部歌单</button>}
      {source === 'apple' && <button type="button" className={`${styles.browseMore} no-drag`}
        onClick={() => useNavigationStore.getState().navigateTo({ type: 'toplist', source: 'apple', chartType: 'songs' })}>歌曲与专辑榜</button>}
    </header>
    {enabled.map(module => {
      switch (module.id) {
        case 'recommendations': return <RecommendationStage key={module.id} source={source} onPreview={onPreview} />
        case 'featured': return <FeaturedSongs key={module.id} />
        case 'listening': return source === 'netease' || source === 'qishui' ? <PersonalListeningSection key={module.id} source={source} section="listening" /> : null
        case 'theme-playlists': return <QishuiThemePlaylists key={module.id} onOpen={onPreview} />
        case 'saved': return <PersonalListeningSection key={module.id} source="qishui" section="saved" />
        case 'apple-recommendations': return <ApplePlaylistRecommendations key={module.id} charts={[]} onOpen={onPreview} />
        case 'apple-library': return <AppleHomeLibrary key={module.id} onOpen={onPreview} />
        case 'playlists': return <ProviderPlaylistRail key={module.id} source={source} onOpen={onPreview} />
        case 'recent': return <RecentRail key={module.id} source={source} embedded onOpen={onPreview} />
        case 'toplists': return <ToplistSection key={module.id} source={source} embedded onOpen={onPreview} />
      }
    })}
    {enabled.length === 0 && <p className={styles.empty}>探索页模块已全部关闭，可在设置的「音源与播放」中重新开启。</p>}
  </motion.section>
})
