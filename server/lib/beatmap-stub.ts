/**
 * DJ 节拍分析占位实现。
 *
 * 真实算法将在后续接入 dj-analyzer（对应参考项目 ./dj-analyzer.js 中的
 * analyzePodcastDjStream / analyzePodcastDjIntro）。当前仅返回空结果，
 * 保证 `/api/podcast/dj-beatmap` 端点链路可用。
 */
export interface BeatmapAnalyzeOptions {
  durationSec?: number
  introSec?: number
  userAgent?: string
}

export interface BeatmapAnalyzeResult {
  bpm: number
  beats: number[]
}

export async function analyzeBeatmap(
  _audioUrl: string,
  _options: BeatmapAnalyzeOptions = {}
): Promise<BeatmapAnalyzeResult> {
  return { bpm: 0, beats: [] }
}
