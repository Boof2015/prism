#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"
#include "spectrum.h"   // reused, unmodified, from native/src
#include <vector>

/**
 * Hosts the React webview UI and bridges the reused Prism spectrum DSP to it.
 *
 * Driven by a VBlankAttachment (message thread, synced to the display's refresh
 * rate — so it adapts to 60/120/144 Hz panels). Each vblank it drains audio
 * buffered by the processor, runs Visualizer::Spectrum (native/src/spectrum.cpp),
 * and emits magnitudes to the webview as a "spectrumFrame" event. The webview
 * (src/plugin-ui) renders them with the existing SpectrumAnalyzer canvas code.
 */
class PrismSpectrumEditor : public juce::AudioProcessorEditor
{
public:
    explicit PrismSpectrumEditor(PrismSpectrumProcessor&);
    ~PrismSpectrumEditor() override = default;

    void resized() override;

private:
    void renderFrame();

    PrismSpectrumProcessor& processorRef;

    Visualizer::Spectrum spectrum { 2048 };
    std::vector<float> drainScratch;
    double lastSampleRate = 0.0;

    // One-time attempt to lift WKWebView's private 60fps cap (macOS).
    bool frameRateUncapped = false;
    int uncapAttempts = 0;

    juce::WebBrowserComponent webView;

    // Declared last so it is destroyed first — no vblank callback can fire into
    // a partially-destroyed editor.
    juce::VBlankAttachment vblank;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PrismSpectrumEditor)
};
