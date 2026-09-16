import { useState, useEffect, useLayoutEffect, useRef, useCallback, type JSX, type KeyboardEvent } from 'react'
import type { DialogOptions, DialogResult } from '../../types/dialog'
import { applyResolvedThemeToDocument } from '../../shared/themeState'
import '../styles/dialog.css'

export default function DialogApp(): JSX.Element {
  const [config, setConfig] = useState<DialogOptions | null>(null)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const defaultButtonRef = useRef<HTMLButtonElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  const buttonsRef = useRef<HTMLDivElement>(null)
  const submittedRef = useRef(false)

  useEffect(() => {
    let disposed = false
    let themeChanged = false
    const unsubscribe = window.electronAPI.onDialogThemeChanged((theme) => {
      themeChanged = true
      applyResolvedThemeToDocument({ interface: theme }, document.documentElement.style)
    })

    void window.electronAPI.getDialogConfig().then(({ options, theme }) => {
      if (disposed) return
      // A theme event received during bootstrap is newer than the requested snapshot.
      if (!themeChanged) {
        applyResolvedThemeToDocument({ interface: theme }, document.documentElement.style)
      }
      setInputValue(options.defaultValue ?? '')
      setConfig(options)
    }).catch((error: unknown) => {
      if (disposed) return
      console.error('Could not initialize profile dialog:', error)
      window.electronAPI.close()
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  useLayoutEffect(() => {
    if (!config) return
    if (config.type === 'prompt') {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else {
      defaultButtonRef.current?.focus()
    }
  }, [config])

  useEffect(() => {
    if (!config) return
    let disposed = false
    let lastHeight = 0
    let observer: ResizeObserver | undefined
    let frame = 0

    const reportLayout = (): void => {
      if (disposed || !copyRef.current || !buttonsRef.current) return
      // Measure the unconstrained copy, so a capped window can still scroll its body.
      // Include the card border (2px) and transparent window margins (16px).
      const height = Math.ceil(
        copyRef.current.getBoundingClientRect().height
        + buttonsRef.current.getBoundingClientRect().height + 18,
      )
      if (height !== lastHeight) {
        lastHeight = height
        window.electronAPI.reportDialogLayout({ height })
      }
    }

    void document.fonts.ready.then(() => {
      if (disposed) return
      frame = requestAnimationFrame(() => {
        reportLayout()
        observer = new ResizeObserver(reportLayout)
        if (copyRef.current) observer.observe(copyRef.current)
        if (buttonsRef.current) observer.observe(buttonsRef.current)
      })
    })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [config])

  const submit = useCallback((buttonIndex: number) => {
    if (!config || submittedRef.current) return
    const isPrimaryPromptSubmit = config.type === 'prompt' && buttonIndex === (config.defaultId ?? 0)
    if (isPrimaryPromptSubmit && !inputValue.trim()) return

    const result: DialogResult = { buttonIndex }
    if (config.type === 'prompt') result.value = inputValue
    submittedRef.current = true
    window.electronAPI.sendDialogResult(result)
  }, [config, inputValue])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!config || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      submit(config.cancelId ?? config.buttons.length - 1)
    } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault()
      submit(config.defaultId ?? 0)
    }
  }, [config, submit])

  if (!config) return <div className="dialog-root" />

  const primaryIndex = config.defaultId ?? 0
  const isPromptPrimaryDisabled = config.type === 'prompt' && !inputValue.trim()
  // Reverse the DOM order as well as the visual order, keeping original result indices.
  const buttons = config.buttons.map((label, index) => ({ label, index })).reverse()

  return (
    <div className="dialog-root" onKeyDown={handleKeyDown}>
      <div
        className="dialog-window"
        role="dialog"
        aria-labelledby="dialog-title"
        aria-describedby={config.detail ? 'dialog-message dialog-detail' : 'dialog-message'}
      >
        <div className="dialog-content">
          <div className="dialog-copy" ref={copyRef}>
            <h1 className="dialog-title" id="dialog-title">{config.title}</h1>
            <p className="dialog-message" id="dialog-message">{config.message}</p>
            {config.detail && <p className="dialog-detail" id="dialog-detail">{config.detail}</p>}
            {config.type === 'prompt' && (
              <input
                ref={inputRef}
                type="text"
                className="dialog-input"
                aria-label="Profile name"
                aria-describedby="dialog-message"
                value={inputValue}
                placeholder={config.placeholder}
                onChange={(event) => setInputValue(event.target.value)}
              />
            )}
          </div>
        </div>
        <div className="dialog-buttons" ref={buttonsRef}>
          {buttons.map(({ label, index }) => (
            <button
              key={index}
              ref={index === primaryIndex ? defaultButtonRef : undefined}
              type="button"
              className={[
                'dialog-btn',
                index === primaryIndex ? 'dialog-btn--primary' : '',
                label.toLowerCase() === 'delete' || label.toLowerCase() === 'discard'
                  ? 'dialog-btn--danger'
                  : '',
              ].filter(Boolean).join(' ')}
              onClick={() => submit(index)}
              disabled={index === primaryIndex && isPromptPrimaryDisabled}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
