import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type DragEvent, type ReactNode, type JSX } from 'react'
import {
  EMPTY_REFERENCE_IMPORT, clampReferenceTrim, isReferenceImporting, normalizeReferenceAsset, referenceMatchTrim,
  type SpectrumReferenceImportState, type SpectrumReferenceLevel, type SpectrumReferenceSettings, type SpectrumReferenceTransport,
} from '../../types/spectrumReference'

interface ReferenceController {
  reference: SpectrumReferenceSettings | null
  state: SpectrumReferenceImportState
  busy: boolean
  matchTrim: number | null
  choose: () => void
  importFile: (file: File) => void
  cancel: () => void
  remove: () => void
  update: (partial: Partial<Pick<SpectrumReferenceSettings, 'view' | 'trimDb'>>) => void
  reportLevel: (level: SpectrumReferenceLevel | null) => void
  reportError: (message: string) => void
}
const Context = createContext<ReferenceController | null>(null)
export const useSpectrumReference = (): ReferenceController | null => useContext(Context)

export function SpectrumReferenceProvider({ reference = null, onChange, transport, commitResults = true, ownerKey, children }: {
  reference?: SpectrumReferenceSettings | null
  onChange: (reference: SpectrumReferenceSettings | null) => void
  transport: SpectrumReferenceTransport
  commitResults?: boolean
  ownerKey?: string | null
  children: ReactNode
}): JSX.Element {
  const [state, setState] = useState<SpectrumReferenceImportState>({ ...EMPTY_REFERENCE_IMPORT })
  const [level, setLevel] = useState<SpectrumReferenceLevel | null>(null)
  const referenceRef = useRef(reference), changeRef = useRef(onChange)
  const lastApplied = useRef<string | null>(null)
  const ownerRef = useRef(ownerKey)
  referenceRef.current = reference; changeRef.current = onChange
  useEffect(() => {
    if (ownerRef.current !== ownerKey) {
      ownerRef.current = ownerKey
      void transport.cancel()
      setLevel(null)
    }
  }, [ownerKey, transport])
  useEffect(() => {
    let disposed = false, received = false
    const accept = (next: SpectrumReferenceImportState): void => {
      if (disposed) return
      setState(next)
      if (commitResults && next.phase === 'ready' && next.result && next.jobId !== lastApplied.current) {
        lastApplied.current = next.jobId
        const asset = normalizeReferenceAsset(next.result)
        if (asset && asset.id !== referenceRef.current?.asset.id) {
          changeRef.current({ asset, trimDb: 0, view: referenceRef.current?.view ?? 'overlay' })
        }
      }
    }
    const unsubscribe = transport.subscribe(next => { received = true; accept(next) })
    void transport.getState().then(next => { if (!received) accept(next) }).catch(() => {})
    return () => { disposed = true; unsubscribe() }
  }, [transport, commitResults])
  const run = useCallback((action: () => Promise<void>): void => {
    void action().catch(error => setState(previous => ({ ...previous, phase: 'error', preview: null,
      error: error instanceof Error ? error.message : String(error) })))
  }, [])
  const reportLevel = useCallback((next: SpectrumReferenceLevel | null): void => setLevel(next), [])
  const busy = isReferenceImporting(state)
  const update = (partial: Partial<Pick<SpectrumReferenceSettings, 'view' | 'trimDb'>>): void => {
    const current = referenceRef.current
    if (current) onChange({ ...current, ...partial, trimDb: clampReferenceTrim(partial.trimDb ?? current.trimDb) })
  }
  return <Context.Provider value={{ reference, state, busy,
    matchTrim: !busy && reference ? referenceMatchTrim(reference.asset.meanSquare, level) : null,
    choose: () => run(() => transport.choose()), importFile: file => run(() => transport.importFile(file)),
    cancel: () => run(() => transport.cancel()),
    remove: () => { run(async () => { await transport.cancel(); changeRef.current(null) }); },
    update, reportLevel, reportError: error => setState(previous => ({ ...previous, error, phase: 'error', preview: null })),
  }}>{children}</Context.Provider>
}

export function ReferenceImportStatus({ inline = false }: { inline?: boolean }): JSX.Element | null {
  const controller = useSpectrumReference()
  if (!controller || (!controller.busy && controller.state.phase !== 'error')) return null
  const { state, busy, cancel } = controller
  const progress = state.progress === null ? null : Math.min(1, Math.max(0, state.progress))
  const phase = state.phase === 'opening' ? 'Opening audio…' : 'Analyzing'
  return <div className={`reference-status ${inline ? 'is-inline' : ''} ${busy ? '' : 'is-error'}`} role="status" aria-live="polite"
    onPointerDown={event => event.stopPropagation()}>
    <span className="reference-status__filename" title={state.phase === 'error' ? state.error ?? undefined : state.name ?? undefined}>
      {state.phase === 'error' ? state.error : state.name || 'Reference track'}
    </span>
    {busy && <span className="reference-status__phase">{phase}{progress !== null && <span className="reference-status__percent">{Math.round(progress * 100)}%</span>}</span>}
    <button type="button" className="reference-status__action" onClick={cancel}>{busy ? 'Cancel' : 'Dismiss'}</button>
    {busy && <div className={`reference-status__progress ${progress === null ? 'is-indeterminate' : ''}`}
      role="progressbar" aria-label="Reference analysis progress" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={progress === null ? undefined : Math.round(progress * 100)} aria-valuetext={progress === null ? phase : undefined}>
      <span style={progress === null ? undefined : { transform: `scaleX(${progress})` }} />
    </div>}
  </div>
}

