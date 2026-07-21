#pragma once

#include "ScopeEngine.h"
#include "spectrum.h"   // reused, unmodified, from native/src
#include <vector>

class SpectrumEngine : public ScopeEngine
{
public:
    const char* scopeId() const override { return "spectrum"; }
    juce::Identifier frameEventId() const override { return frameId; }
    PreferredSize preferredSize() const override { return { 820, 320, 360, 180 }; }

    void setSampleRate(double sampleRate) override
    {
        spectrum.setSampleRate((float) sampleRate);
    }

    void configure(const juce::var& settings) override
    {
        const int fftSize = (int) settings.getProperty("fftSize", 2048);
        if (fftSize > 0 && (size_t) fftSize != spectrum.getFFTSize())
            spectrum.setFFTSize((size_t) fftSize);

        configuredSmoothing = juce::jlimit(0.0f, 0.99f,
                                           (float) (double) settings.getProperty("smoothing", 0.9));
        applySmoothing();
    }

    void setMeasurementActive(bool active) override
    {
        if (measurementActive == active)
            return;

        measurementActive = active;
        applySmoothing();
    }

    void process(const float* left, const float* right, int numSamples) override
    {
        if (numSamples > 0)
            spectrum.pushStereoSamples(left, right, (size_t) numSamples);
        else
            spectrum.pushStereoSamples(nullptr, nullptr, 0); // recompute / decay
    }

    juce::var buildFrame(double sampleRate) override
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty("sampleRate", sampleRate);
        obj->setProperty("magnitudes", toBase64(spectrum.getMagnitudes()));
        obj->setProperty("side", toBase64(spectrum.getSideMagnitudes()));
        obj->setProperty("channelMax", toBase64(spectrum.getChannelMaxMagnitudes()));
        return juce::var(obj);
    }

private:
    void applySmoothing()
    {
        constexpr float measurementSmoothing = 0.97f;
        spectrum.setSmoothing(measurementActive
                                  ? juce::jmax(configuredSmoothing, measurementSmoothing)
                                  : configuredSmoothing);
    }

    static juce::String toBase64(const std::vector<float>& data)
    {
        return data.empty() ? juce::String()
                            : juce::Base64::toBase64(data.data(), data.size() * sizeof(float));
    }

    const juce::Identifier frameId { "spectrumFrame" };
    Visualizer::Spectrum spectrum { 2048 };
    float configuredSmoothing = 0.9f;
    bool measurementActive = false;
};
