export type ResizeSender = (dx: number) => Promise<unknown> | void

const DEFAULT_IN_FLIGHT_TIMEOUT_MS = 300

export function createResizeDispatcher(send: ResizeSender, inFlightTimeoutMs = DEFAULT_IN_FLIGHT_TIMEOUT_MS) {
  let queuedDx = 0
  let inFlight = false

  const flush = () => {
    if (inFlight || queuedDx === 0) return
    const dx = queuedDx
    queuedDx = 0
    inFlight = true
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, inFlightTimeoutMs)
    })
    Promise.race([Promise.resolve().then(() => send(dx)), timeout])
      .catch(() => undefined)
      .finally(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
        inFlight = false
        flush()
      })
  }

  return {
    push(dx: number) {
      if (!Number.isFinite(dx) || dx === 0) return
      queuedDx += dx
      flush()
    }
  }
}
