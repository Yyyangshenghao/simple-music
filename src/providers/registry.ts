import { neteaseProvider } from './netease-provider'
import { qqProvider } from './qq-provider'
import { PROVIDER_IDS, type MusicProvider, type ProviderId } from './types'

const providers = [neteaseProvider, qqProvider] as const
const byId = new Map<ProviderId, MusicProvider>(providers.map((provider) => [provider.descriptor.id, provider]))

export function listProviders(): readonly MusicProvider[] {
  return providers
}

export function providerFor(id: ProviderId): MusicProvider {
  const provider = byId.get(id)
  if (!provider) throw new Error(`UNKNOWN_MUSIC_PROVIDER:${id}`)
  return provider
}

if (byId.size !== PROVIDER_IDS.length) {
  throw new Error('MUSIC_PROVIDER_REGISTRY_INCOMPLETE')
}
