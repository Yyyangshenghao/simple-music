import { useContentProvider } from '../../hooks/useContentProvider'
import { useNavigationStore } from '../../stores/navigation'
import { ProviderSwitchDock } from '../Explore/ProviderSwitchDock'

export function GlobalContentProviderDock() {
  const view = useNavigationStore((state) => state.currentView)
  const { sources, current, select } = useContentProvider()
  const visible = view === 'explore' || view === 'library'

  if (!visible || !current || sources.length < 2) return null

  return (
    <ProviderSwitchDock
      sources={sources}
      current={current}
      onSelect={select}
      heading="内容平台"
      ariaLabel="切换全局内容平台"
    />
  )
}