function TrimNumber({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (value: number) => void }): JSX.Element {
  const [draft, setDraft] = useState(value.toFixed(1))
  useEffect(() => setDraft(value.toFixed(1)), [value])
  const commit = (): void => {
    const next = draft.trim() ? Number(draft) : value
    onChange(Number.isFinite(next) ? next : value)
    setDraft(clampReferenceTrim(Number.isFinite(next) ? next : value).toFixed(1))
  }
  return <span className="reference-settings__trim-value settings-control__value">
    <input type="number" aria-label="Reference trim in dB" min={-24} max={24} step={0.1} disabled={disabled}
      value={draft} onFocus={event => event.currentTarget.select()} onChange={event => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') { commit(); event.currentTarget.blur() } if (event.key === 'Escape') { event.preventDefault(); setDraft(value.toFixed(1)) } }} />
    <span aria-hidden="true">dB</span>
  </span>
}

export function SpectrumReferenceControls(): JSX.Element {
  const controller = useSpectrumReference()
  const trimId = useId()
  if (!controller) return <div className="reference-settings">Reference tracks are unavailable in this view.</div>
  const { reference, busy, matchTrim, update } = controller
  return <div className="reference-settings">
    <div className="settings-control settings-control--full">
      <span className="settings-control__label">Track</span>
      <div className="reference-settings__file">
        <span className={`reference-settings__filename ${reference ? '' : 'is-empty'}`} title={reference?.asset.name}>
          {reference?.asset.name ?? 'Drop audio onto the spectrum'}
        </span>
        <button type="button" className="settings-chip" onClick={controller.choose}>{reference ? 'Replace' : 'Load track'}</button>
        {reference && <button type="button" className="reference-settings__icon-button" aria-label="Remove reference" title="Remove reference" onClick={controller.remove}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>}
      </div>
    </div>
    <ReferenceImportStatus inline />
    {reference && <div className="reference-settings__comparison">
      <div className="settings-control">
        <span className="settings-control__label">View</span>
        <div className="settings-chip-row" role="group" aria-label="Reference view">
          {(['overlay', 'difference'] as const).map(view => <button type="button" key={view}
            className={`settings-chip ${reference.view === view ? 'is-active' : ''}`} aria-pressed={reference.view === view}
            disabled={busy} onClick={() => update({ view })}>{view === 'overlay' ? 'Overlay' : 'Difference'}</button>)}
        </div>
      </div>
      <div className="settings-control">
        <div className="settings-control__label reference-settings__trim-label">
          <label htmlFor={trimId}>Trim</label>
          <div className="reference-settings__trim-readout">
            <TrimNumber value={reference.trimDb} disabled={busy} onChange={trimDb => update({ trimDb })} />
            <button type="button" className="reference-settings__icon-button reference-settings__reset" disabled={busy || reference.trimDb === 0}
              aria-label="Reset reference trim" title="Reset trim to 0 dB" onClick={() => update({ trimDb: 0 })}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3v4h4M3.2 6.8A5 5 0 1 1 3.6 11" /></svg>
            </button>
          </div>
        </div>
        <input id={trimId} className="settings-control__range" type="range" min={-24} max={24} step={0.1}
          value={reference.trimDb} disabled={busy} onDoubleClick={() => update({ trimDb: 0 })}
          onChange={event => update({ trimDb: Number(event.target.value) })} />
        <div className="reference-settings__trim-actions">
          <button type="button" className="settings-chip" disabled={matchTrim === null}
            title={matchTrim === null ? 'Play at least one second of audio to match levels' : 'Match once using the last three seconds of audio'}
            onClick={() => { if (matchTrim !== null) update({ trimDb: matchTrim }) }}>Match level</button>
        </div>
      </div>
    </div>}
  </div>
}

export function useReferenceDrop(enabled = true): { dragging: boolean; bindings: {
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
} } {
  const controller = useSpectrumReference()
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const accepts = (event: DragEvent): boolean => !!controller && enabled && Array.from(event.dataTransfer.types).includes('Files')
  return { dragging, bindings: {
    onDragEnter: event => { if (accepts(event)) { event.preventDefault(); depth.current++; setDragging(true) } },
    onDragOver: event => { if (accepts(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } },
    onDragLeave: event => { if (accepts(event) && --depth.current <= 0) { depth.current = 0; setDragging(false) } },
    onDrop: event => {
      if (!accepts(event)) return
      event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false)
      if (event.dataTransfer.files.length === 1) controller?.importFile(event.dataTransfer.files[0])
      else if (!controller?.busy) controller?.reportError('Drop one reference track at a time.')
    },
  } }
}
