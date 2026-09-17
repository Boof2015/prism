import type { ResolvedInterfaceTheme } from './theme'

export interface DialogOptions {
  type: 'confirm' | 'prompt'
  title: string
  message: string
  detail?: string
  buttons: string[]
  defaultId?: number
  cancelId?: number
  defaultValue?: string
  placeholder?: string
}

export interface DialogResult {
  buttonIndex: number
  value?: string
}

export interface DialogConfig {
  options: DialogOptions
  theme: ResolvedInterfaceTheme
}

export interface DialogLayout {
  height: number
}
