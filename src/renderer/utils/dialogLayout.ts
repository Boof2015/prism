/** Measure a hidden dialog without waiting for compositor animation frames. */
export function observeDialogLayout(
  elements: Element[],
  reportLayout: () => void,
  fontsReady: Promise<unknown> = document.fonts.ready,
): () => void {
  let disposed = false
  let observer: ResizeObserver | undefined
  const report = (): void => { if (!disposed) reportLayout() }

  void fontsReady.then(() => {
    if (disposed) return
    // Wayland may withhold animation frames until the window is shown. The
    // main process needs this measurement before showing the window at all.
    report()
    observer = new ResizeObserver(report)
    for (const element of elements) observer.observe(element)
  })

  return () => {
    disposed = true
    observer?.disconnect()
  }
}
