/** Windows can fit ordinary windows to the new work area without user input. */
export class DockingGeometryGuard {
  private settlingUntil = 0
  private userChanges = new Map<number, number>()
  constructor(private now: () => number = Date.now) {}

  systemChange(): void {
    this.settlingUntil = this.now() + 600
    this.userChanges.clear()
  }

  userChange(windowId: number): void {
    this.userChanges.set(windowId, this.now() + 600)
  }

  forget(windowId: number): void { this.userChanges.delete(windowId) }

  shouldPersist(windowId: number, dockingEnabled: boolean): boolean {
    const now = this.now()
    return (!dockingEnabled && now >= this.settlingUntil)
      || now < (this.userChanges.get(windowId) ?? 0)
  }
}
