import { describe, expect, it } from 'vitest'
import { normalizeImageUrl, sizedImage } from './image-size'

describe('normalizeImageUrl', () => {
  it('拒绝 QQ 接口返回的相对查询串占位值', () => {
    expect(normalizeImageUrl('?n=1')).toBe('')
  })

  it('补全协议相对图片地址', () => {
    expect(normalizeImageUrl('//y.gtimg.cn/music/photo_new/cover.jpg'))
      .toBe('https://y.gtimg.cn/music/photo_new/cover.jpg')
  })
})

describe('sizedImage', () => {
  it('网易图床追加 param 缩图参数', () => {
    expect(sizedImage('https://p1.music.126.net/abc/109951.jpg', 152)).toBe(
      'https://p1.music.126.net/abc/109951.jpg?param=152y152'
    )
  })

  it('网易图床已有 query 时覆盖 param 不重复', () => {
    expect(sizedImage('https://p2.music.126.net/abc.jpg?param=1800y1800', 90)).toBe(
      'https://p2.music.126.net/abc.jpg?param=90y90'
    )
  })

  it('保留网易云已带缩略图和水印处理链的地址', () => {
    const url = 'http://p1.music.126.net/example/cover.jpg?imageView=1&thumbnail=800y800&enlarge=1%7Cwatermark&type=1'
    expect(sizedImage(url, 512)).toBe(url)
  })

  it('QQ photo_new 就近向上改写尺寸档位', () => {
    expect(sizedImage('https://y.qq.com/music/photo_new/T001R300x300M000abc.jpg?max_age=2592000', 152)).toBe(
      'https://y.qq.com/music/photo_new/T001R300x300M000abc.jpg?max_age=2592000'
    )
    expect(sizedImage('https://y.gtimg.cn/music/photo_new/T001R800x800M000abc.jpg', 52)).toBe(
      'https://y.gtimg.cn/music/photo_new/T001R90x90M000abc.jpg'
    )
  })

  it('超过最大档位时取最大档', () => {
    expect(sizedImage('https://y.qq.com/music/photo_new/T002R300x300M000abc.jpg', 1200)).toBe(
      'https://y.qq.com/music/photo_new/T002R800x800M000abc.jpg'
    )
  })

  it('未知图床/非法 URL/空串原样返回', () => {
    expect(sizedImage('https://example.com/a.jpg', 152)).toBe('https://example.com/a.jpg')
    expect(sizedImage('not-a-url', 152)).toBe('not-a-url')
    expect(sizedImage('', 152)).toBe('')
  })
})
