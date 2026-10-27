import { create } from 'zustand'
import { api } from '../lib/api'
import type { KaraokeModelId, KaraokeModelView, KaraokeModelsResponse } from '../types/karaoke'

const POLL_MS = 700

type GpuNavigator = Navigator & { gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> } }

interface KaraokeModelsState {
  models: KaraokeModelView[]
  stemLimitBytes: number
  loaded: boolean
  error: string | null
  /** 显卡是否支持半精度着色器；未检测完为 null */
  f16: boolean | null
  /** 正在卸载或清理的模型，防止重复点击 */
  busy: KaraokeModelId | 'stems' | null
  load(): Promise<void>
  install(id: KaraokeModelId): Promise<void>
  uninstall(id: KaraokeModelId): Promise<void>
  clearStems(id?: KaraokeModelId): Promise<void>
}

let pollTimer: ReturnType<typeof setTimeout> | undefined
let loadSession = 0

/** 设置页与更多菜单共用的 K 歌模型列表；有模型在下载时轮询进度。 */
export const useKaraokeModelsStore = create<KaraokeModelsState>((set, get) => {
  function schedulePoll(): void {
    clearTimeout(pollTimer)
    if (get().models.some(model => model.state === 'downloading')) pollTimer = setTimeout(() => void get().load(), POLL_MS)
  }

  return {
    models: [],
    stemLimitBytes: 0,
    loaded: false,
    error: null,
    f16: null,
    busy: null,

    async load() {
      const session = ++loadSession
      if (get().f16 === null) {
        void (async () => {
          const adapter = await (navigator as GpuNavigator).gpu?.requestAdapter().catch(() => null)
          set({ f16: !!adapter?.features.has('shader-f16') })
        })()
      }
      try {
        const data = await api.get<KaraokeModelsResponse>('/api/karaoke/models')
        if (session !== loadSession) return
        set({ models: data.models, stemLimitBytes: data.stemLimitBytes, loaded: true, error: null })
      } catch (error) {
        if (session !== loadSession) return
        set({ loaded: true, error: error instanceof Error ? error.message : '读取模型列表失败' })
      }
      schedulePoll()
    },

    async install(id) {
      try {
        await api.post('/api/karaoke/model', undefined, { model: id })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : '模型下载失败' })
      }
      await get().load()
    },

    async uninstall(id) {
      set({ busy: id })
      try {
        await api.post('/api/karaoke/model/uninstall', undefined, { model: id })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : '卸载失败' })
      } finally {
        set({ busy: null })
      }
      await get().load()
    },

    async clearStems(id) {
      set({ busy: 'stems' })
      try {
        await api.post('/api/karaoke/stems/clear', undefined, id ? { model: id } : undefined)
      } catch (error) {
        set({ error: error instanceof Error ? error.message : '清理失败' })
      } finally {
        set({ busy: null })
      }
      await get().load()
    },
  }
})
