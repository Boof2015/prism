#pragma once

#include "ScopeEngine.h"
#include "waterfall.h"
#include <algorithm>
#include <cmath>

// The native analyzer keeps the 60 Hz audio timeline. Only the visible ridges
// and frequency columns cross into the webview; paint rate never samples history.
class WaterfallEngine : public ScopeEngine
{
public:
    const char* scopeId() const override { return "waterfall"; }
    juce::Identifier frameEventId() const override { return { "waterfallFrame" }; }
    PreferredSize preferredSize() const override { return { 760, 360, 360, 180 }; }

    void setSampleRate(double rate) override
    {
        if (std::isfinite(rate) && rate > 0 && (float) rate != config.sampleRate)
        {
            config.sampleRate = (float) rate;
            analyzer.configure(config);
        }
    }

    void configure(const juce::var& settings) override
    {
        if (! settings.isObject()) return;
        applyAnalysisSettings(settings);
        const bool audible = settings.getProperty("frequencyRangeMode", "extended").toString() == "audible";
        config.minFrequency = audible ? 20.0f : 10.0f;
        config.maxFrequency = audible ? 20000.0f : 24000.0f;
        analyzer.configure(config);
    }

    void configureNative(const juce::var& payload) override
    {
        if (! payload.isObject()) return;
        revision = (int) payload.getProperty("revision", revision);
        if ((bool) payload.getProperty("reset", false)) analyzer.reset();
        const auto options = payload.getProperty("config", juce::var());
        if (options.isObject())
        {
            applyAnalysisSettings(options);
            // Host sample rate always wins over the webview's initial estimate.
            config.minFrequency = number(options, "minFrequency", config.minFrequency);
            config.maxFrequency = number(options, "maxFrequency", config.maxFrequency);
            analyzer.configure(config);
        }
        ridges = (size_t) juce::jlimit(2, 64, (int) payload.getProperty("ridges", (int) ridges));
        columns = (size_t) juce::jlimit(2, 512, (int) payload.getProperty("columns", (int) columns));
    }

    void resetAudioHistory() override { analyzer.reset(); }

    void process(const float* left, const float* right, int count) override
    {
        if (count > 0) analyzer.processStereo(left, right, (size_t) count);
    }

    juce::var buildFrame(double) override
    {
        const auto frame = analyzer.getFrame(ridges, columns);
        auto* object = new juce::DynamicObject();
        object->setProperty("sampleRate", config.sampleRate);
        object->setProperty("revision", revision);
        object->setProperty("columns", (int) frame.columns);
        object->setProperty("audioSeconds", frame.audioSeconds);
        object->setProperty("levels", encode(frame.levels));
        object->setProperty("ages", encode(frame.ages));
        object->setProperty("frequencies", encode(frame.frequencies));
        return juce::var(object);
    }

private:
    static float number(const juce::var& object, const char* key, float fallback)
    {
        const auto value = object.getProperty(key, fallback);
        if (! (value.isInt() || value.isInt64() || value.isDouble())) return fallback;
        const auto result = (float) value;
        return std::isfinite(result) ? result : fallback;
    }

    void applyAnalysisSettings(const juce::var& settings)
    {
        config.fftSize = (size_t) std::clamp(number(settings, "fftSize", (float) config.fftSize), 0.0f, 16384.0f);
        config.historySeconds = number(settings, "historySeconds", config.historySeconds);
        config.smoothing = number(settings, "smoothing", config.smoothing);
        config.tiltDbPerOctave = number(settings, "tiltDbPerOctave", config.tiltDbPerOctave);
        config.scaleMode = settings.getProperty("scaleMode", juce::String(config.scaleMode)).toString().toStdString();
    }

    static juce::String encode(const std::vector<float>& values)
    {
        return values.empty() ? juce::String() : juce::Base64::toBase64(values.data(), values.size() * sizeof(float));
    }

    Visualizer::WaterfallAnalyzer analyzer;
    Visualizer::WaterfallConfig config;
    size_t ridges = 32, columns = 256;
    int revision = 0;
};
