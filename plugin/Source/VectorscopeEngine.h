#pragma once

#include "ScopeEngine.h"
#include "vectorscope.h"   // reused, unmodified, from native/src
#include <vector>

/**
 * Vectorscope engine. Pushes stereo audio into the reused `Visualizer::Vectorscope`
 * (lowpass-filtered L/R + a 3-band split, both in circular buffers) and emits the
 * most recent display points each frame. Two layouts share the buffers: the standard
 * X/Y point cloud and the multiband (low/mid/high) cloud. Both buffers are kept warm
 * so toggling is instant; the active layout (from the `multiband` setting) is flagged
 * in the frame so the webview reads the right payload.
 */
class VectorscopeEngine : public ScopeEngine
{
public:
    const char* scopeId() const override { return "vectorscope"; }
    juce::Identifier frameEventId() const override { return frameId; }
    PreferredSize preferredSize() const override { return { 440, 440, 240, 200 }; }

    void setSampleRate(double sampleRate) override
    {
        vec.setSampleRate((float) sampleRate);
    }

    void configure(const juce::var& settings) override
    {
        multiband = (bool) settings.getProperty("multiband", false);
    }

    void process(const float* left, const float* right, int numSamples) override
    {
        if (numSamples <= 0)
            return;
        vec.pushSamples(left, right, (size_t) numSamples);
        vec.pushMultibandSamples(left, right, (size_t) numSamples);
    }

    juce::var buildFrame(double sampleRate) override
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty("sampleRate", sampleRate);
        obj->setProperty("multiband", multiband);

        if (multiband)
        {
            constexpr size_t stride = Visualizer::MULTIBAND_POINT_STRIDE;
            if (mbData.size() < (size_t) kDisplayPoints * stride)
                mbData.resize((size_t) kDisplayPoints * stride);
            const size_t count = vec.getMultibandPoints(mbData.data(), (size_t) kDisplayPoints);
            obj->setProperty("count", (int) count);
            obj->setProperty("data", juce::Base64::toBase64(mbData.data(), count * stride * sizeof(float)));
        }
        else
        {
            if (pointX.size() < (size_t) kDisplayPoints)
            {
                pointX.resize((size_t) kDisplayPoints);
                pointY.resize((size_t) kDisplayPoints);
            }
            const size_t count = vec.getPoints(pointX.data(), pointY.data(), (size_t) kDisplayPoints);
            obj->setProperty("count", (int) count);
            obj->setProperty("x", juce::Base64::toBase64(pointX.data(), count * sizeof(float)));
            obj->setProperty("y", juce::Base64::toBase64(pointY.data(), count * sizeof(float)));
        }
        return juce::var(obj);
    }

private:
    static constexpr int kDisplayPoints = 4096;   // matches Vectorscope.ts default
    const juce::Identifier frameId { "vectorscopeFrame" };
    Visualizer::Vectorscope vec;
    std::vector<float> pointX, pointY, mbData;
    bool multiband = false;
};
