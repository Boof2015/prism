#pragma once

#include "ScopeEngine.h"
#include "oscilloscope.h"   // reused, unmodified, from native/src
#include <vector>
#include <algorithm>
#include <cmath>

class OscilloscopeEngine : public ScopeEngine
{
public:
    const char* scopeId() const override { return "oscilloscope"; }
    juce::Identifier frameEventId() const override { return frameId; }

    void setSampleRate(double sampleRate) override
    {
        osc.setSampleRate((float) sampleRate);
        osc.setDisplaySamples(normalizedDisplaySamples(sampleRate));
    }

    void configure(const juce::var& settings) override
    {
        pitchLock = (bool) settings.getProperty("pitchLock", true);
        osc.setPitchLock(pitchLock);
    }

    void process(const float* left, const float* right, int numSamples) override
    {
        if (numSamples <= 0)
            return;
        if ((int) mono.size() < numSamples)
            mono.resize((size_t) numSamples);
        for (int i = 0; i < numSamples; ++i)
            mono[(size_t) i] = 0.5f * (left[i] + right[i]);
        osc.pushSamples(mono.data(), (size_t) numSamples);
        samplesSeen += numSamples;
    }

    juce::var buildFrame(double sampleRate) override
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty("sampleRate", sampleRate);
        obj->setProperty("pitch", 0.0);

        // Pitch lock needs samples buffered before trigger detection is meaningful.
        if (pitchLock && samplesSeen < kWarmupSamples)
        {
            obj->setProperty("samples", juce::String());
            return juce::var(obj);
        }

        const auto result = osc.process();
        const int samplesToShow = result.samplesToShow;
        if (samplesToShow <= 1)
        {
            obj->setProperty("samples", juce::String());
            return juce::var(obj);
        }

        float triggerIndex = result.triggerIndex;
        if (! pitchLock)
        {
            // Free-run: show the most recent window ending at the write head.
            const size_t writePos = osc.getWritePos();
            triggerIndex = (float) ((writePos + Visualizer::OSCILLOSCOPE_BUFFER_SIZE - (size_t) samplesToShow)
                                    % Visualizer::OSCILLOSCOPE_BUFFER_SIZE);
        }

        if ((int) window.size() != samplesToShow)
            window.resize((size_t) samplesToShow);
        osc.getSamplesInterpolated(window.data(), triggerIndex, (size_t) samplesToShow);

        obj->setProperty("pitch", result.detectedPitch);
        obj->setProperty("samples", juce::Base64::toBase64(window.data(), window.size() * sizeof(float)));
        return juce::var(obj);
    }

private:
    // Mirrors getNormalizedOscilloscopeDisplaySamples in the renderer.
    static int normalizedDisplaySamples(double sampleRate)
    {
        const double base = 2048.0, rateMin = 44100.0, rateMax = 48000.0;
        double samples = base;
        if (sampleRate > 0.0)
        {
            if (sampleRate < rateMin)       samples = std::round(base * (sampleRate / rateMin));
            else if (sampleRate > rateMax)  samples = std::round(base * (sampleRate / rateMax));
        }
        return (int) std::clamp(samples, 64.0, 32767.0);
    }

    static constexpr long long kWarmupSamples = 4096;
    const juce::Identifier frameId { "oscilloscopeFrame" };
    Visualizer::Oscilloscope osc;
    std::vector<float> mono, window;
    bool pitchLock = true;
    long long samplesSeen = 0;
};
