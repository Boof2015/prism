import { useState, useEffect, useRef, useCallback, type JSX, type KeyboardEvent } from 'react'
import type { DialogOptions, DialogResult } from '../../types/dialog'

export default function DialogApp(): JSX.Element {
  const [config, setConfig] = useState<DialogOptions | null>(null)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const unsubscribe = window.electronAPI.onDialogConfig((options) => {
      setConfig(options)
      setInputValue(options.defaultValue ?? '')
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (config?.type === 'prompt' && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [config])

  const submit = useCallback((buttonIndex: number) => {
    if (!config) return
    const isPrimaryPromptSubmit = config.type === 'prompt' && buttonIndex === (config.defaultId ?? 0)
    if (isPrimaryPromptSubmit && !inputValue.trim()) {
      return
    }

    const result: DialogResult = { buttonIndex }
    if (config.type === 'prompt') {
      result.value = inputValue
    }
    window.electronAPI.sendDialogResult(result)
  }, [config, inputValue])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (!config) return
    if (e.key === 'Enter') {
      const defaultId = config.defaultId ?? 0
      submit(defaultId)
    } else if (e.key === 'Escape') {
      const cancelId = config.cancelId ?? config.buttons.length - 1
      submit(cancelId)
    }
  }, [config, submit])

  if (!config) {
    return <div className="dialog-root" />
  }

  const primaryIndex = config.defaultId ?? 0
  const cancelId = config.cancelId ?? config.buttons.length - 1
  const isPromptPrimaryDisabled = config.type === 'prompt' && !inputValue.trim()

  return (
    <div className="dialog-root" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="dialog-window">
        <div className="dialog-content">
          <div className="dialog-title">{config.title}</div>
          <div className="dialog-message">{config.message}</div>
          {config.detail && (
            <div className="dialog-detail">{config.detail}</div>
          )}
          {config.type === 'prompt' && (
            <input
              ref={inputRef}
              type="text"
              className="dialog-input"
              value={inputValue}
              placeholder={config.placeholder}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation()
                  submit(primaryIndex)
                }
              }}
            />
          )}
        </div>
        <div className="dialog-buttons">
          {config.buttons.map((label, i) => (
            <button
              key={label}
              type="button"
              className={[
                'dialog-btn',
                i === primaryIndex ? 'dialog-btn--primary' : '',
                i === cancelId && i !== primaryIndex ? 'dialog-btn--cancel' : '',
                label.toLowerCase() === 'delete' || label.toLowerCase() === 'discard'
                  ? 'dialog-btn--danger'
                  : '',
              ].filter(Boolean).join(' ')}
              onClick={() => submit(i)}
              autoFocus={i === primaryIndex && config.type !== 'prompt'}
              disabled={i === primaryIndex && isPromptPrimaryDisabled}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <style>{`
        .dialog-root {
          width: 100vw;
          height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          padding: 8px;
          background: transparent;
          -webkit-app-region: no-drag;
        }

        .dialog-window {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--panel-surface);
          border: 1px solid var(--panel-outline);
          box-shadow:
            0 22px 56px rgba(0, 0, 0, 0.58),
            inset 0 1px 0 rgba(255, 255, 255, 0.04);
          border-radius: 12px;
          overflow: hidden;
        }

        .dialog-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 20px 20px 16px;
        }

        .dialog-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.3;
        }

        .dialog-message {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.45;
        }

        .dialog-detail {
          font-size: 11px;
          color: var(--text-tertiary);
          line-height: 1.45;
          margin-top: 2px;
        }

        .dialog-input {
          margin-top: 6px;
          width: 100%;
          background: var(--input-bg);
          border: 1px solid var(--input-border);
          border-radius: 5px;
          padding: 6px 9px;
          font-size: 12px;
          color: var(--text-primary);
          outline: none;
          transition: border-color 0.12s;
        }

        .dialog-input:focus {
          border-color: var(--input-border-focus);
          background: var(--input-bg-focus);
        }

        .dialog-buttons {
          display: flex;
          flex-direction: row-reverse;
          gap: 7px;
          padding: 0 14px 14px;
        }

        .dialog-btn {
          height: 28px;
          padding: 0 14px;
          border-radius: 5px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid transparent;
          color: var(--text-primary);
          background: var(--control-bg);
          border-color: var(--control-border);
          transition: background 0.1s, border-color 0.1s;
        }

        .dialog-btn:hover {
          background: var(--control-bg-hover);
        }

        .dialog-btn--primary {
          background: var(--control-bg-active);
          border-color: var(--control-border-active);
          color: var(--accent-hover);
        }

        .dialog-btn--primary:hover {
          background: color-mix(in srgb, var(--control-bg-active) 72%, var(--accent) 28%);
          border-color: var(--accent);
        }

        .dialog-btn--danger {
          background: color-mix(in srgb, var(--danger) 12%, transparent);
          border-color: color-mix(in srgb, var(--danger) 28%, transparent);
          color: var(--danger);
        }

        .dialog-btn--danger:hover {
          background: color-mix(in srgb, var(--danger) 20%, transparent);
        }
      `}</style>
    </div>
  )
}
