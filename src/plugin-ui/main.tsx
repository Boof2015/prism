import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../renderer/styles/globals.css'
import './styles.css'
import SpectrumApp from './SpectrumApp'
import { BridgeSpectrumAnalyzer } from './BridgeSpectrumAnalyzer'
import { PluginWebViewDataSource } from './PluginWebViewDataSource'
import { connectSpectrumBridge } from './juceBridge'

// One shared analyzer shim + data source for the lifetime of the page.
const nativeAnalyzer = new BridgeSpectrumAnalyzer(2048)
const dataSource = new PluginWebViewDataSource()

// Pipe host frames into the shim/data source. The SpectrumAnalyzer (mounted by
// <SpectrumApp/>) reads from both on its own render loop.
connectSpectrumBridge({
  onFrame: (frame) => {
    nativeAnalyzer.setMagnitudes(frame.magnitudes, frame.side)
    dataSource.setSampleRate(frame.sampleRate)
    dataSource.setPlaying(true)
  },
})

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Missing #root element')
}

createRoot(rootElement).render(
  <StrictMode>
    <SpectrumApp dataSource={dataSource} nativeAnalyzer={nativeAnalyzer} />
  </StrictMode>,
)
