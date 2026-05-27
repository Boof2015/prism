#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"
#include "ScopeEngine.h"
#include <memory>
#include <vector>

/**
 * Hosts the React webview UI and bridges the reused Prism spectrum DSP to it.
 *
 * Driven by a VBlankAttachment (message thread, synced to the display's refresh
 * rate). Each vblank it drains stereo audio buffered by the processor, runs
 * Visualizer::Spectrum, and emits mid + side magnitudes to the webview as a
 * "spectrumFrame" event. Receives "prismConfig" (settings + fftSize/smoothing)
 * and "prismReady" events from the UI.
 */
class PrismSpectrumEditor : public juce::AudioProcessorEditor
{
public:
    explicit PrismSpectrumEditor(PrismSpectrumProcessor&);
    ~PrismSpectrumEditor() override = default;

    void resized() override;

    // Called by the webview event listeners (message thread).
    void onPrismConfig(juce::var payload);
    void onPrismReady();

    // Scope-specific native config (e.g. the spectrogram's canvas-derived rowCount).
    void onScopeNativeConfig(juce::var payload);

    // Push the processor's saved settings to the UI (used on ready + on host
    // state restore, to cover either ordering).
    void pushRestoreSettings();

    // Read the user's Prism app theme + active profile from disk and send them
    // to the UI as defaults (per-instance overrides still win).
    void sendAppDefaults();

private:
    void renderFrame();

    PrismSpectrumProcessor& processorRef;

    std::unique_ptr<ScopeEngine> engine;
    std::vector<float> drainLeft, drainRight;
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
