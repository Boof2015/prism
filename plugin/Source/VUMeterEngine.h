#pragma once

#include "ScopeEngine.h"
#include "vumeter.h"   // reused, unmodified, from native/src

/**
 * VU meter engine. Pushes stereo audio into the reused `Visualizer::VUMeterAnalyzer`
 * (RMS integration + ballistics + peak hold + correlation, all sample-accurate) and
 * emits the resulting scalar snapshot each frame. No base64 needed — the frame is a
 * handful of numbers. getSnapshot() advances peak decay on the steady clock, so the
 * meter still settles when audio momentarily stops.
 */
class VUMeterEngine : public ScopeEngine
{
public:
    const char* scopeId() const override { return "vumeter"; }
    juce::Identifier frameEventId() const override { return frameId; }
    PreferredSize preferredSize() const override { return { 480, 300, 280, 180 }; }

    void setSampleRate(double sampleRate) override
    {
        vu.setSampleRate((float) sampleRate);
    }

    void configure(const juce::var&) override
    {
        // VU settings (mode/orientation/needleChannels/referenceDb) are render-side only.
    }

    void process(const float* left, const float* right, int numSamples) override
    {
        if (numSamples <= 0)
            return;
        vu.pushSamples(left, right, (size_t) numSamples);
    }

    juce::var buildFrame(double sampleRate) override
    {
        const auto snap = vu.getSnapshot();
        auto* obj = new juce::DynamicObject();
        obj->setProperty("sampleRate", sampleRate);
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
    const juce::Identifier frameId { "vumeterFrame" };
    Visualizer::VUMeterAnalyzer vu;
};
