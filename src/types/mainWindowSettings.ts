/** Natural measurements in renderer CSS pixels; zero heights close settings. */
export interface MainWindowSettingsRequest {
  panelHeight: number
  bottomBarHeight: number
}

export interface MainWindowSettingsLayout {
  /** The available settings viewport, including its footer and border, in CSS pixels. */
  settingsHeight: number
}
