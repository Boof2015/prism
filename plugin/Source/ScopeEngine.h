#pragma once

#include <juce_core/juce_core.h>

/**
 * Per-scope DSP + frame producer. The editor is otherwise scope-agnostic: it
 * buffers stereo audio and, each frame, feeds it to the engine and emits the
 * engine's frame payload to the webview. One implementation per scope; the build
 * (PRISM_SCOPE_*) selects which one a given plugin product uses.
 */
class ScopeEngine
{
public:
    virtual ~ScopeEngine() = default;

    /** Editor window sizing (logical px). Each scope picks a shape that fits it. */
    struct PreferredSize
    {
        int defaultWidth  = 720;
        int defaultHeight = 320;
        int minWidth      = 320;
        int minHeight     = 160;
    };
    virtual PreferredSize preferredSize() const { return {}; }

    /** Stable id sent to the webview (via initialisation data) to pick the UI scope. */
    virtual const char* scopeId() const = 0;

    /** Event name this engine emits frames on (the webview subscribes to it). */
    virtual juce::Identifier frameEventId() const = 0;

    virtual void setSampleRate(double sampleRate) = 0;

    /** Apply scope settings (the JS settings object) to the DSP. */
    virtual void configure(const juce::var& settings) = 0;

    /**
     * Apply a scope-specific native config pushed from the UI on the
     * "prismSpectrogramConfig" event. Default no-op; only scopes whose DSP needs
     * canvas-derived parameters (e.g. the spectrogram's rowCount) override this.
     */
    virtual void configureNative(const juce::var&) {}

    /** Feed audio (called off the realtime thread). numSamples may be 0. */
    virtual void process(const float* left, const float* right, int numSamples) = 0;

    /** Build the per-frame payload to emit to the webview. */
    virtual juce::var buildFrame(double sampleRate) = 0;
};
