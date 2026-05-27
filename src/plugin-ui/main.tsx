import { StrictMode, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import '../renderer/styles/globals.css'
import './styles.css'
import ScopeApp from './ScopeApp'
import SpectrumScope from './SpectrumScope'
import OscilloscopeScope from './OscilloscopeScope'
import VUMeterScope from './VUMeterScope'
import { BridgeSpectrumAnalyzer } from './BridgeSpectrumAnalyzer'
import { BridgeOscilloscopeAnalyzer } from './BridgeOscilloscopeAnalyzer'
import { BridgeVUMeterAnalyzer } from './BridgeVUMeterAnalyzer'
import { PluginWebViewDataSource } from './PluginWebViewDataSource'
import { connectOscilloscopeBridge, connectSpectrumBridge, connectVUMeterBridge } from './juceBridge'

// The C++ plugin tells us which scope it is via JUCE initialisation data.
// JUCE stores each value as an array (e.g. prismScope = ["oscilloscope"]).
function getScopeKind(): string {
  const raw = (window as unknown as {
    __JUCE__?: { initialisationData?: { prismScope?: unknown } }
  }).__JUCE__?.initialisationData?.prismScope
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : 'spectrum'
}

const dataSource = new PluginWebViewDataSource()

function buildApp(): JSX.Element {
  if (getScopeKind() === 'vumeter') {
    const analyzer = new BridgeVUMeterAnalyzer()
    connectVUMeterBridge({
      onFrame: (frame) => {
        analyzer.setSnapshot(frame)
        dataSource.setSampleRate(frame.sampleRate)
        dataSource.setPlaying(true)
      },
    })
    return (
      <ScopeApp
        kind="vumeter"
        renderScope={(settings, theme) => (
          <VUMeterScope
            settings={settings}
            theme={theme.vumeter}
            dataSource={dataSource}
            nativeAnalyzer={analyzer}
          />
        )}
      />
    )
  }

  if (getScopeKind() === 'oscilloscope') {
    const analyzer = new BridgeOscilloscopeAnalyzer()
    connectOscilloscopeBridge({
      onFrame: (frame) => {
        analyzer.setSamples(frame.samples, frame.detectedPitch)
        dataSource.setSampleRate(frame.sampleRate)
        dataSource.setPlaying(true)
      },
    })
    return (
      <ScopeApp
        kind="oscilloscope"
        renderScope={(settings, theme) => (
          <OscilloscopeScope
            settings={settings}
            theme={theme.oscilloscope}
            dataSource={dataSource}
            nativeAnalyzer={analyzer}
          />
        )}
      />
    )
  }

  const analyzer = new BridgeSpectrumAnalyzer(2048)
  connectSpectrumBridge({
    onFrame: (frame) => {
      analyzer.setMagnitudes(frame.magnitudes, frame.side)
      dataSource.setSampleRate(frame.sampleRate)
      dataSource.setPlaying(true)
    },
  })
  return (
    <ScopeApp
      kind="spectrum"
      renderScope={(settings, theme) => (
        <SpectrumScope
          settings={settings}
          theme={theme.spectrum}
          dataSource={dataSource}
          nativeAnalyzer={analyzer}
        />
      )}
    />
  )
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Missing #root element')
}

createRoot(rootElement).render(<StrictMode>{buildApp()}</StrictMode>)
