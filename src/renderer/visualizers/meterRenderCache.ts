import { resolveColorToRgb, type RgbColor } from '../utils/color'

// Keep the existing Canvas commands and colors; reuse their invariant inputs.
export class MeterRenderCache {
  private colors = new Map<string, RgbColor>()
  private textWidths = new Map<string, number>()
  private fonts: FontFaceSet | undefined

  constructor(canvas: HTMLCanvasElement) {
    this.fonts = canvas.ownerDocument?.fonts
    this.fonts?.addEventListener('loadingdone', this.clearTextWidths)
    this.fonts?.addEventListener('loadingerror', this.clearTextWidths)
  }

  color(value: string): RgbColor {
    let color = this.colors.get(value)
    if (!color) {
      color = resolveColorToRgb(value)
      this.colors.set(value, color)
    }
    return color
  }

  // Layout callers supply the font so cache hits need no Canvas font access.
  // Drawing code sets its own font independently of these measurements.
  textWidth(ctx: CanvasRenderingContext2D, text: string, font: string): number {
    const key = `${font}\n${text}`
    let width = this.textWidths.get(key)
    if (width === undefined) {
      ctx.font = font
      width = ctx.measureText(text).width
      // Bound retained measurements even if fonts or labels keep changing.
      if (this.textWidths.size >= 256) this.textWidths.clear()
      this.textWidths.set(key, width)
    }
    return width
  }

  private clearTextWidths = (): void => {
    this.textWidths.clear()
  }

  clear(): void {
    this.colors.clear()
    this.clearTextWidths()
  }

  dispose(): void {
    this.fonts?.removeEventListener('loadingdone', this.clearTextWidths)
    this.fonts?.removeEventListener('loadingerror', this.clearTextWidths)
    this.clear()
  }
}
