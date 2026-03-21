import ScopeModule from './ScopeModule'

export default function Strip(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-primary)',
      }}
    >
      <ScopeModule scopeKind="spectrum" lineColor="var(--accent, #38bdf8)" />
      <div style={{ width: '1px', flexShrink: 0, backgroundColor: 'var(--glass-border)' }} />
      <ScopeModule scopeKind="oscilloscope" lineColor="var(--accent, #38bdf8)" />
      <div style={{ width: '1px', flexShrink: 0, backgroundColor: 'var(--glass-border)' }} />
      <ScopeModule scopeKind="vectorscope" lineColor="var(--accent, #38bdf8)" />
    </div>
  )
}
