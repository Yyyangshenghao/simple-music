import { useEffect, useMemo, useState } from 'react'
import {
  resolveContentProvider,
  shouldPersistResolvedContentProvider,
} from '../lib/content-provider-preference'
import { PROVIDER_IDS, type ProviderId } from '../providers/types'
import { useProviderStore } from '../stores/providers'

const PREFERRED_PROVIDER_GRACE_MS = 3000

export function useContentProvider(): {
  sources: ProviderId[]
  current: ProviderId | null
  select(source: ProviderId): void
} {
  const byId = useProviderStore((state) => state.byId)
  const preferred = useProviderStore((state) => state.contentSource)
  const select = useProviderStore((state) => state.setContentSource)
  const [fallbackAllowed, setFallbackAllowed] = useState(false)
  const sources = useMemo(
    () => PROVIDER_IDS.filter((source) => byId[source].enabled && byId[source].auth === 'authenticated'),
    [byId]
  )
  const waitingForPreferred = !!preferred
    && byId[preferred].enabled
    && byId[preferred].auth === 'unknown'
  const current = resolveContentProvider(preferred, byId, !fallbackAllowed)

  useEffect(() => {
    setFallbackAllowed(false)
    if (!waitingForPreferred) return
    const timer = window.setTimeout(() => setFallbackAllowed(true), PREFERRED_PROVIDER_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [preferred, waitingForPreferred])

  useEffect(() => {
    if (shouldPersistResolvedContentProvider(preferred, current, byId)) select(current)
  }, [byId, current, preferred, select])

  return { sources, current, select }
}
