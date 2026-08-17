#pragma once

#include "ScopeEngine.h"
#include "spectrogram.h"   // reused, unmodified, from native/src
#include <vector>
#include <algorithm>

/**
 * Spectrogram engine. The reused Visualizer::SpectrogramAnalyzer runs in C++ and
 * produces finished display+heat columns. Unlike the other scopes, its DSP needs
 * the canvas-derived rowCount (and fft/freq/db/scale/orientation), which only the
 * webview knows — the UI pushes the full native config via "prismSpectrogramConfig",
 * routed here through configureNative(). process() preserves stereo energy in the DSP;
 * buildFrame() emits the columns produced since the last frame (base64) tagged with
 * rowCount, so the bridge can match them to the config the UI currently expects.
 * configure() (scope settings) is a no-op — every DSP parameter arrives in the
 * native config. The host sample rate (from setSampleRate) overrides whatever the
 * UI believed, so frequency mapping is always correct.
 */
class SpectrogramEngine : public ScopeEngine
{
public:
    const char* scopeId() const override { return "spectrogram"; }
    juce::Identifier frameEventId() const override { return frameId; }
    PreferredSize preferredSize() const override { return { 700, 340, 360, 200 }; }

    void setSampleRate(double sampleRate) override
    {
        if (sampleRate > 0.0 && (float) sampleRate != config.sampleRate)
        {
            config.sampleRate = (float) sampleRate;
            if (hasConfig)
                spectro.configure(config);
        }
    }

    void configure(const juce::var&) override {}

    void configureNative(const juce::var& opts) override
    {
        if (! opts.isObject())
            return;

        config.fftSize         = (size_t) std::max(0, (int) opts.getProperty("fftSize", 4096));
        config.rowCount        = (size_t) std::max(0, (int) opts.getProperty("rowCount", 0));
        config.minFrequency    = (float) opts.getProperty("minFrequency", 20.0);
        config.maxFrequency    = (float) opts.getProperty("maxFrequency", 20000.0);
        config.minDecibels     = (float) opts.getProperty("minDecibels", -90.0);
        config.maxDecibels     = (float) opts.getProperty("maxDecibels", -12.0);
        config.scrollSpeed     = (float) opts.getProperty("scrollSpeed", 2.0);
        config.contrast        = (float) opts.getProperty("contrast", 1.0);
        config.tiltDbPerOctave = (float) opts.getProperty("tiltDbPerOctave", 4.0);
        config.clarityMode     = opts.getProperty("clarityMode", "sharper").toString().toStdString();
        config.scaleMode       = opts.getProperty("scaleMode", "log").toString().toStdString();
        config.orientation     = opts.getProperty("orientation", "horizontal").toString().toStdString();

        // Host rate (from setSampleRate) is authoritative; the UI may still hold a
        // stale default before it has seen a frame. Only fall back to the UI value
        // if we have not yet learned the host rate.
        if (config.sampleRate <= 0.0f)
            config.sampleRate = (float) opts.getProperty("sampleRate", 48000.0);

        hasConfig = config.rowCount > 0 && config.fftSize > 0;
        if (hasConfig)
            spectro.configure(config);

        // The config changed: drop any half-built column batch so the next frame
        // starts clean at the new rowCount.
        pendingDisplay.clear();
        pendingHeat.clear();
        pendingColumns = 0;
    }

    void process(const float* left, const float* right, int numSamples) override
    {
        if (! hasConfig || numSamples <= 0)
            return;
        auto result = spectro.processStereo(left, right, (size_t) numSamples);
        if (result.columnCount > 0 && result.rowCount == config.rowCount)
        {
            pendingDisplay.insert(pendingDisplay.end(), result.display.begin(), result.display.end());
            pendingHeat.insert(pendingHeat.end(), result.heat.begin(), result.heat.end());
            pendingColumns += result.columnCount;
        }
    }

    juce::var buildFrame(double sampleRate) override
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty("sampleRate", sampleRate);
        obj->setProperty("rowCount", (int) config.rowCount);
        obj->setProperty("columnCount", (int) pendingColumns);
        if (pendingColumns > 0)
        {
            obj->setProperty("display", juce::Base64::toBase64(pendingDisplay.data(), pendingDisplay.size() * sizeof(float)));
            obj->setProperty("heat", juce::Base64::toBase64(pendingHeat.data(), pendingHeat.size() * sizeof(float)));
        }
        else
        {
            obj->setProperty("display", juce::String());
            obj->setProperty("heat", juce::String());
        }
        pendingDisplay.clear();
        pendingHeat.clear();
        pendingColumns = 0;
        return juce::var(obj);
    }

private:
    const juce::Identifier frameId { "spectrogramFrame" };
    Visualizer::SpectrogramAnalyzer spectro;
    Visualizer::SpectrogramConfig config;
    bool hasConfig = false;
    std::vector<float> pendingDisplay, pendingHeat;
    size_t pendingColumns = 0;
};
