import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import SpectrumScope from './SpectrumScope'
import { BridgeSpectrumAnalyzer } from './BridgeSpectrumAnalyzer'
import { PluginWebViewDataSource } from './PluginWebViewDataSource'
import { connectSpectrumBridge } from './juceBridge'
import './styles.css'

// One shared analyzer shim + data source for the lifetime of the page.
const nativeAnalyzer = new BridgeSpectrumAnalyzer(2048)
const dataSource = new PluginWebViewDataSource()

// Diagnostic: count host frames so the FPS meter (off by default) can show the
// data push rate. Toggle it on by adding `showFpsMeter` to <SpectrumScope/>.
let dataFrameCount = 0

// Pipe host frames into the shim/data source. The SpectrumAnalyzer (mounted by
// <SpectrumScope/>) reads from both on its own render loop.
connectSpectrumBridge({
  onFrame: (frame) => {
    dataFrameCount += 1
    nativeAnalyzer.setMagnitudes(frame.magnitudes)
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
    <SpectrumScope
      dataSource={dataSource}
      nativeAnalyzer={nativeAnalyzer}
      getDataFrameCount={() => dataFrameCount}
    />
  </StrictMode>,
)
