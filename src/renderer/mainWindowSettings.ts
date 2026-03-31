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
