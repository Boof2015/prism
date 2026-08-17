import type { TrayRendererCommand } from '../../types/desktopIntegration'

export class TrayRendererCommandQueue {
  private commands: TrayRendererCommand[] = []

  enqueue(command: TrayRendererCommand): void {
    this.commands.push(command)
  }

  flush(send: (command: TrayRendererCommand) => void): void {
    for (const command of this.commands) {
      send(command)
    }
    this.commands = []
  }

  clear(): void {
    this.commands = []
  }
}
