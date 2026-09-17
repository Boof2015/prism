import type { NowPlayingManager } from './nowPlayingManager'

interface ConsumerWebContents {
  readonly id: number
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
}

/** Keep providers active for the native window's lifetime, including renderer reloads. */
export function bindNowPlayingWindowConsumer(
  contents: ConsumerWebContents,
  manager: Pick<NowPlayingManager, 'setConsumerActive'>,
  onError: (error: unknown) => void,
): void {
  if (contents.isDestroyed()) return

  const consumerId = contents.id
  let destroyed = false
  const setActive = async (active: boolean): Promise<void> => {
    try {
      await manager.setConsumerActive(consumerId, active)
    } catch (error) {
      onError(error)
    }
  }

  contents.once('destroyed', () => {
    destroyed = true
    void setActive(false)
  })

  void (async () => {
    await setActive(true)
    // Initialization may have added this consumer after the destruction cleanup ran.
    if (destroyed) await setActive(false)
  })()
}
