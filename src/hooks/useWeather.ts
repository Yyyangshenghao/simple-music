import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import type { Track } from '../types/domain'

export interface WeatherRadio {
  title: string
  subtitle: string
  seedQueries: string[]
  songs: Track[]
}

export interface WeatherRadioResponse {
  ok?: boolean
  weather?: unknown
  radio?: WeatherRadio
}

interface WeatherState {
  weather: unknown
  radio: WeatherRadio | null
  loading: boolean
  error: string | null
}

export function useWeather(autoLoad = true): WeatherState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<WeatherState>({ weather: null, radio: null, loading: false, error: null })

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await api.get<WeatherRadioResponse>('/api/weather/radio')
      setState({ weather: data.weather ?? null, radio: data.radio ?? null, loading: false, error: null })
    } catch (e) {
      setState({ weather: null, radio: null, loading: false, error: (e as Error).message })
    }
  }, [])

  useEffect(() => {
    if (autoLoad) void refresh()
  }, [autoLoad, refresh])

  return { ...state, refresh }
}
