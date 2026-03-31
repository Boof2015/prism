import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ScopePopoutWindow from './popouts/ScopePopoutWindow'
import DialogApp from './components/DialogApp'
import './styles/globals.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import { SCOPE_KINDS, type ScopeKind } from '../types/scope'

function isScopeKind(value: string | null): value is ScopeKind {
  return value !== null && SCOPE_KINDS.includes(value as ScopeKind)
}

const params = new URLSearchParams(window.location.search)
const windowMode = params.get('mode')
const windowRole = params.get('window')
const scopeKind = params.get('scope')

let root: React.ReactElement
if (windowMode === 'dialog') {
  root = <DialogApp />
} else if (windowRole === 'scope-popout') {
  root = isScopeKind(scopeKind)
    ? <ScopePopoutWindow scopeKind={scopeKind} />
    : <div>Invalid scope popout</div>
} else {
  root = <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {root}
  </React.StrictMode>
)
