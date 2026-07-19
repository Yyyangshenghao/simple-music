/**
 * 封面边缘/深度纹理生成(移植自 Mineradio-MacOS beat-analysis.js 的 buildEdgeAndDepth)。
 * 输出 RGBA:R=启发式深度 G=Sobel 边缘 B=前景 mask A=亮度,
 * 供封面粒子 shader 做边缘增亮、背景压暗与可读性判断。
 * 原版还有 AI 深度估计(50MB CDN 模型)覆写 R 通道,此处不引入,仅保留启发式。
 */

/** 纯数据版:从 RGBA 像素算出同尺寸的 RGBA 边缘/深度数据(可在 node 环境测试)。 */
export function buildEdgeDepthData(src: Uint8ClampedArray, W: number, H: number): Uint8ClampedArray {
  const N = W * H
  const lum = new Float32Array(N)
  const blur = new Float32Array(N)
  const tmp = new Float32Array(N)

  for (let i = 0; i < N; i++) {
    const di = i * 4
    lum[i] = (src[di] * 0.299 + src[di + 1] * 0.587 + src[di + 2] * 0.114) / 255
  }

  // 滑动窗口 box blur(水平+垂直各一遍),作为 Sobel 与深度的降噪基础
  const blurH = (s: Float32Array, d: Float32Array, r: number) => {
    for (let y = 0; y < H; y++) {
      let sum = 0
      for (let x = -r; x <= r; x++) sum += s[y * W + Math.max(0, Math.min(W - 1, x))]
      for (let x = 0; x < W; x++) {
        d[y * W + x] = sum / (2 * r + 1)
        const xR = Math.min(W - 1, x + r + 1)
        const xL = Math.max(0, x - r)
        sum += s[y * W + xR] - s[y * W + xL]
      }
    }
  }
  const blurV = (s: Float32Array, d: Float32Array, r: number) => {
    for (let x = 0; x < W; x++) {
      let sum = 0
      for (let y = -r; y <= r; y++) sum += s[Math.max(0, Math.min(H - 1, y)) * W + x]
      for (let y = 0; y < H; y++) {
        d[y * W + x] = sum / (2 * r + 1)
        const yD = Math.min(H - 1, y + r + 1)
        const yU = Math.max(0, y - r)
        sum += s[yD * W + x] - s[yU * W + x]
      }
    }
  }
  blurH(lum, tmp, 4)
  blurV(tmp, blur, 4)

  // Sobel 边缘(在 blur 上做,减少噪点)
  const edge = new Float32Array(N)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const gx =
        -blur[(y - 1) * W + (x - 1)] - 2 * blur[y * W + (x - 1)] - blur[(y + 1) * W + (x - 1)] +
        blur[(y - 1) * W + (x + 1)] + 2 * blur[y * W + (x + 1)] + blur[(y + 1) * W + (x + 1)]
      const gy =
        -blur[(y - 1) * W + (x - 1)] - 2 * blur[(y - 1) * W + x] - blur[(y - 1) * W + (x + 1)] +
        blur[(y + 1) * W + (x - 1)] + 2 * blur[(y + 1) * W + x] + blur[(y + 1) * W + (x + 1)]
      edge[y * W + x] = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 1.4)
    }
  }

  // 启发式深度:亮度 + 中心偏置;前景 mask = 深度 + 高对比区
  const out = new Uint8ClampedArray(N * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const cx = (x / (W - 1) - 0.5) * 2
      const cy = (y / (H - 1) - 0.5) * 2
      const centerBias = 1 - Math.min(1, Math.sqrt(cx * cx + cy * cy) * 0.75)
      const depth = Math.min(1, blur[i] * 0.45 + centerBias * 0.55)
      const fg = Math.min(1, depth * 0.6 + edge[i] * 0.5)
      const di = i * 4
      out[di] = Math.round(depth * 255)
      out[di + 1] = Math.round(edge[i] * 255)
      out[di + 2] = Math.round(fg * 255)
      out[di + 3] = Math.round(lum[i] * 255)
    }
  }
  return out
}

