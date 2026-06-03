#pragma once

#include "ScopeEngine.h"
#include "waveform.h"   // reused, unmodified, from native/src
#include <vector>
#include <cmath>
#include <algorithm>

/**
 * Waveform engine. Runs the reused Visualizer::WaveformMultibandAnalyzer, which
 * summarizes audio into per-column min/max + 3-band RMS. Unlike the spectrogram, the
 * column width (samplesPerColumn) is a pure function of sampleRate and scrollSpeed —
 * sampleRate / (128 * scrollSpeed), the same formula the renderer uses — so the engine
 * derives it itself; no canvas round-trip. mode ('stereo' vs 'mono') selects
 * processStereo (stride 10) vs processMono (stride 5), flagged in the frame. multiband
 * is render-only (the analyzer always emits the band RMS columns use for coloring).
 */
class WaveformEngine : public ScopeEngine
{
public:
    WaveformEngine() { reconfigure(); }

    const char* scopeId() const override { return "waveform"; }
    juce::Identifier frameEventId() const override { return frameId; }
    PreferredSize preferredSize() const override { return { 720, 260, 360, 140 }; }

    void setSampleRate(double sr) override
    {
        if (sr > 0.0 && (float) sr != sampleRate)
        {
            sampleRate = (float) sr;
            reconfigure();
        }
    }

    void configure(const juce::var& settings) override
    {
        stereo = settings.getProperty("mode", "mono").toString() == "stereo";
        const auto speed = (float) settings.getProperty("scrollSpeed", (double) scrollSpeed);
        if (speed > 0.0f)
            scrollSpeed = speed;
        reconfigure();
    }

    void process(const float* left, const float* right, int numSamples) override
    {
        if (numSamples <= 0)
            return;

        if (stereo)
        {
            const auto& cols = wave.processStereo(left, right, (size_t) numSamples);
            pending.insert(pending.end(), cols.begin(), cols.end());
        }
        else
        {
            if ((int) mono.size() < numSamples)
                mono.resize((size_t) numSamples);
            for (int i = 0; i < numSamples; ++i)
                mono[(size_t) i] = 0.5f * (left[i] + right[i]);
            const auto& cols = wave.processMono(mono.data(), (size_t) numSamples);
            pending.insert(pending.end(), cols.begin(), cols.end());
        }
    }

    juce::var buildFrame(double sr) override
    {
        const size_t stride = stereo ? Visualizer::WAVEFORM_STEREO_SUMMARY_STRIDE
                                     : Visualizer::WAVEFORM_MONO_SUMMARY_STRIDE;
        auto* obj = new juce::DynamicObject();
        obj->setProperty("sampleRate", sr);
        obj->setProperty("stereo", stereo);
        obj->setProperty("columnCount", (int) (pending.size() / stride));
        if (! pending.empty())
            obj->setProperty("summaries", juce::Base64::toBase64(pending.data(), pending.size() * sizeof(float)));
        else
            obj->setProperty("summaries", juce::String());
        pending.clear();
        return juce::var(obj);
    }

private:
    void reconfigure()
    {
        const float pps = 128.0f * std::max(0.01f, scrollSpeed);
        samplesPerColumn = (size_t) std::max(1L, std::lround(sampleRate / pps));
        wave.configure(sampleRate, samplesPerColumn);
        pending.clear();
    }

    const juce::Identifier frameId { "waveformFrame" };
    Visualizer::WaveformMultibandAnalyzer wave;
    std::vector<float> mono, pending;
    float sampleRate = 48000.0f;
    float scrollSpeed = 1.0f;
    size_t samplesPerColumn = 1;
    bool stereo = false;
};
