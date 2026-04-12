import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createEmptyWindowLocalState, normalizeWindowLocalState } from '../shared/windowState'
import type { WindowBounds } from '../types/popout'
import type { ScopeKind } from '../types/scope'
import type { PrismWindowLocalStateV1 } from '../types/windowState'

export class FileBackedWindowStateStore {
  private state: PrismWindowLocalStateV1 = createEmptyWindowLocalState()
  private initialized = false
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly localStatePath: string) {}

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.state = await this.readLocalState()
    this.initialized = true
  }

  getMainAlwaysOnTop(): boolean {
    return this.state.mainAlwaysOnTop
  }

  getPopoutAlwaysOnTop(kind: ScopeKind): boolean {
    return this.state.popoutAlwaysOnTop[kind] === true
  }

  getNowPlayingConfigWindowBounds(): WindowBounds | undefined {
    return this.state.nowPlayingConfigWindowBounds
      ? { ...this.state.nowPlayingConfigWindowBounds }
      : undefined
  }

  async setMainAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
    await this.ensureInitialized()
    this.state = normalizeWindowLocalState({
      ...this.state,
      mainAlwaysOnTop: alwaysOnTop,
      popoutAlwaysOnTop: { ...this.state.popoutAlwaysOnTop },
    })
    await this.persistState()
  }

  async setPopoutAlwaysOnTop(kind: ScopeKind, alwaysOnTop: boolean): Promise<void> {
    await this.ensureInitialized()

    const popoutAlwaysOnTop = { ...this.state.popoutAlwaysOnTop }
    if (alwaysOnTop) {
      popoutAlwaysOnTop[kind] = true
    } else {
      delete popoutAlwaysOnTop[kind]
    }

    this.state = normalizeWindowLocalState({
      ...this.state,
      popoutAlwaysOnTop,
    })
    await this.persistState()
  }

  async setNowPlayingConfigWindowBounds(bounds?: WindowBounds): Promise<void> {
    await this.ensureInitialized()
    this.state = normalizeWindowLocalState({
      ...this.state,
      nowPlayingConfigWindowBounds: bounds,
    })
    await this.persistState()
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  private async readLocalState(): Promise<PrismWindowLocalStateV1> {
    try {
      const raw = await readFile(this.localStatePath, 'utf8')
      return normalizeWindowLocalState(JSON.parse(raw) as unknown)
    } catch {
      return createEmptyWindowLocalState()
    }
  }

  private async persistState(): Promise<void> {
    const state = normalizeWindowLocalState(this.state)
    const payload = `${JSON.stringify(state, null, 2)}\n`

    this.writeChain = this.writeChain
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.localStatePath), { recursive: true })
        await writeFile(this.localStatePath, payload, 'utf8')
      })

    await this.writeChain
  }
}
