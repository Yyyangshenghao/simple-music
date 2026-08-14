import { providerFor } from '../providers/registry'
import type { PlaybackCandidate, ProviderId, QualityOption } from '../providers/types'
import { isProviderId, PlaybackUnavailableError } from '../providers/types'
import type { AudioQuality, Track } from '../types/domain'
import { findEquivalentTrack, type TrackMatchResult } from './track-match'

export type PlaybackAttemptStage = 'match' | 'resolve' | 'media-load'
export type PlaybackAttemptResult = 'success' | 'unavailable' | 'restricted' | 'error' | 'cancelled'

export interface PlaybackAttempt {
  source: ProviderId
  trackId?: unknown
  quality?: string
  url?: string
  stage: PlaybackAttemptStage
  result: PlaybackAttemptResult
  reason?: string
}

export interface PlaybackResolution {
  originTrack: Track
  resolvedTrack: Track
  actualSource: ProviderId
  quality: QualityOption
  url: string
  trial: boolean
  attempts: PlaybackAttempt[]
  scrobbleTarget: {
    source: ProviderId
    trackId: unknown
  }
}

export interface PlaybackSourcePreferences {
  playbackOrder: ProviderId[]
  preferOriginSource: boolean
  multiSourceFallback: boolean
  preferredSource?: ProviderId
}

interface ResolverDependencies {
  provider: typeof providerFor
  match: (
    origin: Track,
    targetSource: ProviderId,
    signal?: AbortSignal
  ) => Promise<TrackMatchResult | null>
  isParticipating: (source: ProviderId) => boolean
}

interface SourceState {
  source: ProviderId
  track?: Track | null
  qualities: AudioQuality[]
  qualityIndex: number
  expandedQualities: boolean
  candidateQueue: PlaybackCandidate[]
  seenUrls: Set<string>
}

const DEFAULT_MAX_ATTEMPTS = 24

function uniqueSources(values: Array<ProviderId | undefined>): ProviderId[] {
  const seen = new Set<ProviderId>()
  return values.filter((value): value is ProviderId => {
    if (!value || seen.has(value)) return false
    seen.add(value)
    return true
  })
}

/** 一次播放会话的确定性来源顺序；调用方传入的 playbackOrder 已只含参与平台。 */
export function buildPlaybackSourceOrder(
  origin: Track,
  preferences: PlaybackSourcePreferences,
  isParticipating: (source: ProviderId) => boolean
): ProviderId[] {
  const originSource = isProviderId(origin.source) ? origin.source : undefined
  const ordered = uniqueSources([
    preferences.preferredSource,
    preferences.preferOriginSource ? originSource : undefined,
    ...preferences.playbackOrder,
    !preferences.preferOriginSource ? originSource : undefined,
  ]).filter(isParticipating)
  return preferences.multiSourceFallback ? ordered : ordered.slice(0, 1)
}

function qualityFallbackOrder(requested: AudioQuality, available: QualityOption[]): AudioQuality[] {
  const ids = available.map((quality) => quality.id as AudioQuality)
  if (requested === 'max') return ids
  const requestedIndex = ids.indexOf(requested)
  return requestedIndex >= 0 ? ids.slice(requestedIndex) : ids
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR')
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}

/**
 * 单曲、单会话的有限状态解析器。URL 非空只代表候选已发现；必须由 AudioEngine 的
 * canplay 回调调用 complete，媒体 error 则把失败候选交回 next 继续同源/跨源降级。
 */
export class PlaybackResolver {
  readonly originTrack: Track
  readonly sourceOrder: ProviderId[]
  readonly attempts: PlaybackAttempt[] = []
  failureMessage: string | null = null

  private readonly requestedQuality: AudioQuality
  private readonly deps: ResolverDependencies
  private readonly controller = new AbortController()
  private readonly maxAttempts: number
  private readonly sourceStates: SourceState[]
  private sourceIndex = 0
  private candidateAttempts = 0
  private currentCandidate: PlaybackCandidate | null = null

