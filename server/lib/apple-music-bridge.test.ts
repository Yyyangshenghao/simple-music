import { describe, expect, it } from 'vitest'
import type { ServerContext } from '../types'
import { openAppleMusicBridge, hasAppleMusicSession, queueAppleMusicCommand, pollAppleMusicCommands, appleMusicBridgeState, updateAppleMusicBridgeState } from './apple-music-bridge'
const context = (): ServerContext => ({ port: 35530, userDataDir: '/tmp/music' })
const activate = (ctx: ServerContext) => updateAppleMusicBridgeState(ctx, { playbackId: '', subscription: 'active' })
describe('Apple Music browser bridge', () => {
  it('isolates secrets by server instance and rotates old sessions', () => {
    const a = context(), b = context()
    const secret = new URL(openAppleMusicBridge(a)).hash.slice(1)
    openAppleMusicBridge(b)
    expect(hasAppleMusicSession(a, secret)).toBe(true)
    expect(hasAppleMusicSession(b, secret)).toBe(false)
    openAppleMusicBridge(a)
    expect(hasAppleMusicSession(a, secret)).toBe(false)
    expect(hasAppleMusicSession(a, '')).toBe(false)
  })
  it('acknowledges commands and replaces obsolete loads', () => {
    const ctx = context(); openAppleMusicBridge(ctx); activate(ctx)
    queueAppleMusicCommand(ctx, { type: 'load', playbackId: 'a', id: '123' })
    const first = pollAppleMusicCommands(ctx, 0)
    expect(first).toHaveLength(1)
    expect(pollAppleMusicCommands(ctx, first[0].sequence)).toHaveLength(0)
    queueAppleMusicCommand(ctx, { type: 'seek', playbackId: 'a', seconds: 20 })
    queueAppleMusicCommand(ctx, { type: 'load', playbackId: 'b', id: '234' })
    const next = pollAppleMusicCommands(ctx, first[0].sequence)
    expect(next).toHaveLength(1)
    expect(next[0].playbackId).toBe('b')
    expect(next[0].sequence).toBeGreaterThan(first[0].sequence)
  })
  it('ignores state and commands for replaced playback', () => {
    const ctx = context(); openAppleMusicBridge(ctx); activate(ctx)
    queueAppleMusicCommand(ctx, { type: 'load', playbackId: 'b', id: '234' })
    updateAppleMusicBridgeState(ctx, { playbackId: 'a', status: 'ended', position: 42 })
    queueAppleMusicCommand(ctx, { type: 'pause', playbackId: 'a' })
    expect(appleMusicBridgeState(ctx).status).toBe('loading')
    expect(pollAppleMusicCommands(ctx, 0)).toHaveLength(1)
  })
  it('reports disconnection and stops a resumed tab', () => {
    const ctx = context(); openAppleMusicBridge(ctx); activate(ctx)
    queueAppleMusicCommand(ctx, { type: 'load', playbackId: 'a', id: '123' })
    pollAppleMusicCommands(ctx, 0, 1000)
    expect(appleMusicBridgeState(ctx, 2000).connected).toBe(true)
    expect(appleMusicBridgeState(ctx, 17000)).toMatchObject({ connected: false, status: 'error' })
    expect(pollAppleMusicCommands(ctx, 1, 18000)[0].type).toBe('stop')
  })
  it('rejects invalid commands', () => {
    const ctx = context(); openAppleMusicBridge(ctx)
    expect(() => queueAppleMusicCommand(ctx, { type: 'load', playbackId: 'a', id: '../bad' })).toThrow()
    expect(() => queueAppleMusicCommand(ctx, { type: 'volume', playbackId: 'a', volume: 2 })).toThrow()
    for (const duration of [-1, NaN, Infinity]) {
      expect(() => queueAppleMusicCommand(ctx, { type: 'load', playbackId: 'a', id: '123', duration })).toThrow('参数')
    }
    for (const controlSequence of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => queueAppleMusicCommand(ctx, { type: 'pause', playbackId: 'a', controlSequence })).toThrow('参数')
    }
  })
  it('接收有效控制确认并在新加载重置，非法确认被忽略', () => {
    const ctx = context(); openAppleMusicBridge(ctx); activate(ctx)
    queueAppleMusicCommand(ctx, { type: 'load', playbackId: 'a', id: '123' })
    queueAppleMusicCommand(ctx, { type: 'pause', playbackId: 'a', controlSequence: 1 })
    expect(appleMusicBridgeState(ctx).controlSequence).toBe(0)
    updateAppleMusicBridgeState(ctx, { playbackId: 'a', controlSequence: 1 })
    expect(appleMusicBridgeState(ctx).controlSequence).toBe(1)
    for (const controlSequence of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      updateAppleMusicBridgeState(ctx, { playbackId: 'a', controlSequence })
      expect(appleMusicBridgeState(ctx).controlSequence).toBe(1)
    }
    queueAppleMusicCommand(ctx, { type: 'load', playbackId: 'b', id: '456' })
    expect(appleMusicBridgeState(ctx).controlSequence).toBe(0)
  })
  it('明确区分无订阅和暂时无法确认，均不排队播放', () => {
    const ctx = context(); openAppleMusicBridge(ctx)
    expect(() => queueAppleMusicCommand(ctx, { type: 'load', playbackId: 'a', id: '123' })).toThrow('暂时无法确认')
    updateAppleMusicBridgeState(ctx, { playbackId: '', subscription: 'inactive' })
    expect(() => queueAppleMusicCommand(ctx, { type: 'load', playbackId: 'a', id: '123' })).toThrow('没有有效')
    expect(pollAppleMusicCommands(ctx, 0)).toHaveLength(0)
  })
})
