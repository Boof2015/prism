#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"
#include "ScopeEngine.h"
#include <memory>
#include <vector>

/**
 * Hosts the React webview UI and bridges the reused Prism spectrum DSP to it.
 *
 * Drains stereo audio buffered by the processor, feeds the selected scope engine,
 * and emits frame payloads to the webview after the UI reports readiness. macOS
 * uses display vblank; Windows/Linux use steady message-thread timers to avoid
 * fragile host/browser embedding behavior.
 */
class PrismSpectrumEditor : public juce::AudioProcessorEditor
#if JUCE_WINDOWS || JUCE_LINUX
    , private juce::Timer
#endif
{
public:
    explicit PrismSpectrumEditor(PrismSpectrumProcessor&);
    ~PrismSpectrumEditor() override;

    void resized() override;

#if JUCE_WINDOWS || JUCE_LINUX
    void timerCallback() override;
#endif

    // Called by the webview event listeners (message thread).
    void onPrismConfig(juce::var payload);
    void onPrismReady();

    // Scope-specific native config (e.g. the spectrogram's canvas-derived rowCount).
    void onScopeNativeConfig(juce::var payload);

    // The UI's settings panel opened/closed along the bottom. Grow/shrink the editor
    // height by exactly the panel height so the scope area is unchanged (the window
    // accommodates the panel, like the app). 0 = closed.
    void onSettingsPanel(juce::var payload);

    // Push the processor's saved settings to the UI (used on ready + on host
    // state restore, to cover either ordering).
    void pushRestoreSettings();

    // Read the user's Prism app theme + active profile from disk and send them
    // to the UI as defaults (per-instance overrides still win).
    void sendAppDefaults();

private:
    void loadWebView();
    void showWebViewFallback();
    void startFrameDriver();
    void renderFrame();

    PrismSpectrumProcessor& processorRef;

    std::unique_ptr<ScopeEngine> engine;
    std::vector<float> drainLeft, drainRight;
    double lastSampleRate = 0.0;

    // Height (px) the editor is currently grown by for the open settings panel.
    int settingsPanelHeight = 0;
    bool webViewReady = false;
    bool frameDriverStarted = false;

    // One-time attempt to lift WKWebView's private 60fps cap (macOS).
    bool frameRateUncapped = false;
    int uncapAttempts = 0;

    std::unique_ptr<juce::WebBrowserComponent> webView;
    juce::Label webViewFallback;

    // Declared last so it is destroyed first; no vblank callback can fire into a
    // partially-destroyed editor. Windows/Linux use juce::Timer instead.
#if ! JUCE_WINDOWS && ! JUCE_LINUX
    juce::VBlankAttachment vblank;
#endif

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PrismSpectrumEditor)
};
