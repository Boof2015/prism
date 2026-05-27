#pragma once

#include "ScopeEngine.h"
#include "lufsmeter.h"   // reused, unmodified, from native/src

/**
 * Loudness (LUFS) meter engine. Pushes stereo audio into the reused
 * `Visualizer::LUFSMeterAnalyzer` (K-weighting + gated integration + the same fast
 * VU/peak/correlation block) and emits its scalar snapshot each frame. Like the VU
 * engine the frame is plain numbers (no base64); getSnapshot() advances peak decay
 * on the steady clock, so it's safe to call every frame. configure() is a no-op —
 * LUFS settings (mode/readout) are render-side.
 */
class LUFSMeterEngine : public ScopeEngine
{
public:
    const char* scopeId() const override { return "lufsmeter"; }
    juce::Identifier frameEventId() const override { return frameId; }

    void setSampleRate(double sampleRate) override
    {
        lufs.setSampleRate((float) sampleRate);
    }

    void configure(const juce::var&) override {}

    void process(const float* left, const float* right, int numSamples) override
    {
        if (numSamples <= 0)
            return;
        lufs.pushSamples(left, right, (size_t) numSamples);
    }

    juce::var buildFrame(double sampleRate) override
    {
        const auto snap = lufs.getSnapshot();
        auto* obj = new juce::DynamicObject();
        obj->setProperty("sampleRate", sampleRate);
        obj->setProperty("momentaryLUFS", snap.momentaryLUFS);
        obj->setProperty("shortTermLUFS", snap.shortTermLUFS);
        obj->setProperty("integratedLUFS", snap.integratedLUFS);
        obj->setProperty("vuLDb", snap.vuLDb);
        obj->setProperty("vuRDb", snap.vuRDb);
        obj->setProperty("barLDb", snap.barLDb);
        obj->setProperty("barRDb", snap.barRDb);
        obj->setProperty("peakLDb", snap.peakLDb);
        obj->setProperty("peakRDb", snap.peakRDb);
        obj->setProperty("correlation", snap.correlation);
        return juce::var(obj);
    }

private:
    const juce::Identifier frameId { "lufsmeterFrame" };
    Visualizer::LUFSMeterAnalyzer lufs;
};
