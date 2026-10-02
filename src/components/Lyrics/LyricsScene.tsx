import { Canvas } from '@react-three/fiber'
import { useSettingsStore } from '../../stores/settings'
import type { Lyrics3dEffect } from '../../types/domain'
import { CoverParticleCloud } from '../Visualizer/CoverParticleCloud'
import { Waveform3D } from '../Visualizer/Waveform3D'
import { SpeakerParticles } from '../Visualizer/SpeakerParticles'
import { CinemaCamera } from '../Visualizer/CinemaCamera'
import { FrameLimiter } from '../Visualizer/FrameLimiter'
import { StageLyrics3D } from './StageLyrics3D'

const EFFECT_COMPONENTS: Record<Lyrics3dEffect, React.FC<{ coverUrl?: string }>> = {
  'cover-cloud': CoverParticleCloud,
  'waveform-3d': Waveform3D,
  'speaker-particles': SpeakerParticles
}

/** 仅进入 3D 模式时加载 Three.js、歌词舞台与效果场景。 */
export default function LyricsScene({ coverUrl }: { coverUrl?: string }) {
  const effect = useSettingsStore((s) => s.lyrics3dEffect)
  const style = useSettingsStore((s) => s.lyrics3dStyle)
  const fpsCap = useSettingsStore((s) => s.lyrics3d.fpsCap)
  const renderScale = useSettingsStore((s) => s.lyrics3d.renderScale)
  const EffectComponent = EFFECT_COMPONENTS[effect]

  return (
    <Canvas
      camera={{ position: [0, 0, 14], fov: 60 }}
      dpr={renderScale}
      frameloop={fpsCap > 0 ? 'never' : 'always'}
      gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
    >
      <FrameLimiter fps={fpsCap} />
      <CinemaCamera />
      <EffectComponent coverUrl={coverUrl} />
      {style !== 'focus' && <StageLyrics3D />}
    </Canvas>
  )
}
