export function extractColor(img: HTMLImageElement): string {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, 8, 8)
    const d = ctx.getImageData(0, 0, 8, 8).data
    let r = 0, g = 0, b = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2] }
    const px = d.length / 4
    return `rgb(${Math.round(r/px)},${Math.round(g/px)},${Math.round(b/px)})`
  } catch {
    return 'rgb(20,30,55)'
  }
}
