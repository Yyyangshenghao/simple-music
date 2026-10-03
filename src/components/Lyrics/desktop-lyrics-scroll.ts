import { desktopLyricsScrollTiming } from '../../lib/motion-presets'

export interface DesktopLyricsScrollFrame {
  trackKey: string
  lineIndex: number
  double: boolean
  line: string
  nextLine: string
}

export function canScrollDesktopLyrics(previous: DesktopLyricsScrollFrame | null, current: DesktopLyricsScrollFrame): boolean {
  return !!previous && previous.double && current.double && !!current.trackKey
    && previous.trackKey === current.trackKey && previous.lineIndex >= 0
    && current.lineIndex === previous.lineIndex + 1 && !!previous.nextLine
    && previous.nextLine === current.line
}

export function scrollDesktopLyrics(outgoing: HTMLElement, current: HTMLElement, next: HTMLElement | null, previousLine: string, distance: number): () => void {
  outgoing.textContent = previousLine
  const animations = [
    outgoing.animate([
      { transform: 'translateY(0px)', opacity: 1 },
      { transform: `translateY(-${distance}px)`, opacity: 0 }
    ], desktopLyricsScrollTiming),
    current.animate([
      { transform: `translateY(${distance}px)`, opacity: 0.62 },
      { transform: 'translateY(0px)', opacity: 1 }
    ], desktopLyricsScrollTiming)
  ]
  if (next) animations.push(next.animate([
    { transform: `translateY(${distance}px)`, opacity: 0 },
    { transform: 'translateY(0px)', opacity: 1 }
  ], desktopLyricsScrollTiming))
  animations[0].onfinish = () => { outgoing.textContent = '' }
  return () => {
    for (const animation of animations) {
      animation.onfinish = null
      animation.cancel()
    }
    outgoing.textContent = ''
  }
}
