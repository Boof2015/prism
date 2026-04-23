function parseCssPixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function resolveMainWindowSettingsPanelHeight(
  panelElement: HTMLElement,
  contentElement: HTMLElement | null,
): number {
  if (!contentElement) {
    return Math.ceil(panelElement.scrollHeight)
  }

  const panelStyle = getComputedStyle(panelElement)
  const verticalPadding = parseCssPixels(panelStyle.paddingTop)
    + parseCssPixels(panelStyle.paddingBottom)

  return Math.ceil(contentElement.scrollHeight + verticalPadding)
}

export function resolveMainWindowSettingsHeight(
  settingsOpen: boolean,
  settingsPanelHeight: number,
  bottomBarHeight: number,
): number {
  if (!settingsOpen) {
    return 0
  }

  if (settingsPanelHeight <= 0 || bottomBarHeight <= 0) {
    return 0
  }

  return Math.ceil(settingsPanelHeight) + Math.ceil(bottomBarHeight)
}