  constructor(
    originTrack: Track,
    requestedQuality: AudioQuality,
    preferences: PlaybackSourcePreferences,
    dependencies: Partial<ResolverDependencies> & Pick<ResolverDependencies, 'isParticipating'>,
    maxAttempts = DEFAULT_MAX_ATTEMPTS
  ) {
    this.originTrack = originTrack
    this.requestedQuality = requestedQuality
    this.deps = {
      provider: dependencies.provider ?? providerFor,
      match: dependencies.match ?? findEquivalentTrack,
      isParticipating: dependencies.isParticipating,
    }
    this.maxAttempts = Math.max(1, maxAttempts)
    this.sourceOrder = buildPlaybackSourceOrder(originTrack, preferences, this.deps.isParticipating)
    this.sourceStates = this.sourceOrder.map((source) => ({
      source,
      qualities: [requestedQuality],
      qualityIndex: 0,
      expandedQualities: false,
      candidateQueue: [],
      seenUrls: new Set(),
    }))
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  abort(): void {
    if (this.controller.signal.aborted) return
    this.controller.abort()
    if (this.currentCandidate) {
      this.attempts.push({
        source: this.currentCandidate.source,
        trackId: this.currentCandidate.track.id,
        quality: this.currentCandidate.quality.id,
        url: this.currentCandidate.url,
        stage: 'media-load',
        result: 'cancelled',
      })
      this.currentCandidate = null
    }
  }

  /** 预加载或曲目自带直链已经尝试时，避免解析器再次返回完全相同的地址。 */
  ignoreUrl(source: ProviderId, url: string): void {
    this.sourceStates.find((state) => state.source === source)?.seenUrls.add(url)
  }

  recordExternalMediaFailure(candidate: PlaybackCandidate, reason?: string): void {
    this.sourceStates.find((state) => state.source === candidate.source)?.seenUrls.add(candidate.url)
    this.attempts.push({
      source: candidate.source,
      trackId: candidate.track.id,
      quality: candidate.quality.id,
      url: candidate.url,
      stage: 'media-load',
      result: 'error',
      reason,
    })
  }

  completeExternal(candidate: PlaybackCandidate): PlaybackResolution | null {
    if (this.controller.signal.aborted) return null
    this.sourceStates.find((state) => state.source === candidate.source)?.seenUrls.add(candidate.url)
    this.attempts.push({
      source: candidate.source,
      trackId: candidate.track.id,
      quality: candidate.quality.id,
      url: candidate.url,
      stage: 'media-load',
      result: 'success',
    })
    return {
      originTrack: this.originTrack,
      resolvedTrack: candidate.track,
      actualSource: candidate.source,
      quality: candidate.quality,
      url: candidate.url,
      trial: candidate.trial,
      attempts: [...this.attempts],
      scrobbleTarget: { source: candidate.source, trackId: candidate.track.id },
    }
  }

  async next(mediaFailureReason?: string): Promise<PlaybackCandidate | null> {
    if (this.currentCandidate) {
      this.attempts.push({
        source: this.currentCandidate.source,
        trackId: this.currentCandidate.track.id,
        quality: this.currentCandidate.quality.id,
        url: this.currentCandidate.url,
        stage: 'media-load',
        result: 'error',
        reason: mediaFailureReason,
      })
      this.currentCandidate = null
    }

    while (!this.controller.signal.aborted && this.candidateAttempts < this.maxAttempts) {
      const state = this.sourceStates[this.sourceIndex]
      if (!state) return null
      if (!this.deps.isParticipating(state.source)) {
        this.sourceIndex++
        continue
      }

      if (state.track === undefined) {
        if (state.source === this.originTrack.source) {
          state.track = this.originTrack
        } else {
          try {
            const match = await this.deps.match(this.originTrack, state.source, this.controller.signal)
            if (this.controller.signal.aborted) return null
            if (!this.deps.isParticipating(state.source)) {
              this.sourceIndex++
              continue
            }
            state.track = match?.track ?? null
            this.attempts.push({
              source: state.source,
              trackId: match?.track.id,
              stage: 'match',
              result: match ? 'success' : 'unavailable',
              reason: match ? `score:${match.score}` : undefined,
            })
          } catch (error) {
            if (isAbort(error) || this.controller.signal.aborted) return null
            state.track = null
            this.attempts.push({
              source: state.source,
              stage: 'match',
              result: 'error',
              reason: errorMessage(error),
            })
          }
        }
      }
      if (!state.track) {
        this.sourceIndex++
        continue
      }

      const queued = state.candidateQueue.shift()
      if (queued) {
        this.candidateAttempts++
        this.currentCandidate = queued
        return queued
      }

      const quality = state.qualities[state.qualityIndex]
      if (quality) {
        state.qualityIndex++
        try {
          const candidates = await this.deps.provider(state.source).playback.resolve(
            state.track,
            quality,
            this.controller.signal
          )
          if (this.controller.signal.aborted) return null
          if (!this.deps.isParticipating(state.source)) {
            this.sourceIndex++
            continue
          }
          const fresh = candidates.filter((candidate) => {
            if (!candidate.url || state.seenUrls.has(candidate.url)) return false
            state.seenUrls.add(candidate.url)
            return candidate.source === state.source
          })
          this.attempts.push({
            source: state.source,
            trackId: state.track.id,
            quality,
            stage: 'resolve',
            result: fresh.length > 0 ? 'success' : 'unavailable',
          })
          state.candidateQueue.push(...fresh)
          continue
        } catch (error) {
          if (isAbort(error) || this.controller.signal.aborted) return null
          if (error instanceof PlaybackUnavailableError) this.failureMessage = error.message
          this.attempts.push({
            source: state.source,
            trackId: state.track.id,
            quality,
            stage: 'resolve',
            result: error instanceof PlaybackUnavailableError
              ? (error.reason === 'restricted' ? 'restricted' : 'unavailable')
              : 'error',
            reason: errorMessage(error),
          })
          continue
        }
      }

      if (!state.expandedQualities) {
        state.expandedQualities = true
        try {
          const available = await this.deps.provider(state.source).playback.getQualities(state.track)
          if (this.controller.signal.aborted) return null
          if (!this.deps.isParticipating(state.source)) {
            this.sourceIndex++
            continue
          }
          const tried = new Set(state.qualities)
          state.qualities.push(...qualityFallbackOrder(this.requestedQuality, available).filter((id) => !tried.has(id)))
        } catch {
          /* 无法探测档位时结束当前平台；首选档已经尝试过。 */
        }
        if (state.qualityIndex < state.qualities.length) continue
      }
      this.sourceIndex++
    }
    return null
  }

  complete(candidate: PlaybackCandidate): PlaybackResolution | null {
    if (this.controller.signal.aborted || candidate !== this.currentCandidate) return null
    this.attempts.push({
      source: candidate.source,
      trackId: candidate.track.id,
      quality: candidate.quality.id,
      url: candidate.url,
      stage: 'media-load',
      result: 'success',
    })
    return {
      originTrack: this.originTrack,
      resolvedTrack: candidate.track,
      actualSource: candidate.source,
      quality: candidate.quality,
      url: candidate.url,
      trial: candidate.trial,
      attempts: [...this.attempts],
      scrobbleTarget: { source: candidate.source, trackId: candidate.track.id },
    }
  }
}
