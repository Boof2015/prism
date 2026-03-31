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
